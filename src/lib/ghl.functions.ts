import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DEFAULT_EVENTS } from "./events";

const GHL_LOCATION_ID = "mVdYbXfJcF10Y7anuoNt";
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

// ===== The one tag =====
// Every buyer + attendee carries a single tag identifying the event + date:
//   🤝 s&p-{city}-{yymmdd}   e.g. "🤝 s&p-boston-260603"
// No tier/seminar/attendee tags — tier comes from the purchased product, and
// buyer-vs-attendee is told apart by the contact `source`. Event/date/year is
// read back from this tag (and from the opportunity / admin dashboard).
const EVENT_TAG_PREFIX = "🤝 s&p-";

// "2026-06-03" → "260603"; "" if the date isn't a full ISO date.
function yymmdd(isoDate?: string): string {
  const m = (isoDate ?? "").match(/^\d{2}(\d{2})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : "";
}

// Build the single event tag for a city slug. Falls back to the seeded events
// list for the end date when the caller doesn't supply one.
function eventTag(city: string, endDate?: string): string {
  const date = yymmdd(endDate || DEFAULT_EVENTS.find((e) => e.slug === city)?.end_date);
  return date ? `${EVENT_TAG_PREFIX}${city}-${date}` : `${EVENT_TAG_PREFIX}${city}`;
}

// GHL custom-field keys the checkout writes to the buyer contact. These must
// match the field keys in GHL exactly (the part after `contact.` in a merge
// tag, e.g. {{contact.do_you_have_a_moa_1}} → "do_you_have_a_moa_1").
const FIELD_KEYS = {
  eventCity: "event_city",
  ticketTier: "ticket_tier",
  orderAmount: "order_amount",
  // Real per-buyer ticket count, set by the GHL workflow (see docs §6).
  ticketQuantity: "sp_no_of_ticket_purchased",
  // Fallback keys read when the primary field is not yet populated.
  ticketQuantityLegacy: "sp2026_ticket_quantity",
  ticketQuantityLegacy2: "ticket_quantity",
  ticketQuantityLegacy3: "sp2026ticket_quantity",
  hasMoa: "do_you_have_a_moa_1",
  attendedBefore: "have_you_attended_a_scale__profit_seminar_before_1",
  shirtSize: "scale__profit_shirt_size",
  // Running count of additional attendees the admin has registered for a buyer,
  // so "tickets to add remaining" persists across reloads. (Create this contact
  // custom field in GHL — number — for persistence; absent → treated as 0.)
  attendeesAdded: "sp_attendees_added",
} as const;

// GHL *opportunity* custom-field keys (separate object/namespace from contact
// fields — referenced as {{opportunity.<key>}}). The cohort fields carry the
// event details so emails/messaging can merge them from the opportunity.
const OPP_FIELD_KEYS = {
  ticketsPurchased: "sp2026ticket_quantity",
  ticketsPurchasedLegacy: "sp_no_of_ticket_purchased",
  cohortLocation: "sp_cohort_location",
  cohortDate: "sp_cohort_date",
  cohortVenue: "sp_cohort_venue",
  cohortAddress: "sp_cohort_address",
  cohortTime: "sp_cohort_time",
} as const;

const GA_PRICE_TIERS = [
  { qty: 1, price: 997 },
  { qty: 2, price: 1794 },
  { qty: 3, price: 2541 },
  { qty: 4, price: 3088 },
  { qty: 5, price: 3535 },
] as const;

const attendeeSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(200),
});

const surveySchema = z.object({
  agencyState: z.string().max(100),
  hasMoa: z.string().max(10),
  attendedBefore: z.string().max(500),
  shirtSize: z.string().max(20),
});

// Event details for the buyer's event, written onto the opportunity's cohort
// fields so emails/messaging can merge them.
const eventDetailsSchema = z.object({
  name: z.string().max(120).optional(),
  date: z.string().max(120).optional(),
  venue: z.string().max(200).optional(),
  address: z.string().max(300).optional(),
  time: z.string().max(100).optional(),
});

const inputSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(200),
  phone: z.string().min(3).max(30),
  city: z.string().min(1).max(50),
  tier: z.enum(["ga", "vip"]),
  quantity: z.number().int().min(1).max(20),
  amount: z.number().min(0).max(1000000),
  attendees: z.array(attendeeSchema).min(0).max(20).optional(),
  survey: surveySchema.optional(),
  event: eventDetailsSchema.optional(),
});

export type GhlCheckoutInput = z.infer<typeof inputSchema>;

async function ghlFetch(path: string, init: RequestInit) {
  const token = process.env.GHL_API_KEY;
  if (!token) throw new Error("GHL_API_KEY is not configured");
  const res = await fetch(`${GHL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: GHL_VERSION,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    throw new Error(`GHL ${path} failed ${res.status}: ${text.slice(0, 500)}`);
  }
  return body as Record<string, unknown>;
}

export const submitCheckoutToGhl = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data }) => {
    const tierLabel = data.tier === "vip" ? "VIP" : "General Admission";
    // Write the ticket count for every tier (not just VIP) so the contact's
    // sp_no_of_ticket_purchased field is the authoritative source the admin
    // dashboard + detail dialog read back. GA multi-ticket orders previously
    // had no count stored anywhere reliable.
    const ticketQuantityFields = [
      { key: FIELD_KEYS.ticketQuantity, field_value: String(data.quantity) },
      { key: FIELD_KEYS.ticketQuantityLegacy, field_value: String(data.quantity) },
    ];
    // NOTE: tagging is done in ONE place only — tagBuyerForEvent on the
    // confirmation page (reached via GHL's redirect). We deliberately do NOT
    // tag here, so a buyer never gets two tags. We omit `tags` from the upsert.

    // 1. Upsert primary buyer contact + fetch pipelines in parallel
    //    (pipelines lookup doesn't depend on the contact, so we save a
    //    full round-trip by not waiting for the upsert first).
    const upsertPromise = ghlFetch("/contacts/upsert", {
      method: "POST",
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        // Do NOT set `source` here — that would overwrite the checkout form's
        // source (S&P-GenAd / S&P-vip), which we rely on to tell GA vs VIP apart
        // (e.g. the Nashville VIP cap).
        // Agency state maps to GHL's native contact "State" field
        // ({{contact.state}}), so it's a top-level property, not a custom field.
        ...(data.survey?.agencyState ? { state: data.survey.agencyState } : {}),
        customFields: [
          { key: FIELD_KEYS.eventCity, field_value: data.city },
          { key: FIELD_KEYS.ticketTier, field_value: tierLabel },
          ...ticketQuantityFields,
          { key: FIELD_KEYS.orderAmount, field_value: String(data.amount) },
          ...(data.survey
            ? [
                { key: FIELD_KEYS.hasMoa, field_value: data.survey.hasMoa },
                { key: FIELD_KEYS.attendedBefore, field_value: data.survey.attendedBefore },
                { key: FIELD_KEYS.shirtSize, field_value: data.survey.shirtSize },
              ]
            : []),
        ],
      }),
    }) as Promise<{ contact?: { id?: string }; id?: string }>;

    const pipelinesPromise = ghlFetch(`/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`, {
      method: "GET",
    }).catch((err) => {
      console.warn("GHL pipelines fetch failed:", (err as Error).message);
      return null;
    }) as Promise<{ pipelines?: Array<{ id: string; stages?: Array<{ id: string }> }> } | null>;

    const [upsert, pipelines] = await Promise.all([upsertPromise, pipelinesPromise]);

    const contactId = (upsert.contact && upsert.contact.id) || upsert.id || undefined;

    // 2. Upsert additional attendees (best-effort — don't fail the order)
    if (data.attendees && data.attendees.length > 0) {
      await Promise.allSettled(
        data.attendees
          .filter((a) => a.email && a.email !== data.email)
          .map((a) =>
            ghlFetch("/contacts/upsert", {
              method: "POST",
              body: JSON.stringify({
                locationId: GHL_LOCATION_ID,
                firstName: a.firstName,
                lastName: a.lastName,
                email: a.email,
                tags,
                source: "Scale & Profit Seminar Attendee",
              }),
            }),
          ),
      );
    }

    // 3. Create an opportunity in the first available pipeline (best-effort)
    let opportunityId: string | undefined;
    if (contactId && pipelines) {
      try {
        const pipeline = pipelines.pipelines?.[0];
        const stageId = pipeline?.stages?.[0]?.id;
        if (pipeline && stageId) {
          // Opportunity custom fields: ticket count + event/cohort details
          // (so emails can merge {{opportunity.sp_cohort_*}}).
          const oppCustomFields: Array<{ key: string; field_value: string }> = [
            { key: OPP_FIELD_KEYS.ticketsPurchased, field_value: String(data.quantity) },
            { key: OPP_FIELD_KEYS.ticketsPurchasedLegacy, field_value: String(data.quantity) },
          ];
          const cohortPairs: Array<[string, string | undefined]> = [
            [OPP_FIELD_KEYS.cohortLocation, data.event?.name],
            [OPP_FIELD_KEYS.cohortDate, data.event?.date],
            [OPP_FIELD_KEYS.cohortVenue, data.event?.venue],
            [OPP_FIELD_KEYS.cohortAddress, data.event?.address],
            [OPP_FIELD_KEYS.cohortTime, data.event?.time],
          ];
          for (const [key, value] of cohortPairs) {
            if (value) oppCustomFields.push({ key, field_value: value });
          }

          const opp = (await ghlFetch("/opportunities/", {
            method: "POST",
            body: JSON.stringify({
              locationId: GHL_LOCATION_ID,
              pipelineId: pipeline.id,
              pipelineStageId: stageId,
              name: `${data.firstName} ${data.lastName} — ${tierLabel} (${data.city})`,
              status: "open",
              monetaryValue: data.amount,
              contactId,
              customFields: oppCustomFields,
            }),
          })) as { opportunity?: { id?: string }; id?: string };
          opportunityId = (opp.opportunity && opp.opportunity.id) || opp.id || undefined;
        }
      } catch (err) {
        console.warn("GHL opportunity create skipped:", (err as Error).message);
      }
    }

    return { ok: true, contactId, opportunityId, tags };
  });

// ============== 2-way sync helpers ==============

type GhlCustomFieldDef = {
  id: string;
  name: string;
  fieldKey?: string;
  dataType?: string;
};

type GhlContactSnapshot = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  customFields: Array<{ id: string; value: string }>;
};

const lookupSchema = z.object({ email: z.string().email().max(200) });

function readTicketNumber(value: unknown): number {
  const match = String(value ?? "").match(/\d+/);
  const qty = match ? Number(match[0]) : 0;
  return Number.isFinite(qty) ? Math.min(Math.max(Math.trunc(qty), 0), 20) : 0;
}

function readCustomFieldValue(field: {
  value?: unknown;
  fieldValueString?: unknown;
  fieldValue?: unknown;
  field_value?: unknown;
}): unknown {
  return field.value ?? field.fieldValueString ?? field.fieldValue ?? field.field_value ?? "";
}

function isTicketQuantityField(meta?: { name?: string; key?: string }): boolean {
  const key = bareFieldKey(meta?.key ?? "").toLowerCase();
  const label = `${key} ${meta?.name ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return (
    key === FIELD_KEYS.ticketQuantity ||
    key === FIELD_KEYS.ticketQuantityLegacy ||
    key === FIELD_KEYS.ticketQuantityLegacy2 ||
    key === FIELD_KEYS.ticketQuantityLegacy3 ||
    label.includes("sp_no_of_ticket_purchased") ||
    label.includes("ticket_quantity") ||
    (label.includes("ticket") && label.includes("purchased"))
  );
}

function getInlineFieldMeta(field: unknown): { name?: string; key?: string } | undefined {
  if (!field || typeof field !== "object") return undefined;
  const record = field as Record<string, unknown>;
  const key = record.key ?? record.fieldKey ?? record.field_key;
  const name = record.name ?? record.fieldName ?? record.field_name;
  return {
    key: typeof key === "string" ? key : undefined,
    name: typeof name === "string" ? name : undefined,
  };
}

function readTicketNumberFromText(value: unknown): number {
  const text = String(value ?? "");
  const ticketMatch = text.match(/(\d+)\s*tickets?\b/i);
  if (ticketMatch) return readTicketNumber(ticketMatch[1]);
  return /single\s*ticket|1\s*ticket\s*only/i.test(text) ? 1 : 0;
}

function readTicketNumberFromAmount(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const normalized = amount > 10000 ? amount / 100 : amount;
  const match = GA_PRICE_TIERS.find((tier) => Math.abs(tier.price - normalized) <= 10);
  return match?.qty ?? 0;
}

function readTicketNumberFromRecord(value: unknown): number {
  let best = readTicketNumberFromText(value);
  const seen = new Set<unknown>();
  const scan = (node: unknown, keyHint = "") => {
    if (node === null || node === undefined || seen.has(node)) return;
    if (typeof node === "string" || typeof node === "number") {
      best = Math.max(best, readTicketNumberFromText(node));
      if (/amount|monetary|price|subtotal|total|value/i.test(keyHint)) {
        best = Math.max(best, readTicketNumberFromAmount(node));
      }
      return;
    }
    if (typeof node !== "object") return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) scan(item, keyHint);
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) scan(child, key);
  };
  scan(value);
  return best;
}

function paymentLookupPaths(contactId: string, email: string): string[] {
  const paths: string[] = [];
  if (contactId) {
    paths.push(
      `/payments/orders?altId=${GHL_LOCATION_ID}&altType=location&contactId=${encodeURIComponent(contactId)}&limit=20`,
    );
  }
  if (email) {
    paths.push(
      `/payments/orders?altId=${GHL_LOCATION_ID}&altType=location&email=${encodeURIComponent(email)}&limit=20`,
    );
  }
  return paths;
}

async function fetchPaymentTicketCount(contactId: string, email: string): Promise<number> {
  for (const path of paymentLookupPaths(contactId, email)) {
    try {
      const res = await ghlFetch(path, { method: "GET" });
      const n = readTicketNumberFromRecord(res);
      if (n > 0) return n;
    } catch (err) {
      console.warn(`GHL payment lookup skipped ${path}:`, (err as Error).message);
    }
  }
  return 0;
}

// Walk a /payments/orders payload and find the largest monetary amount on a
// top-level numeric field named like amount/total. GHL returns major units
// for this endpoint; we normalize cents-shaped numbers (> 10000) just in case.
function readPaymentAmountFromRecord(value: unknown): number {
  let best = 0;
  const seen = new Set<unknown>();
  const scan = (node: unknown, keyHint = "") => {
    if (node === null || node === undefined || seen.has(node)) return;
    if (typeof node === "number" || typeof node === "string") {
      if (/^(amount|amountPaid|total|subtotal|grandTotal|amountDue)$/i.test(keyHint)) {
        const n = Number(node);
        if (Number.isFinite(n) && n > 0) {
          const normalized = n > 10000 ? n / 100 : n;
          if (normalized > best) best = normalized;
        }
      }
      return;
    }
    if (typeof node !== "object") return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) scan(item, keyHint);
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) scan(v, k);
  };
  scan(value);
  return best;
}

async function fetchPaymentAmount(contactId: string, email: string): Promise<number> {
  for (const path of paymentLookupPaths(contactId, email)) {
    try {
      const res = await ghlFetch(path, { method: "GET" });
      const amt = readPaymentAmountFromRecord(res);
      if (amt > 0) return amt;
    } catch (err) {
      console.warn(`GHL payment amount lookup skipped ${path}:`, (err as Error).message);
    }
  }
  return 0;
}

// Bounded-concurrency map. Worker timeouts kill the whole listSeminarPurchasers
// call when we fan out hundreds of GHL requests in parallel via Promise.all.
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export const lookupGhlContactByEmail = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => lookupSchema.parse(d))
  .handler(async ({ data }) => {
    let fieldDefs: GhlCustomFieldDef[] = [];
    try {
      const defs = (await ghlFetch(`/locations/${GHL_LOCATION_ID}/customFields`, {
        method: "GET",
      })) as { customFields?: GhlCustomFieldDef[] };
      fieldDefs = defs.customFields ?? [];
    } catch (err) {
      console.warn("GHL field defs fetch failed:", (err as Error).message);
    }

    let contact: GhlContactSnapshot | null = null;
    try {
      const q = encodeURIComponent(data.email);
      const res = (await ghlFetch(`/contacts/?locationId=${GHL_LOCATION_ID}&query=${q}`, {
        method: "GET",
      })) as {
        contacts?: Array<{
          id: string;
          firstName?: string;
          lastName?: string;
          email?: string;
          phone?: string;
          customFields?: Array<{ id: string; value?: string; field_value?: string }>;
        }>;
      };
      const hit = res.contacts?.find((c) => c.email?.toLowerCase() === data.email.toLowerCase());
      if (hit) {
        contact = {
          id: hit.id,
          firstName: hit.firstName,
          lastName: hit.lastName,
          email: hit.email,
          phone: hit.phone,
          customFields: (hit.customFields ?? []).map((c) => ({
            id: c.id,
            value: String(c.value ?? c.field_value ?? ""),
          })),
        };
      }
    } catch (err) {
      console.warn("GHL contact lookup failed:", (err as Error).message);
    }

    return { contact, fieldDefs };
  });

// Reads a *location-level* custom value from GHL (the values configured
// under Settings → Custom Values, e.g. {{custom_values.sp2026ticket_quantity}})
// and returns the ticket quantity as a number. This is the source of truth
// for "how many tickets did this buyer purchase" — the GA payment form's
// quantity dropdown writes into this custom value.
export const getGhlTicketQuantityCustomValue = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      const res = (await ghlFetch(`/locations/${GHL_LOCATION_ID}/customValues`, {
        method: "GET",
      })) as {
        customValues?: Array<{ id: string; name?: string; fieldKey?: string; value?: string }>;
      };
      const list = res.customValues ?? [];
      const target = list.find((v) => {
        const key = `${v.fieldKey ?? ""} ${v.name ?? ""}`.toLowerCase();
        return (
          key.includes("sp2026ticket_quantity") ||
          key.includes("sp2026_ticket_quantity") ||
          key.includes("ticket_quantity")
        );
      });
      const raw = target?.value ?? "";
      const match = String(raw).match(/\d+/);
      const qty = match ? Number(match[0]) : 1;
      return { quantity: Math.min(Math.max(qty, 1), 20), raw, found: Boolean(target) };
    } catch (err) {
      console.warn("GHL location custom value fetch failed:", (err as Error).message);
      return { quantity: 1, raw: "", found: false };
    }
  },
);

export const getGhlTicketQuantityByEmail = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => lookupSchema.parse(d))
  .handler(async ({ data }) => {
    try {
      const contactRes = (await ghlFetch(
        `/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(data.email)}`,
        { method: "GET" },
      )) as {
        contacts?: Array<{
          id?: string;
          email?: string;
          customFields?: Array<{ id?: string; value?: unknown; field_value?: unknown }>;
        }>;
      };
      const contact = contactRes.contacts?.find(
        (c) => c.email?.toLowerCase() === data.email.toLowerCase(),
      );
      if (!contact?.id) return { quantity: 1, raw: "", found: false };
      const contactId = contact.id;

      let contactFields = contact.customFields ?? [];
      try {
        const detailRes = (await ghlFetch(`/contacts/${contactId}`, { method: "GET" })) as {
          contact?: {
            customFields?: Array<{ id?: string; value?: unknown; field_value?: unknown }>;
          };
        };
        contactFields = detailRes.contact?.customFields ?? contactFields;
      } catch (err) {
        console.warn("GHL contact detail lookup failed:", (err as Error).message);
      }

      // 1. Read contact custom fields FIRST — the GHL workflow writes
      // {{contact.sp_no_of_ticket_purchased}} immediately after purchase.
      const contactMeta = await getFieldMeta();
      const contactTicketIds = new Set(
        [...contactMeta.entries()]
          .filter(([, m]) => isTicketQuantityField(m))
          .map(([id]) => id),
      );
      let fieldQty = 0;
      let raw = "";
      for (const field of contactFields) {
        const isKnownTicketField = Boolean(field.id && contactTicketIds.has(field.id));
        const isInlineTicketField = isTicketQuantityField(getInlineFieldMeta(field));
        if (!isKnownTicketField && !isInlineTicketField) continue;
        const value = readCustomFieldValue(field);
        const qty = readTicketNumber(value);
        if (qty > fieldQty) {
          fieldQty = qty;
          raw = String(value ?? "");
        }
      }
      if (fieldQty > 1) return { quantity: fieldQty, raw, found: true };

      // 2. Fallback: opportunity fields (legacy path)
      const oppMeta = await getFieldMeta("opportunity");
      const opportunityTicketKeys = new Set<string>([
        OPP_FIELD_KEYS.ticketsPurchased,
        OPP_FIELD_KEYS.ticketsPurchasedLegacy,
      ]);
      const ticketFieldIds = new Set(
        [...oppMeta.entries()]
          .filter(([, m]) => opportunityTicketKeys.has(m.key) || isTicketQuantityField(m))
          .map(([id]) => id),
      );
      const oppRes = (await ghlFetch(
        `/opportunities/search?location_id=${GHL_LOCATION_ID}&contact_id=${contactId}`,
        { method: "GET" },
      )) as {
        opportunities?: Array<{
          name?: string;
          monetaryValue?: number | string;
          customFields?: Array<{
            id?: string;
            value?: unknown;
            fieldValueString?: unknown;
            fieldValue?: unknown;
            field_value?: unknown;
          }>;
        }>;
      };

      let fallbackQty = 0;
      for (const opportunity of oppRes.opportunities ?? []) {
        fallbackQty = Math.max(
          fallbackQty,
          readTicketNumberFromText(opportunity.name),
          readTicketNumberFromAmount(opportunity.monetaryValue),
          readTicketNumberFromRecord(opportunity),
        );
        for (const field of opportunity.customFields ?? []) {
          if (ticketFieldIds.size > 0 && (!field.id || !ticketFieldIds.has(field.id))) continue;
          const value = readCustomFieldValue(field);
          const qty = readTicketNumber(value);
          if (qty > fallbackQty) {
            fallbackQty = qty;
            raw = String(value ?? "");
          }
        }
      }
      if (fallbackQty > 1) return { quantity: fallbackQty, raw: String(fallbackQty), found: true };

      // 3. Last fallback: payment records
      const paymentQty = await fetchPaymentTicketCount(contactId, data.email);
      if (paymentQty > 1) return { quantity: paymentQty, raw: String(paymentQty), found: true };

      return { quantity: 1, raw: "", found: false };
    } catch (err) {
      console.warn("GHL ticket quantity lookup failed:", (err as Error).message);
      return { quantity: 1, raw: "", found: false };
    }
  });

const pushSchema = z.object({
  contactId: z.string().min(1).max(100),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  customFields: z
    .array(z.object({ id: z.string().min(1).max(100), value: z.string().max(2000) }))
    .max(50)
    .optional(),
});

export const pushGhlContactUpdate = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => pushSchema.parse(d))
  .handler(async ({ data }) => {
    const body: Record<string, unknown> = {};
    if (data.firstName !== undefined) body.firstName = data.firstName;
    if (data.lastName !== undefined) body.lastName = data.lastName;
    if (data.phone !== undefined) body.phone = data.phone;
    if (data.customFields && data.customFields.length > 0) {
      body.customFields = data.customFields.map((c) => ({
        id: c.id,
        field_value: c.value,
      }));
    }
    const res = (await ghlFetch(`/contacts/${data.contactId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    })) as {
      contact?: {
        id: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string;
        customFields?: Array<{ id: string; value?: string; field_value?: string }>;
      };
    };
    const c = res.contact;
    return {
      ok: true,
      contact: c
        ? ({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            phone: c.phone,
            customFields: (c.customFields ?? []).map((f) => ({
              id: f.id,
              value: String(f.value ?? f.field_value ?? ""),
            })),
          } as GhlContactSnapshot)
        : null,
    };
  });

// ============== Products & pricing ==============

export type GhlPrice = {
  id: string;
  name: string;
  amount: number; // major units (e.g. dollars)
  currency: string;
  type: string; // "one_time" | "recurring"
};

export type GhlProduct = {
  id: string;
  name: string;
  description: string;
  prices: GhlPrice[];
};

type RawProduct = { _id?: string; id?: string; name?: string; description?: string };
type RawPrice = {
  _id?: string;
  id?: string;
  name?: string;
  amount?: number;
  currency?: string;
  type?: string;
};

// Fetch this location's products and their prices so the UI can render live
// pricing instead of hardcoded values. Best-effort: returns [] on any failure
// so the checkout always falls back to its built-in prices.
// Only these products feed the checkout, so we fetch prices for them alone
// (the location has many products and per-product price calls hit rate limits).
const RELEVANT_PRODUCT = /vip|general|admission|\bga\b/i;

// Cache results so repeated page loads don't re-hit GHL (tight rate limits).
let productsCache: { at: number; data: GhlProduct[] } | null = null;
const PRODUCTS_TTL_MS = 5 * 60 * 1000;

export const listGhlProducts = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ products: GhlProduct[] }> => {
    if (productsCache && Date.now() - productsCache.at < PRODUCTS_TTL_MS) {
      return { products: productsCache.data };
    }
    try {
      const res = (await ghlFetch(`/products/?locationId=${GHL_LOCATION_ID}&limit=100`, {
        method: "GET",
      })) as { products?: RawProduct[] };
      const raw = (res.products ?? []).filter((p) => RELEVANT_PRODUCT.test(p.name ?? ""));

      const products = await Promise.all(
        raw.map(async (p): Promise<GhlProduct> => {
          const productId = p._id ?? p.id ?? "";
          let prices: GhlPrice[] = [];
          try {
            const pr = (await ghlFetch(
              `/products/${productId}/price?locationId=${GHL_LOCATION_ID}&limit=100`,
              { method: "GET" },
            )) as { prices?: RawPrice[] };
            prices = (pr.prices ?? []).map((x) => ({
              id: x._id ?? x.id ?? "",
              name: x.name ?? "",
              // GHL returns price amounts in major units already for these endpoints.
              amount: typeof x.amount === "number" ? x.amount : 0,
              currency: x.currency ?? "USD",
              type: x.type ?? "one_time",
            }));
          } catch (err) {
            console.warn(
              `GHL prices fetch failed for product ${productId}:`,
              (err as Error).message,
            );
          }
          return {
            id: productId,
            name: p.name ?? "",
            description: p.description ?? "",
            prices,
          };
        }),
      );

      productsCache = { at: Date.now(), data: products };
      return { products };
    } catch (err) {
      console.warn("GHL products fetch failed:", (err as Error).message);
      // Serve the last good data (even if stale) rather than dropping prices.
      if (productsCache) return { products: productsCache.data };
      return { products: [] };
    }
  },
);

// ============== Post-purchase attendees ==============

// Each ticket becomes its own attendee contact, collected on the confirmation
// page after payment (when the real ticket count is known).
const addAttendeesSchema = z.object({
  city: z
    .string()
    .max(50)
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : "boston")),
  tier: z.enum(["ga", "vip"]),
  // ISO end date (YYYY-MM-DD); falls back to the slug's default if omitted.
  endDate: z.string().max(20).optional(),
  attendees: z.array(attendeeSchema).min(1).max(20),
  // The buyer these attendees belong to — so we can persist a running
  // "attendees added" count on the buyer for the admin's remaining counter.
  buyerContactId: z.string().max(100).optional(),
});

export const addAttendeesToGhl = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => addAttendeesSchema.parse(d))
  .handler(async ({ data }) => {
    // One centralized tag (🤝 s&p-{city}-{yymmdd}) — same as the buyer.
    // Buyer-vs-attendee is told apart by the contact `source`, not a tag.
    const tags = [eventTag(data.city, data.endDate)];
    const results = await Promise.allSettled(
      data.attendees
        .filter((a) => a.email)
        .map((a) =>
          ghlFetch("/contacts/upsert", {
            method: "POST",
            body: JSON.stringify({
              locationId: GHL_LOCATION_ID,
              firstName: a.firstName,
              lastName: a.lastName,
              email: a.email,
              tags,
              source: "Scale & Profit Seminar Attendee",
            }),
          }),
        ),
    );
    const saved = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - saved;

    // Persist the running added-count on the buyer so the "remaining" counter
    // survives reloads. Best-effort: skipped silently if the field/contact is
    // missing. (Requires the sp_attendees_added contact field to exist in GHL.)
    if (data.buyerContactId && saved > 0) {
      try {
        const { attendeesAdded } = await resolveBuyerCounts(data.buyerContactId);
        await ghlFetch(`/contacts/${data.buyerContactId}`, {
          method: "PUT",
          body: JSON.stringify({
            customFields: [
              { key: FIELD_KEYS.attendeesAdded, field_value: String(attendeesAdded + saved) },
            ],
          }),
        });
      } catch (err) {
        console.warn("GHL attendees-added increment failed:", (err as Error).message);
      }
    }
    return { ok: failed === 0, saved, failed };
  });

// ============== Admin: purchasers / attendees ==============

// Legacy umbrella tag. New contacts no longer get it (they carry only the single
// 🤝 s&p-{city}-{yymmdd} event tag), but the admin still searches it so contacts
// tagged before the consolidation keep showing up.
const SEMINAR_TAG = "scale-profit-seminar";

export type PurchaserCustomField = {
  id: string;
  key: string;
  label: string;
  value: string;
};

// One row in the admin Attendees table. Built entirely from the tag-search
// result — event + tier come from tags, amount from the contact's opportunity —
// so the list needs no per-contact calls. Survey answers / custom fields are
// fetched lazily per contact via getPurchaserDetail when a row is opened.
export type SeminarPurchaser = {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string;
  state: string;
  tags: string[];
  eventSlug: string; // best-effort event identifier (city slug) or "" if unknown
  tier: string; // "VIP" | "General Admission" | ""
  ticketQuantity: number;
  attendeesAdded: number; // additional attendees already registered for this buyer
  amount: number;
  source: string;
  isAttendee: boolean;
  dateAdded: string;
};

// Full detail for one contact's popup — requires a per-contact fetch because
// GHL's contact-search endpoint never returns custom field values.
export type PurchaserDetail = {
  // Real ticket count if the payment form has populated the field; else 0.
  ticketQuantity: number;
  attendeesAdded: number; // additional attendees already registered for this buyer
  answers: {
    agencyState: string;
    hasMoa: string;
    attendedBefore: string;
    shirtSize: string;
  };
  customFields: PurchaserCustomField[];
};

type RawSearchContact = {
  id?: string;
  contactId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  state?: string;
  source?: string;
  dateAdded?: string;
  tags?: string[];
  opportunities?: Array<{ monetaryValue?: number; name?: string }>;
};

// GHL field keys come back as `contact.<key>` / `opportunity.<key>`; compare bare keys.
function bareFieldKey(key: string): string {
  return key.replace(/^(contact|opportunity)\./, "");
}

// Work out which event a contact belongs to, from the single event tag
// `🤝 s&p-{slug}-{yymmdd}`. Also tolerates legacy tags (`s&p-{slug}-{YYYY-MM-DD}`,
// `scale-profit-{slug}`) so contacts tagged before the consolidation still map.
function deriveEventSlug(tags: string[]): string {
  const reserved = new Set(["seminar", "ga", "vip", "attendee"]);
  for (const t of tags) {
    const eventMatch = t.match(/s&p-([a-z0-9-]+?)-(?:\d{6}|\d{4}-\d{2}-\d{2})$/i);
    if (eventMatch) return eventMatch[1].toLowerCase();
    const buyerMatch = t.match(/^scale-profit-([a-z0-9-]+)$/i);
    if (buyerMatch && !reserved.has(buyerMatch[1].toLowerCase())) {
      return buyerMatch[1].toLowerCase();
    }
  }
  return "";
}

// Tier is the product they purchased (GA/VIP), not a tag. Read it from the
// opportunity name (`… — VIP (city)` / `… — General Admission (city)`), falling
// back to legacy `scale-profit-vip|ga` tags for pre-consolidation contacts.
function deriveTier(tags: string[], opportunities?: Array<{ name?: string }>): string {
  for (const o of opportunities ?? []) {
    const n = (o.name ?? "").toLowerCase();
    if (/\bvip\b/.test(n)) return "VIP";
    if (/general admission/.test(n)) return "General Admission";
  }
  if (tags.some((t) => /^scale-profit-vip$/i.test(t))) return "VIP";
  if (tags.some((t) => /^scale-profit-ga$/i.test(t))) return "General Admission";
  return "";
}

// Cache custom-field definitions per model (id → name + key); used to map a
// contact's / opportunity's custom field ids to human labels + keys.
const fieldMetaCache = new Map<
  string,
  { at: number; map: Map<string, { name: string; key: string }> }
>();
async function getFieldMeta(
  model: "contact" | "opportunity" = "contact",
): Promise<Map<string, { name: string; key: string }>> {
  const cached = fieldMetaCache.get(model);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.map;

  const map = new Map<string, { name: string; key: string }>();
  try {
    const suffix = model === "opportunity" ? "?model=opportunity" : "";
    const defs = (await ghlFetch(`/locations/${GHL_LOCATION_ID}/customFields${suffix}`, {
      method: "GET",
    })) as { customFields?: GhlCustomFieldDef[] };
    for (const f of defs.customFields ?? []) {
      map.set(f.id, { name: f.name, key: bareFieldKey(f.fieldKey ?? "") });
    }
    fieldMetaCache.set(model, { at: Date.now(), map });
  } catch (err) {
    console.warn(`GHL ${model} field defs fetch failed:`, (err as Error).message);
  }
  return map;
}

// Reads the ticket count from a contact's opportunity custom field
// ({{opportunity.sp_no_of_ticket_purchased}}). Returns 0 if not set.
async function fetchOpportunityTicketCount(contactId: string, email = ""): Promise<number> {
  const oppMeta = await getFieldMeta("opportunity");
  let ticketFieldId = "";
  for (const [id, m] of oppMeta) {
    if (
      m.key === OPP_FIELD_KEYS.ticketsPurchased ||
      m.key === OPP_FIELD_KEYS.ticketsPurchasedLegacy
    ) {
      ticketFieldId = id;
      break;
    }
  }
  try {
    const res = (await ghlFetch(
      `/opportunities/search?location_id=${GHL_LOCATION_ID}&contact_id=${contactId}`,
      { method: "GET" },
    )) as {
      opportunities?: Array<{
        name?: string;
        monetaryValue?: number | string;
        customFields?: Array<{
          id?: string;
          fieldValueString?: string;
          fieldValue?: unknown;
          field_value?: unknown;
        }>;
      }>;
    };
    let best = 0;
    for (const o of res.opportunities ?? []) {
      best = Math.max(
        best,
        readTicketNumberFromText(o.name),
        readTicketNumberFromAmount(o.monetaryValue),
        readTicketNumberFromRecord(o),
      );
      for (const f of o.customFields ?? []) {
        if (ticketFieldId && f.id !== ticketFieldId) continue;
        const raw = readCustomFieldValue(f);
        const n = readTicketNumber(raw);
        if (Number.isFinite(n) && n > best) best = n;
      }
    }
    if (best <= 1 && email) best = Math.max(best, await fetchPaymentTicketCount(contactId, email));
    return best;
  } catch (err) {
    console.warn("GHL opportunity fetch failed:", (err as Error).message);
    return 0;
  }
}

// Single source of truth for a buyer's counts — tickets purchased AND how many
// additional attendees have already been registered — used by BOTH the Attendees
// table and the detail dialog so their numbers always match. The contacts/search
// endpoint doesn't return custom field values, so this does one per-contact GET.
async function resolveBuyerCounts(
  contactId: string,
  email = "",
): Promise<{ ticketQuantity: number; attendeesAdded: number }> {
  if (!contactId) return { ticketQuantity: 0, attendeesAdded: 0 };
  let contactQty = 0;
  let attendeesAdded = 0;
  try {
    const fieldMeta = await getFieldMeta();
    const res = (await ghlFetch(`/contacts/${contactId}`, { method: "GET" })) as {
      contact?: {
        customFields?: Array<{ id?: string; value?: unknown; field_value?: unknown }>;
      };
    };
    const valueOf = (key: string) => {
      for (const f of res.contact?.customFields ?? []) {
        if (f.id && fieldMeta.get(f.id)?.key === key) {
          const v = f.value ?? f.field_value ?? "";
          return Array.isArray(v) ? v.join(", ") : String(v);
        }
      }
      return "";
    };
    contactQty = Number.parseInt(
      valueOf(FIELD_KEYS.ticketQuantity) ||
        valueOf(FIELD_KEYS.ticketQuantityLegacy) ||
        valueOf(FIELD_KEYS.ticketQuantityLegacy2) ||
        valueOf(FIELD_KEYS.ticketQuantityLegacy3),
      10,
    );
    attendeesAdded = Number.parseInt(valueOf(FIELD_KEYS.attendeesAdded), 10);
  } catch (err) {
    console.warn("GHL contact count lookup failed:", (err as Error).message);
  }
  // The contact field is authoritative (written for every tier at checkout); use
  // it directly to avoid an extra opportunity+order lookup. Only fall back to the
  // opportunity/order count for legacy contacts missing the field.
  const ticketQuantity =
    Number.isFinite(contactQty) && contactQty > 0
      ? contactQty
      : await fetchOpportunityTicketCount(contactId, email);
  return {
    ticketQuantity,
    attendeesAdded: Number.isFinite(attendeesAdded) && attendeesAdded > 0 ? attendeesAdded : 0,
  };
}

function assertAdmin(password: string) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new Error("ADMIN_PASSWORD is not configured on the server.");
  if (password.trim() !== expected.trim()) throw new Error("Unauthorized: incorrect password.");
}

const purchasersInputSchema = z.object({ password: z.string().min(1).max(200) });

// Lists everyone tagged into a Scale & Profit event (buyers + attendees) for the
// admin Attendees tab, grouped client-side by event. Password-gated server-side
// because it returns contact PII.
export const listSeminarPurchasers = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => purchasersInputSchema.parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);

    // Fast path: query legacy / ASCII tags only. NEVER send the 🤝 emoji tag as a
    // search value — GHL's search 400s on it ("Error occurred while searching").
    // The 🤝-tagged contacts are caught by the contact scan below instead.
    const searchTags = [
      SEMINAR_TAG, // scale-profit-seminar (legacy umbrella)
      ...DEFAULT_EVENTS.flatMap((e) => [
        eventTag(e.slug, e.end_date).replace(/^🤝\s*/, ""), // s&p-{city}-{yymmdd}
        `scale-profit-${e.slug}`, // legacy per-city tag
      ]),
    ];
    const byId = new Map<string, RawSearchContact>();
    let searchError: string | null = null;
    const pageLimit = 100;
    // Each tag is queried independently so one failing tag (e.g. an emoji tag
    // GHL can't match) can't abort the others and wipe the whole list.
    for (const tag of searchTags) {
      try {
        for (let page = 1; page <= 20; page++) {
          const res = (await ghlFetch("/contacts/search", {
            method: "POST",
            body: JSON.stringify({
              locationId: GHL_LOCATION_ID,
              page,
              pageLimit,
              filters: [{ field: "tags", operator: "contains", value: tag }],
            }),
          })) as { contacts?: RawSearchContact[] };
          const batch = res.contacts ?? [];
          for (const c of batch) {
            const id = String(c.id ?? c.contactId ?? "");
            if (id) byId.set(id, c);
          }
          if (batch.length < pageLimit) break;
        }
      } catch (err) {
        searchError = (err as Error).message;
        console.warn(`GHL purchaser search failed for tag "${tag}":`, searchError);
      }
    }

    // GHL's tag-search can't reliably match the 🤝 emoji tag, so also page through
    // contacts and keep any that are Scale & Profit purchasers — identified by an
    // S&P tag OR by the source of the checkout forms (S&P-GenAd / S&P-vip / "Scale
    // & Profit …"). Source-matching catches purchases that weren't auto-tagged;
    // they show under "Unassigned" until the admin assigns them to an event.
    // Bounded so a large location can't time out the worker.
    const SP_TAG_RE = /s&p-|scale-profit/i;
    const SP_SOURCE_RE = /s&p|scale.?profit/i;
    try {
      for (let page = 1; page <= 30; page++) {
        const res = (await ghlFetch("/contacts/search", {
          method: "POST",
          // filters: [] returns the whole location (GHL 400s if the key is absent).
          body: JSON.stringify({ locationId: GHL_LOCATION_ID, page, pageLimit, filters: [] }),
        })) as { contacts?: RawSearchContact[] };
        const batch = res.contacts ?? [];
        for (const c of batch) {
          const tags = (c.tags ?? []).map((t) => String(t));
          const isSp = tags.some((t) => SP_TAG_RE.test(t)) || SP_SOURCE_RE.test(c.source ?? "");
          if (!isSp) continue;
          const id = String(c.id ?? c.contactId ?? "");
          if (id) byId.set(id, c);
        }
        if (batch.length < pageLimit) break;
      }
    } catch (err) {
      console.warn("GHL broad contact scan failed:", (err as Error).message);
    }

    const rawContacts = [...byId.values()];

    // Base row built from the search result alone — no extra GHL calls, so these
    // ALWAYS render even if the per-buyer enrichment below fails or times out.
    const baseRow = (c: RawSearchContact): SeminarPurchaser => {
      const tags = (c.tags ?? []).map((t) => String(t));
      const isAttendee =
        (c.source ?? "").toLowerCase().includes("attendee") ||
        tags.includes("scale-profit-attendee");
      const oppAmount = (c.opportunities ?? []).reduce(
        (m, o) => Math.max(m, Number(o.monetaryValue) || 0),
        0,
      );
      return {
        id: String(c.id ?? c.contactId ?? ""),
        firstName: c.firstName ?? "",
        lastName: c.lastName ?? "",
        name: [c.firstName, c.lastName].filter(Boolean).join(" ").trim(),
        email: c.email ?? "",
        phone: c.phone ?? "",
        state: c.state ?? "",
        tags,
        eventSlug: deriveEventSlug(tags),
        tier: deriveTier(tags, c.opportunities),
        ticketQuantity: 1,
        attendeesAdded: 0,
        amount: oppAmount,
        source: c.source ?? "",
        isAttendee,
        dateAdded: c.dateAdded ?? "",
      };
    };

    // Best-effort enrichment: real paid amount + ticket count + attendees-added
    // per buyer. Any failure (or the whole step) falls back to the base rows so
    // purchasers always show.
    let purchasers: SeminarPurchaser[];
    try {
      purchasers = await mapWithConcurrency(rawContacts, 6, async (c) => {
        const row = baseRow(c);
        if (row.isAttendee || !row.id) return row;
        const [paid, counts] = await Promise.all([
          fetchPaymentAmount(row.id, row.email).catch(() => 0),
          resolveBuyerCounts(row.id, row.email).catch(() => ({ ticketQuantity: 0, attendeesAdded: 0 })),
        ]);
        return {
          ...row,
          amount: paid > 0 ? paid : row.amount,
          ticketQuantity: counts.ticketQuantity > 0 ? counts.ticketQuantity : row.ticketQuantity,
          attendeesAdded: counts.attendeesAdded,
        };
      });
    } catch (err) {
      console.warn("GHL purchaser enrichment failed:", (err as Error).message);
      purchasers = rawContacts.map(baseRow);
    }

    return { purchasers, error: searchError };
  });

const detailInputSchema = z.object({
  password: z.string().min(1).max(200),
  contactId: z.string().min(1).max(100),
});

// Fetches one contact's custom field values (survey answers + everything else)
// for the attendee detail popup. Separate from the list because GHL's search
// endpoint doesn't return custom field values — only a direct GET does.
export const getPurchaserDetail = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => detailInputSchema.parse(d))
  .handler(async ({ data }): Promise<PurchaserDetail> => {
    assertAdmin(data.password);
    const fieldMeta = await getFieldMeta();

    const res = (await ghlFetch(`/contacts/${data.contactId}`, { method: "GET" })) as {
      contact?: {
        email?: string;
        state?: string;
        customFields?: Array<{ id?: string; value?: unknown; field_value?: unknown }>;
      };
    };
    const c = res.contact ?? {};
    const fields: PurchaserCustomField[] = (c.customFields ?? []).map((f) => {
      const meta = f.id ? fieldMeta.get(f.id) : undefined;
      const value = f.value ?? f.field_value ?? "";
      return {
        id: String(f.id ?? ""),
        key: meta?.key ?? "",
        label: meta?.name || meta?.key || String(f.id ?? ""),
        value: Array.isArray(value) ? value.join(", ") : String(value),
      };
    });
    const valueOf = (key: string) => fields.find((x) => x.key === key)?.value ?? "";

    // Ticket count: prefer the contact field set by the GHL workflow
    // ({{contact.sp_no_of_ticket_purchased}}), fall back to opportunity / legacy fields.
    const contactQty = Number.parseInt(
      valueOf(FIELD_KEYS.ticketQuantity) ||
      valueOf(FIELD_KEYS.ticketQuantityLegacy) ||
      valueOf(FIELD_KEYS.ticketQuantityLegacy2) ||
      valueOf(FIELD_KEYS.ticketQuantityLegacy3),
      10,
    );
    const oppTickets = await fetchOpportunityTicketCount(data.contactId, c.email ?? "");
    const attendeesAdded = Number.parseInt(valueOf(FIELD_KEYS.attendeesAdded), 10);

    return {
      ticketQuantity: Number.isFinite(contactQty) && contactQty > 0 ? contactQty : oppTickets,
      attendeesAdded: Number.isFinite(attendeesAdded) && attendeesAdded > 0 ? attendeesAdded : 0,
      answers: {
        // Agency state lives in the native contact State field.
        agencyState: c.state ?? "",
        hasMoa: valueOf(FIELD_KEYS.hasMoa),
        attendedBefore: valueOf(FIELD_KEYS.attendedBefore),
        shirtSize: valueOf(FIELD_KEYS.shirtSize),
      },
      customFields: fields.filter((x) => x.value),
    };
  });

const assignSchema = z.object({
  password: z.string().min(1).max(200),
  contactIds: z.array(z.string().min(1).max(100)).min(1).max(200),
  city: z.string().min(1).max(50),
  // ISO end date (YYYY-MM-DD); falls back to the slug's seeded date if omitted.
  endDate: z.string().max(20).optional(),
});

// Bulk-assign contacts to an event by adding the single centralized event tag
// (🤝 s&p-{city}-{yymmdd}). Used by the admin to move "Unassigned" purchasers
// into a city. Adds the tag without removing existing tags.
export const assignContactsToEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => assignSchema.parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const tags = [eventTag(data.city, data.endDate)];
    const results = await mapWithConcurrency(data.contactIds, 6, async (id) => {
      try {
        await ghlFetch(`/contacts/${id}/tags`, {
          method: "POST",
          body: JSON.stringify({ tags }),
        });
        return true;
      } catch (err) {
        console.warn(`GHL tag-assign failed for ${id}:`, (err as Error).message);
        return false;
      }
    });
    const assigned = results.filter(Boolean).length;
    return { ok: assigned === data.contactIds.length, assigned, failed: data.contactIds.length - assigned };
  });

const tagBuyerSchema = z.object({
  email: z.string().email().max(200),
  city: z.string().min(1).max(50),
  // Survey answers from checkout (bridged via the buyer's browser), saved to the
  // contact so the admin card can show them.
  survey: z
    .object({
      agencyState: z.string().max(100).optional(),
      hasMoa: z.string().max(50).optional(),
      attendedBefore: z.string().max(50).optional(),
      shirtSize: z.string().max(50).optional(),
    })
    .optional(),
});

// Finalizes a purchase from the confirmation page (GHL redirects there with
// {{contact.email}} + {{contact.event_city}}): adds the SINGLE event tag
// 🤝 s&p-{city}-{yymmdd} and saves the checkout survey answers to the contact.
// This is the one and only place a buyer is tagged. Additive — never removes
// existing tags, and re-running it just re-applies the same tag (no duplicate).
export const tagBuyerForEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tagBuyerSchema.parse(d))
  .handler(async ({ data }) => {
    const tag = eventTag(data.city);
    const s = data.survey;
    // Upsert by email to resolve the contact id and (optionally) save the survey
    // answers — agency state to the native State field, the rest to custom
    // fields. No tags here so existing tags aren't disturbed.
    const up = (await ghlFetch("/contacts/upsert", {
      method: "POST",
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        email: data.email,
        ...(s?.agencyState ? { state: s.agencyState } : {}),
        ...(s
          ? {
              customFields: [
                ...(s.hasMoa ? [{ key: FIELD_KEYS.hasMoa, field_value: s.hasMoa }] : []),
                ...(s.attendedBefore
                  ? [{ key: FIELD_KEYS.attendedBefore, field_value: s.attendedBefore }]
                  : []),
                ...(s.shirtSize ? [{ key: FIELD_KEYS.shirtSize, field_value: s.shirtSize }] : []),
              ],
            }
          : {}),
      }),
    })) as { contact?: { id?: string }; id?: string };
    const contactId = up.contact?.id ?? up.id;
    if (!contactId) return { ok: false, tag };
    await ghlFetch(`/contacts/${contactId}/tags`, {
      method: "POST",
      body: JSON.stringify({ tags: [tag] }),
    });
    return { ok: true, tag };
  });

// ============== VIP ticket caps ==============

// Per-event VIP purchase limit (slug → max VIP tickets). Only events listed here
// are capped; everything else is unlimited.
export const VIP_LIMITS: Record<string, number> = { nashville: 20 };

// Per-event GHL location *custom value* that tracks VIP purchases. A GHL workflow
// increments it on each VIP purchase, so despite the "remaining" name it actually
// holds the SOLD count — the source of truth (no contact scanning). Nashville only.
const VIP_SOLD_VALUE_KEYS: Record<string, string> = {
  nashville: "sp_nashville_vip_ticket_remaining",
};

// Read the VIP *sold* custom value for an event. Returns null if the city has no
// configured value or it can't be read. Cached briefly (checkout/landing hit this
// on load).
let vipSoldCache: { at: number; data: Record<string, number> } | null = null;
const VIP_SOLD_TTL_MS = 60 * 1000;

async function readVipSold(city: string): Promise<number | null> {
  const slug = city.toLowerCase();
  const key = VIP_SOLD_VALUE_KEYS[slug];
  if (!key) return null;
  if (vipSoldCache && Date.now() - vipSoldCache.at < VIP_SOLD_TTL_MS && slug in vipSoldCache.data) {
    return vipSoldCache.data[slug];
  }
  try {
    const res = (await ghlFetch(`/locations/${GHL_LOCATION_ID}/customValues`, {
      method: "GET",
    })) as {
      customValues?: Array<{ name?: string; fieldKey?: string; value?: string }>;
    };
    const target = (res.customValues ?? []).find((v) => {
      const k = `${v.fieldKey ?? ""} ${v.name ?? ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      return k.includes(key.toLowerCase());
    });
    if (!target) return null;
    const m = String(target.value ?? "").match(/-?\d+/);
    if (!m) return null;
    const sold = Number(m[0]);
    vipSoldCache = { at: Date.now(), data: { ...(vipSoldCache?.data ?? {}), [slug]: sold } };
    return sold;
  } catch (err) {
    console.warn("GHL VIP custom-value fetch failed:", (err as Error).message);
    return null;
  }
}

export type VipAvailability = {
  limited: boolean;
  limit: number;
  sold: number;
  remaining: number;
  soldOut: boolean;
};

const vipAvailInputSchema = z.object({ city: z.string().min(1).max(50) });

// Public: how many VIP tickets are left for an event, from the GHL custom value
// {{custom_values.sp_nashville_vip_ticket_remaining}}. Used by checkout + landing
// to disable VIP once it hits 0, and by the admin to show availability.
export const getVipAvailability = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => vipAvailInputSchema.parse(d))
  .handler(async ({ data }): Promise<VipAvailability> => {
    const limit = VIP_LIMITS[data.city.toLowerCase()] ?? 0;
    if (!limit) return { limited: false, limit: 0, sold: 0, remaining: 0, soldOut: false };
    const soldValue = await readVipSold(data.city);
    // If the custom value can't be read, don't block sales — treat as available.
    if (soldValue === null) {
      return { limited: true, limit, sold: 0, remaining: limit, soldOut: false };
    }
    const sold = Math.min(Math.max(soldValue, 0), limit);
    const remaining = Math.max(limit - sold, 0);
    return { limited: true, limit, sold, remaining, soldOut: remaining <= 0 };
  });

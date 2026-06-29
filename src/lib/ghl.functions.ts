import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DEFAULT_EVENTS, getTodayISO, splitEvents, type EventRow } from "./events";

const GHL_LOCATION_ID = "mVdYbXfJcF10Y7anuoNt";
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

// ===== The one tag =====
// Every buyer + attendee carries a single tag identifying the TIER + event + date:
//   🤝 s&p-{tier}-{city}-{yymmdd}   e.g. "🤝 s&p-vip-nashville-260806"
// Tier is "ga" | "vip", so per-tier counts can be read straight off the tag.
// (Legacy contacts carry the pre-tier tag 🤝 s&p-{city}-{yymmdd}; all parsers
// below still read those, falling back to the opportunity for tier.)
// Buyer-vs-attendee is told apart by the contact `source`, not a tag.
const EVENT_TAG_PREFIX = "🤝 s&p-";

// Multi-ticket tags, applied when the admin registers additional attendees:
// the buyer is marked a multiple-ticket buyer, each registered guest an attendee.
const MULTI_TICKET_BUYER_TAG = "🤝 s&p-multipleticket-buyer";
const ATTENDEE_TAG = "🤝 s&p-attendee";

// "2026-06-03" → "260603"; "" if the date isn't a full ISO date.
function yymmdd(isoDate?: string): string {
  const m = (isoDate ?? "").match(/^\d{2}(\d{2})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : "";
}

// Build the single event tag for a buyer/attendee. Falls back to the seeded
// events list for the end date when the caller doesn't supply one.
function eventTag(tier: "ga" | "vip", city: string, endDate?: string): string {
  const date = yymmdd(endDate || DEFAULT_EVENTS.find((e) => e.slug === city)?.end_date);
  const base = `${EVENT_TAG_PREFIX}${tier}-${city}`;
  return date ? `${base}-${date}` : base;
}

// The tier-agnostic substring shared by both the new tier-prefixed tag and the
// legacy tag (e.g. "nashville-260806"), used as a GHL "contains" search value so
// one query matches GA, VIP, and legacy tags alike. Precise event/tier filtering
// then happens in deriveEventSlug / deriveTier. (NEVER search the 🤝 emoji — GHL
// 400s on it.)
function eventTagSearchFragment(city: string, endDate?: string): string {
  const date = yymmdd(endDate || DEFAULT_EVENTS.find((e) => e.slug === city)?.end_date);
  return date ? `${city}-${date}` : city;
}

// GHL custom-field keys the checkout writes to the buyer contact. These must
// match the field keys in GHL exactly (the part after `contact.` in a merge
// tag, e.g. {{contact.do_you_have_a_moa_1}} → "do_you_have_a_moa_1").
const FIELD_KEYS = {
  eventCity: "event_city",
  ticketTier: "ticket_tier",
  orderAmount: "order_amount",
  // "Buyer" on purchase; becomes "Attendee" for registered attendees or a
  // multi-ticket buyer marked attending. → {{contact.cpsp_role}}.
  role: "cpsp_role",
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
  // so "tickets to add remaining" persists across reloads. GHL contact field
  // (number) → {{contact.cpsp_no_of_attendees_added}}; absent → treated as 0.
  attendeesAdded: "cpsp_no_of_attendees_added",
  // JSON list of the attendees registered for a buyer ({id,firstName,lastName,
  // email}), so the admin can see and individually REVOKE them. GHL contact field
  // (large/multi-line text) → {{contact.cpsp_name_of_attendees}}; absent → empty.
  attendeesList: "cpsp_name_of_attendees",
  // Whether the buyer themselves is attending (uses 1 of their tickets). "no"
  // means they bought all tickets for others. Absent → treated as attending.
  // GHL contact field (text) → {{contact.cpsp_buyer_attending}}.
  buyerAttending: "cpsp_buyer_attending",
  // For an attendee: the buyer who bought their ticket. CONTACT fields (written
  // on every attendee, no opportunity needed) so the card + emails show it
  // reliably. → {{contact.cpsp_buyer_name}} / {{contact.cpsp_buyer_email}}.
  buyerName: "cpsp_buyer_name",
  buyerEmail: "cpsp_buyer_email",
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
  // Tier purchased → {{opportunity.cpsp_ticket_tier}} ("General Admission" / "VIP").
  ticketTier: "cpsp_ticket_tier",
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
    // NOTE: the BUYER is tagged in ONE place only — tagBuyerForEvent on the
    // confirmation page (reached via GHL's redirect) — so a buyer never gets two
    // tags. We omit `tags` from the buyer upsert. Additional attendees (below) do
    // carry the single event tag, same as addAttendeesToGhl.
    const tags = [eventTag(data.tier, data.city)];

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
          // On purchase completion the contact is a Buyer. The role becomes
          // "Attendee" later — registered attendees, or a buyer marked attending.
          { key: FIELD_KEYS.role, field_value: "Buyer" },
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
            { key: OPP_FIELD_KEYS.ticketTier, field_value: tierLabel },
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
        [...contactMeta.entries()].filter(([, m]) => isTicketQuantityField(m)).map(([id]) => id),
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

// One registered attendee belonging to a buyer. Stored in the buyer's
// cpsp_name_of_attendees field — human-readable lines "First Last <email>" so the
// admin can read them in GHL. (id is only known when freshly added.)
export type AttendeeRecord = {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
};

// Render the attendee list as readable lines: "First Last <email>" — one per line.
function formatAttendeeList(list: AttendeeRecord[]): string {
  return list
    .map((a) => `${[a.firstName, a.lastName].filter(Boolean).join(" ").trim()} <${a.email}>`.trim())
    .join("\n");
}

// Parse the buyer's cpsp_name_of_attendees field. Handles the readable
// "First Last <email>" lines AND the legacy JSON array, tolerating garbage.
function parseAttendeeList(raw: string): AttendeeRecord[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  // Legacy JSON array.
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((a) => a && typeof a === "object")
          .map((a: Record<string, unknown>) => ({
            id: a.id ? String(a.id) : undefined,
            firstName: String(a.firstName ?? ""),
            lastName: String(a.lastName ?? ""),
            email: String(a.email ?? ""),
          }))
          .filter((a) => a.email);
      }
    } catch {
      /* fall through to line parsing */
    }
  }
  // Readable lines: "First Last <email>".
  return trimmed
    .split(/\r?\n/)
    .map((line) => {
      const m = line.match(/^(.*?)<([^>]+)>\s*$/);
      const name = (m ? m[1] : line).trim();
      const email = (m ? m[2] : "").trim();
      const [firstName = "", ...rest] = name.split(/\s+/);
      return { firstName, lastName: rest.join(" "), email };
    })
    .filter((a) => a.email);
}

// Read a buyer's persisted attendee list + running count from their contact.
async function readBuyerAttendeeList(
  contactId: string,
): Promise<{ list: AttendeeRecord[]; count: number }> {
  if (!contactId) return { list: [], count: 0 };
  try {
    const fieldMeta = await getFieldMeta();
    const res = (await ghlFetch(`/contacts/${contactId}`, { method: "GET" })) as {
      contact?: { customFields?: Array<{ id?: string; value?: unknown; field_value?: unknown }> };
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
    const count = Number.parseInt(valueOf(FIELD_KEYS.attendeesAdded), 10);
    return {
      list: parseAttendeeList(valueOf(FIELD_KEYS.attendeesList)),
      count: Number.isFinite(count) && count > 0 ? count : 0,
    };
  } catch (err) {
    console.warn("GHL buyer attendee-list read failed:", (err as Error).message);
    return { list: [], count: 0 };
  }
}

// Build contact custom-field update entries, resolving each field's GHL field ID
// by key when possible. The contact-update endpoint persists reliably by id; some
// fields don't update by key alone, which is why a count can silently fail to
// save. Falls back to key when the id can't be resolved.
async function contactFieldEntries(
  entries: Array<{ key: string; value: string }>,
): Promise<Array<{ id?: string; key?: string; field_value: string }>> {
  const meta = await getFieldMeta();
  const idByKey = new Map<string, string>();
  for (const [id, m] of meta) idByKey.set(m.key, id);
  return entries.map((e) => {
    const id = idByKey.get(e.key);
    return id ? { id, field_value: e.value } : { key: e.key, field_value: e.value };
  });
}

// Admin-registered attendee: name + email + required phone, plus the optional
// survey answers (same questions as checkout).
const adminAttendeeSchema = attendeeSchema.extend({
  phone: z.string().min(3).max(30),
  agencyState: z.string().max(100).optional(),
  hasMoa: z.string().max(20).optional(),
  attendedBefore: z.string().max(500).optional(),
  shirtSize: z.string().max(20).optional(),
});

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
  attendees: z.array(adminAttendeeSchema).min(1).max(20),
  // The buyer these attendees belong to — so we can persist a running
  // "attendees added" count on the buyer for the admin's remaining counter.
  buyerContactId: z.string().max(100).optional(),
  // The buyer's name + email, recorded on each attendee's contact
  // ({{contact.cpsp_buyer_name}} / cpsp_buyer_email).
  buyerName: z.string().max(200).optional(),
  buyerEmail: z.string().max(200).optional(),
});

// Optional outbound webhook fired once per attendee when the admin registers
// them, so a GHL "Inbound Webhook" workflow can pick them up (e.g. assign them to
// a pipeline). No-op unless GHL_ATTENDEE_WEBHOOK_URL is set. Best-effort — a
// failure here never blocks the registration.
async function fireAttendeeWebhook(payload: Record<string, unknown>): Promise<void> {
  const url = (process.env.GHL_ATTENDEE_WEBHOOK_URL ?? "").trim();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("Attendee webhook POST failed:", (err as Error).message);
  }
}

export const addAttendeesToGhl = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => addAttendeesSchema.parse(d))
  .handler(async ({ data }) => {
    // The event tag (🤝 s&p-{tier}-{city}-{yymmdd}) — same as the buyer — plus the
    // attendee tag marking them as someone else's extra ticket holder.
    const evTag = eventTag(data.tier, data.city, data.endDate);
    const tags = [evTag, ATTENDEE_TAG];
    const toAdd = data.attendees.filter((a) => a.email);
    const results = await Promise.allSettled(
      toAdd.map((a) =>
        ghlFetch("/contacts/upsert", {
          method: "POST",
          body: JSON.stringify({
            locationId: GHL_LOCATION_ID,
            firstName: a.firstName,
            lastName: a.lastName,
            email: a.email,
            phone: a.phone,
            // Agency state → native State field; survey → custom fields (same as
            // the buyer's checkout survey). All optional except phone.
            ...(a.agencyState ? { state: a.agencyState } : {}),
            tags,
            source: "Scale & Profit Seminar Attendee",
            customFields: [
              { key: FIELD_KEYS.role, field_value: "Attendee" },
              ...(data.buyerName
                ? [{ key: FIELD_KEYS.buyerName, field_value: data.buyerName }]
                : []),
              ...(data.buyerEmail
                ? [{ key: FIELD_KEYS.buyerEmail, field_value: data.buyerEmail }]
                : []),
              ...(a.hasMoa ? [{ key: FIELD_KEYS.hasMoa, field_value: a.hasMoa }] : []),
              ...(a.attendedBefore
                ? [{ key: FIELD_KEYS.attendedBefore, field_value: a.attendedBefore }]
                : []),
              ...(a.shirtSize ? [{ key: FIELD_KEYS.shirtSize, field_value: a.shirtSize }] : []),
            ],
          }),
        }),
      ),
    );
    // Capture each saved attendee WITH its GHL contact id, so the buyer can track
    // exactly who was registered and the admin can revoke a specific one later.
    const savedAttendees: AttendeeRecord[] = [];
    const savedInputs: Array<{ id: string; a: (typeof toAdd)[number] }> = [];
    results.forEach((r, i) => {
      if (r.status !== "fulfilled") return;
      const body = r.value as { contact?: { id?: string }; id?: string };
      const id = body.contact?.id ?? body.id ?? "";
      const a = toAdd[i];
      if (id) {
        savedAttendees.push({
          id,
          firstName: a.firstName,
          lastName: a.lastName,
          email: a.email,
        });
        savedInputs.push({ id, a });
      }
    });
    const saved = savedAttendees.length;
    const failed = results.length - saved;

    // Persist the attendee list + running count on the buyer so the "unassigned
    // tickets" counter survives reloads AND the admin can revoke a specific
    // attendee later. Best-effort: skipped silently if the field/contact is
    // missing. (Requires the cpsp_no_of_attendees_added [number] +
    // cpsp_name_of_attendees [text] contact fields to exist in GHL.)
    if (data.buyerContactId && saved > 0) {
      try {
        const existing = await readBuyerAttendeeList(data.buyerContactId);
        const list = [...existing.list, ...savedAttendees];
        const customFields = await contactFieldEntries([
          { key: FIELD_KEYS.attendeesAdded, value: String(existing.count + saved) },
          { key: FIELD_KEYS.attendeesList, value: formatAttendeeList(list) },
        ]);
        await ghlFetch(`/contacts/${data.buyerContactId}`, {
          method: "PUT",
          body: JSON.stringify({ customFields }),
        });
      } catch (err) {
        console.warn("GHL attendees-added update failed:", (err as Error).message);
      }
      // Mark the buyer as the sponsoring agent (additive — never removes tags).
      try {
        await ghlFetch(`/contacts/${data.buyerContactId}/tags`, {
          method: "POST",
          body: JSON.stringify({ tags: [MULTI_TICKET_BUYER_TAG] }),
        });
      } catch (err) {
        console.warn("GHL multiple-ticket-buyer tag failed:", (err as Error).message);
      }
    }

    // Record the buyer name/email + tier on each attendee's opportunity, so GHL
    // can merge {{opportunity.cpsp_buyer_name}} / cpsp_buyer_email /
    // cpsp_ticket_tier (e.g. in attendee emails).
    // IMPORTANT: create the opportunity in the SAME pipeline + stage as the
    // BUYER's own opportunity, so attendees land in this event's pipeline — never
    // an arbitrary first pipeline (which would be a different event). If the buyer
    // has no opportunity, we skip creation rather than guess a pipeline.
    if (data.buyerName && data.buyerContactId && saved > 0) {
      try {
        const oppRes = (await ghlFetch(
          `/opportunities/search?location_id=${GHL_LOCATION_ID}&contact_id=${data.buyerContactId}`,
          { method: "GET" },
        )) as {
          opportunities?: Array<{
            pipelineId?: string;
            pipelineStageId?: string;
            stageId?: string;
          }>;
        };
        const buyerOpp = oppRes.opportunities?.[0];
        const pipelineId = buyerOpp?.pipelineId;
        const pipelineStageId = buyerOpp?.pipelineStageId ?? buyerOpp?.stageId;
        if (pipelineId && pipelineStageId) {
          await Promise.allSettled(
            savedAttendees.map((a) =>
              ghlFetch("/opportunities/", {
                method: "POST",
                body: JSON.stringify({
                  locationId: GHL_LOCATION_ID,
                  pipelineId,
                  pipelineStageId,
                  name: `${a.firstName} ${a.lastName} — Attendee (${data.city})`,
                  status: "open",
                  contactId: a.id,
                  customFields: [
                    {
                      key: OPP_FIELD_KEYS.ticketTier,
                      field_value: data.tier === "vip" ? "VIP" : "General Admission",
                    },
                  ],
                }),
              }),
            ),
          );
        } else {
          console.warn("Skipped attendee opportunity create: buyer has no opportunity to mirror.");
        }
      } catch (err) {
        console.warn("GHL attendee opportunity create failed:", (err as Error).message);
      }
    }

    // Fire the outbound webhook (one POST per attendee) so a GHL Inbound Webhook
    // workflow can assign them to a pipeline. Best-effort, never blocks the result.
    if (savedInputs.length) {
      await Promise.allSettled(
        savedInputs.map(({ id, a }) =>
          fireAttendeeWebhook({
            event: "attendee_registered",
            contactId: id,
            firstName: a.firstName,
            lastName: a.lastName,
            fullName: `${a.firstName} ${a.lastName}`.trim(),
            email: a.email,
            phone: a.phone,
            state: a.agencyState ?? "",
            eventSlug: data.city,
            tier: data.tier === "vip" ? "VIP" : "General Admission",
            eventTag: evTag,
            role: "Attendee",
            buyerName: data.buyerName ?? "",
            buyerEmail: data.buyerEmail ?? "",
            buyerContactId: data.buyerContactId ?? "",
          }),
        ),
      );
    }

    return { ok: failed === 0, saved, failed, attendees: savedAttendees };
  });

const revokeAttendeeSchema = z.object({
  password: z.string().min(1).max(200),
  buyerContactId: z.string().min(1).max(100),
  attendeeEmail: z.string().email().max(200),
  city: z.string().min(1).max(50),
  // ISO end date (YYYY-MM-DD); falls back to the slug's default if omitted.
  endDate: z.string().max(20).optional(),
  tier: z.enum(["ga", "vip"]).optional(),
});

// Look up a contact id by email (exact match). Returns "" if not found.
async function findContactIdByEmail(email: string): Promise<string> {
  try {
    const res = (await ghlFetch(
      `/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(email)}`,
      { method: "GET" },
    )) as { contacts?: Array<{ id?: string; email?: string }> };
    const hit = res.contacts?.find((c) => c.email?.toLowerCase() === email.toLowerCase());
    return hit?.id ?? "";
  } catch (err) {
    console.warn("GHL contact lookup by email failed:", (err as Error).message);
    return "";
  }
}

// Revoke a previously-registered attendee (by email) from a buyer: removes the
// event tag from the attendee (so they no longer count as a seat — the contact
// itself is kept) and drops them from the buyer's attendee list + decrements the
// count, freeing the slot to reassign. Admin-gated.
export const revokeAttendeeFromBuyer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => revokeAttendeeSchema.parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    // 1. Remove the event tag AND the attendee tag from the attendee (keep the
    // contact) so they no longer count as a seat / registered attendee.
    const attendeeId = await findContactIdByEmail(data.attendeeEmail);
    if (attendeeId) {
      const tag = eventTag(data.tier ?? "ga", data.city, data.endDate);
      try {
        await ghlFetch(`/contacts/${attendeeId}/tags`, {
          method: "DELETE",
          body: JSON.stringify({ tags: [tag, ATTENDEE_TAG] }),
        });
      } catch (err) {
        console.warn("GHL attendee untag failed:", (err as Error).message);
      }
    }
    // 2. Drop the attendee from the buyer's list + decrement the count.
    const { list, count } = await readBuyerAttendeeList(data.buyerContactId);
    const nextList = list.filter((a) => a.email.toLowerCase() !== data.attendeeEmail.toLowerCase());
    const removed = nextList.length < list.length;
    const nextCount = Math.max(count - (removed ? 1 : 0), 0);
    const customFields = await contactFieldEntries([
      { key: FIELD_KEYS.attendeesAdded, value: String(nextCount) },
      { key: FIELD_KEYS.attendeesList, value: formatAttendeeList(nextList) },
    ]);
    await ghlFetch(`/contacts/${data.buyerContactId}`, {
      method: "PUT",
      body: JSON.stringify({ customFields }),
    });
    return { ok: true, attendeesAdded: nextCount };
  });

const manualBuyerSchema = z.object({
  password: z.string().min(1).max(200),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(200),
  phone: z.string().max(30).optional(),
  city: z.string().min(1).max(50),
  // ISO end date (YYYY-MM-DD); falls back to the slug's seeded date if omitted.
  endDate: z.string().max(20).optional(),
  tier: z.enum(["ga", "vip"]),
  quantity: z.number().int().min(1).max(20),
});

// Admin: add a buyer to an event by hand (e.g. an offline / phone purchase).
// Upserts the contact, writes tier + ticket count, and applies the event tag
// 🤝 s&p-{tier}-{city}-{yymmdd} so they show under the right event on the
// dashboard — exactly like a real checkout. Admin-gated.
export const addManualBuyer = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => manualBuyerSchema.parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const tierLabel = data.tier === "vip" ? "VIP" : "General Admission";
    // VIP is single-seat — never multi.
    const quantity = data.tier === "vip" ? 1 : data.quantity;
    const tag = eventTag(data.tier, data.city, data.endDate);
    const up = (await ghlFetch("/contacts/upsert", {
      method: "POST",
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        ...(data.phone ? { phone: data.phone } : {}),
        // Buyer (not an attendee) — source is used to tell them apart.
        source: "Scale & Profit Seminar - Admin",
        tags: [tag],
        customFields: [
          { key: FIELD_KEYS.eventCity, field_value: data.city },
          { key: FIELD_KEYS.ticketTier, field_value: tierLabel },
          { key: FIELD_KEYS.ticketQuantity, field_value: String(quantity) },
          { key: FIELD_KEYS.ticketQuantityLegacy, field_value: String(quantity) },
          // On purchase the contact is a Buyer (role refined to Attendee later).
          { key: FIELD_KEYS.role, field_value: "Buyer" },
        ],
      }),
    })) as { contact?: { id?: string }; id?: string };
    const contactId = up.contact?.id ?? up.id;
    return { ok: Boolean(contactId), contactId, tag };
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
  attendees: AttendeeRecord[]; // the registered attendees (revocable individually)
  buyerAttending: boolean; // whether the buyer uses 1 of their tickets (default true)
  buyerName: string; // for attendees: who bought their ticket (contact field)
  buyerEmail: string; // for attendees: the buyer's email (contact field)
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

// Work out which event a contact belongs to, from the event tag
// `🤝 s&p-{tier}-{slug}-{yymmdd}`. The optional `(ga|vip)-` tier prefix is skipped
// so the legacy tag `🤝 s&p-{slug}-{yymmdd}` resolves identically. Also tolerates
// `scale-profit-{slug}` so contacts tagged before the consolidation still map.
function deriveEventSlug(tags: string[]): string {
  const reserved = new Set(["seminar", "ga", "vip", "attendee"]);
  for (const t of tags) {
    const eventMatch = t.match(/s&p-(?:(?:ga|vip)-)?([a-z0-9-]+?)-(?:\d{6}|\d{4}-\d{2}-\d{2})$/i);
    if (eventMatch) return eventMatch[1].toLowerCase();
    const buyerMatch = t.match(/^scale-profit-([a-z0-9-]+)$/i);
    if (buyerMatch && !reserved.has(buyerMatch[1].toLowerCase())) {
      return buyerMatch[1].toLowerCase();
    }
  }
  return "";
}

// Tier (GA/VIP) is read FIRST from the event tag `🤝 s&p-{tier}-{city}-{yymmdd}`,
// which is authoritative. For legacy contacts whose tag predates the tier prefix,
// fall back to the opportunity name (`… — VIP (city)`) and then legacy tier tags.
function deriveTier(tags: string[], opportunities?: Array<{ name?: string }>): string {
  for (const t of tags) {
    const m = t.match(/s&p-(ga|vip)-[a-z0-9-]+?-(?:\d{6}|\d{4}-\d{2}-\d{2})$/i);
    if (m) return m[1].toLowerCase() === "vip" ? "VIP" : "General Admission";
  }
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
    // Larger of the saved counter and the actual attendee-list length, so the
    // count survives even if one of the two fields didn't persist.
    const counter = Number.parseInt(valueOf(FIELD_KEYS.attendeesAdded), 10);
    const listLen = parseAttendeeList(valueOf(FIELD_KEYS.attendeesList)).length;
    attendeesAdded = Math.max(Number.isFinite(counter) && counter > 0 ? counter : 0, listLen);
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
// because it returns contact PII. Tier (GA/VIP) + event are read from the
// 🤝 s&p-{tier}-{city}-{yymmdd} tag; buyer vs attendee from the contact source.
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
        eventTagSearchFragment(e.slug, e.end_date), // {city}-{yymmdd} — matches GA/VIP/legacy
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
    // contacts and keep any that carry a Scale & Profit event tag (the emoji tag
    // contains "s&p-", or a legacy "scale-profit-…" tag). We intentionally do NOT
    // include source-only matches: only people who actually purchased (tagged on
    // checkout) or were added by the admin (tagged attendees) belong here.
    // Bounded so a large location can't time out the worker.
    const SP_TAG_RE = /s&p-|scale-profit/i;
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
          if (!tags.some((t) => SP_TAG_RE.test(t))) continue;
          const id = String(c.id ?? c.contactId ?? "");
          if (id) byId.set(id, c);
        }
        if (batch.length < pageLimit) break;
      }
    } catch (err) {
      console.warn("GHL broad contact scan failed:", (err as Error).message);
    }

    // Only contacts whose tag resolves to a specific event are shown — buyers
    // (tagged on purchase) and admin-added attendees. Anything else (e.g. an
    // umbrella-only legacy tag, or a stray source match) is dropped so the
    // dashboard shows purchasers + admin-added attendees, grouped by event.
    const rawContacts = [...byId.values()].filter(
      (c) => deriveEventSlug((c.tags ?? []).map((t) => String(t))) !== "",
    );

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
          resolveBuyerCounts(row.id, row.email).catch(() => ({
            ticketQuantity: 0,
            attendeesAdded: 0,
          })),
        ]);
        // VIP is a single-seat ticket — never multi. Force qty 1 (and 0 added)
        // so a VIP buyer never shows a multi-ticket count or unassigned seats,
        // even if a stale ticket-quantity field/order says otherwise.
        const isVipBuyer = row.tier === "VIP";
        return {
          ...row,
          amount: paid > 0 ? paid : row.amount,
          ticketQuantity: isVipBuyer
            ? 1
            : counts.ticketQuantity > 0
              ? counts.ticketQuantity
              : row.ticketQuantity,
          attendeesAdded: isVipBuyer ? 0 : counts.attendeesAdded,
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
    const counterAdded = Number.parseInt(valueOf(FIELD_KEYS.attendeesAdded), 10);
    const attendeeList = parseAttendeeList(valueOf(FIELD_KEYS.attendeesList));
    // Use the larger of the saved counter and the actual list length, so the
    // count survives even if one of the two fields didn't persist.
    const attendeesAdded = Math.max(
      Number.isFinite(counterAdded) && counterAdded > 0 ? counterAdded : 0,
      attendeeList.length,
    );

    // Buyer attending (uses 1 ticket) unless explicitly "no"; and the ticket
    // purchaser recorded on this contact's opportunity (for attendees).
    // Default = NOT attending (role "Buyer") until the admin marks them attending.
    const buyerAttending = valueOf(FIELD_KEYS.buyerAttending).toLowerCase() === "yes";

    return {
      ticketQuantity: Number.isFinite(contactQty) && contactQty > 0 ? contactQty : oppTickets,
      attendeesAdded,
      attendees: attendeeList,
      buyerAttending,
      // For attendees: the buyer who bought their ticket, from the contact
      // ({{contact.cpsp_buyer_name}} / cpsp_buyer_email).
      buyerName: valueOf(FIELD_KEYS.buyerName),
      buyerEmail: valueOf(FIELD_KEYS.buyerEmail),
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

const buyerAttendingSchema = z.object({
  password: z.string().min(1).max(200),
  contactId: z.string().min(1).max(100),
  attending: z.boolean(),
});

// Admin: set whether the buyer themselves attends (uses 1 of their tickets).
// Persisted on the buyer so the "unassigned tickets" math is right on reload.
export const setBuyerAttending = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => buyerAttendingSchema.parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    // A multi-ticket buyer who's attending → Attendee; otherwise Buyer.
    const customFields = await contactFieldEntries([
      { key: FIELD_KEYS.buyerAttending, value: data.attending ? "yes" : "no" },
      { key: FIELD_KEYS.role, value: data.attending ? "Attendee" : "Buyer" },
    ]);
    await ghlFetch(`/contacts/${data.contactId}`, {
      method: "PUT",
      body: JSON.stringify({ customFields }),
    });
    return { ok: true as const, attending: data.attending };
  });

const assignSchema = z.object({
  password: z.string().min(1).max(200),
  contactIds: z.array(z.string().min(1).max(100)).min(1).max(200),
  city: z.string().min(1).max(50),
  // ISO end date (YYYY-MM-DD); falls back to the slug's seeded date if omitted.
  endDate: z.string().max(20).optional(),
  // Tier to record in the tag. Unassigned contacts have no known tier, so the
  // admin picks one; defaults to GA.
  tier: z.enum(["ga", "vip"]).optional(),
});

// Bulk-assign contacts to an event by adding the single centralized event tag
// (🤝 s&p-{tier}-{city}-{yymmdd}). Used by the admin to move "Unassigned"
// purchasers into a city. Adds the tag without removing existing tags.
export const assignContactsToEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => assignSchema.parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);
    const tags = [eventTag(data.tier ?? "ga", data.city, data.endDate)];
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
    return {
      ok: assigned === data.contactIds.length,
      assigned,
      failed: data.contactIds.length - assigned,
    };
  });

const tagBuyerSchema = z.object({
  email: z.string().email().max(200),
  city: z.string().min(1).max(50),
  // Tier the buyer purchased, recorded in the event tag. Defaults to GA.
  tier: z.enum(["ga", "vip"]).optional(),
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
// 🤝 s&p-{tier}-{city}-{yymmdd} and saves the checkout survey answers to the
// contact. This is the one and only place a buyer is tagged. Additive — never
// removes existing tags, and re-running it just re-applies the same tag.
export const tagBuyerForEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => tagBuyerSchema.parse(d))
  .handler(async ({ data }) => {
    const tag = eventTag(data.tier ?? "ga", data.city);
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

// ============== Event ticket caps (live, tag-based) ==============

// Per-tier purchase limits applied to EVERY event. Counts are derived live from
// the single event tag 🤝 s&p-{city}-{yymmdd} carried by every buyer + attendee:
//   • VIP sold = contacts tagged for the event whose tier is VIP
//   • GA sold  = every other tagged contact (GA buyers + their attendees; VIP is
//                single-seat, so attendees only ever fill GA seats)
// Once a tier reaches its limit the landing page + checkout mark it sold out.
export const TIER_LIMITS = { ga: 100, vip: 20 } as const;
export type Tier = keyof typeof TIER_LIMITS;

// Split a set of event-tagged contacts into GA vs VIP seat counts by their ACTUAL
// tier tag (🤝 s&p-ga-… vs 🤝 s&p-vip-…). `slug` filters to contacts whose event
// tag resolves to this event; a contact with no recognizable tier counts toward
// neither, so each tier reflects its real tag count.
export function countSeatsByTier(
  contacts: Array<{ tags?: string[]; opportunities?: Array<{ name?: string }> }>,
  slug: string,
): { ga: number; vip: number } {
  let ga = 0;
  let vip = 0;
  for (const c of contacts) {
    const tags = (c.tags ?? []).map((t) => String(t));
    if (deriveEventSlug(tags) !== slug) continue;
    const tier = deriveTier(tags, c.opportunities);
    if (tier === "VIP") vip++;
    else if (tier === "General Admission") ga++;
  }
  return { ga, vip };
}

// Count the buyers/attendees tagged for one event, split by tier. Returns null if
// GHL couldn't be reached at all (so callers fail OPEN and never block a sale on
// an outage). Cached briefly — the public checkout + landing pages hit this on load.
let eventSoldCache: { at: number; data: Record<string, { ga: number; vip: number }> } | null = null;
const EVENT_SOLD_TTL_MS = 60 * 1000;

async function countEventSold(
  city: string,
  endDate?: string,
): Promise<{ ga: number; vip: number } | null> {
  const slug = city.toLowerCase();
  if (
    eventSoldCache &&
    Date.now() - eventSoldCache.at < EVENT_SOLD_TTL_MS &&
    slug in eventSoldCache.data
  ) {
    return eventSoldCache.data[slug];
  }
  // The {city}-{yymmdd} fragment is a "contains" substring of the GA, VIP, and
  // legacy tags alike (GHL 400s on the 🤝 emoji, so we never send it). deriveTier
  // below splits the matched contacts back into GA vs VIP.
  const searchTags = [eventTagSearchFragment(slug, endDate), `scale-profit-${slug}`];
  const byId = new Map<string, RawSearchContact>();
  let anySuccess = false;
  const pageLimit = 100;
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
        anySuccess = true;
        const batch = res.contacts ?? [];
        for (const c of batch) {
          const id = String(c.id ?? c.contactId ?? "");
          if (id) byId.set(id, c);
        }
        if (batch.length < pageLimit) break;
      }
    } catch (err) {
      console.warn(`GHL event-count search failed for tag "${tag}":`, (err as Error).message);
    }
  }
  if (!anySuccess) return null;

  const data = countSeatsByTier([...byId.values()], slug);
  eventSoldCache = { at: Date.now(), data: { ...(eventSoldCache?.data ?? {}), [slug]: data } };
  return data;
}

// Count TICKETS SOLD per tier for an event (capacity basis): sum of each BUYER's
// purchased quantity — GA can be multi-ticket, VIP is single-seat. Attendees are
// NOT counted (they're already part of their buyer's quantity). This drives the
// "remaining tickets" custom values (limit − sold), so unassigned multi-tickets
// still reduce availability. Returns null if GHL couldn't be reached.
async function countTicketsSold(
  city: string,
  endDate?: string,
): Promise<{ ga: number; vip: number } | null> {
  const slug = city.toLowerCase();
  const searchTags = [eventTagSearchFragment(slug, endDate), `scale-profit-${slug}`];
  const byId = new Map<string, RawSearchContact>();
  let anySuccess = false;
  const pageLimit = 100;
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
        anySuccess = true;
        const batch = res.contacts ?? [];
        for (const c of batch) {
          const id = String(c.id ?? c.contactId ?? "");
          if (id) byId.set(id, c);
        }
        if (batch.length < pageLimit) break;
      }
    } catch (err) {
      console.warn(`GHL tickets-sold search failed for tag "${tag}":`, (err as Error).message);
    }
  }
  if (!anySuccess) return null;

  let vip = 0;
  const gaBuyers: Array<{ id: string; email: string }> = [];
  for (const c of byId.values()) {
    const tags = (c.tags ?? []).map((t) => String(t));
    if (deriveEventSlug(tags) !== slug) continue;
    const isAttendee =
      (c.source ?? "").toLowerCase().includes("attendee") || tags.includes("scale-profit-attendee");
    if (isAttendee) continue; // already part of a buyer's quantity
    const tier = deriveTier(tags, c.opportunities);
    if (tier === "VIP") vip += 1;
    else if (tier === "General Admission") {
      gaBuyers.push({ id: String(c.id ?? c.contactId ?? ""), email: c.email ?? "" });
    }
  }
  // Accurate GA ticket quantities per buyer (matches the dashboard's count).
  const gaQtys = await mapWithConcurrency(gaBuyers, 6, async (b) => {
    if (!b.id) return 1;
    const { ticketQuantity } = await resolveBuyerCounts(b.id, b.email).catch(() => ({
      ticketQuantity: 1,
      attendeesAdded: 0,
    }));
    return Math.max(ticketQuantity, 1);
  });
  const ga = gaQtys.reduce((sum, n) => sum + n, 0);
  return { ga, vip };
}

export type TierAvailability = {
  limit: number;
  sold: number;
  remaining: number;
  soldOut: boolean;
};

export type EventAvailability = {
  // false when live counts couldn't be read — the UI must fail open in that case
  // (never block a sale because GHL was briefly unreachable).
  counted: boolean;
  ga: TierAvailability;
  vip: TierAvailability;
};

// Build a per-tier availability object from a raw sold count (or null counts).
export function tierAvailability(
  tier: Tier,
  counts: { ga: number; vip: number } | null,
): TierAvailability {
  const limit = TIER_LIMITS[tier];
  if (!counts) return { limit, sold: 0, remaining: limit, soldOut: false };
  const sold = Math.max(counts[tier], 0);
  const remaining = Math.max(limit - sold, 0);
  return { limit, sold, remaining, soldOut: remaining <= 0 };
}

const eventAvailInputSchema = z.object({
  city: z.string().min(1).max(50),
  // ISO end date (YYYY-MM-DD); used to build the event tag. Falls back to the
  // seeded default for the slug when omitted.
  endDate: z.string().max(20).optional(),
});

// Public: live GA + VIP availability for an event, counted from the event tag.
// Used by the landing page + checkout to mark a tier sold out once it reaches its
// limit. Fails open (soldOut=false) whenever the counts can't be read.
export const getEventAvailability = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => eventAvailInputSchema.parse(d))
  .handler(async ({ data }): Promise<EventAvailability> => {
    const counts = await countEventSold(data.city, data.endDate);
    return {
      counted: Boolean(counts),
      ga: tierAvailability("ga", counts),
      vip: tierAvailability("vip", counts),
    };
  });

// ============== Cohort slots → GHL custom values ==============

// The four location custom values that mirror the cohort cards (slot 1 = nearest
// upcoming) so email automations can merge {{custom_values.cpsp_cohort_slot_N}}.
const COHORT_SLOT_KEYS = [
  "cpsp_cohort_slot_1",
  "cpsp_cohort_slot_2",
  "cpsp_cohort_slot_3",
  "cpsp_cohort_slot_4",
] as const;

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/^\{\{|\}\}$/g, "")
    .replace(/custom_values\./i, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Per-cohort "remaining tickets" custom values (by display name) — slot 1 =
// nearest. {{custom_values.cp_s_p_remaining_ga_tickets_cohort_N}} etc.
function cohortRemainingNames(n: number): { ga: string; vip: string } {
  return {
    ga: `CP-S&P: Remaining GA Tickets Cohort ${n}`,
    vip: `CP-S&P: Remaining VIP Tickets Cohort ${n}`,
  };
}

// Write the nearest-upcoming events (sorted, past dropped) into the GHL location
// custom values — slot 1 = nearest:
//   • cpsp_cohort_slot_1..4         → cohort info as one email-friendly line
//   • CP-S&P: Remaining GA/VIP …    → remaining tickets per cohort (limit − sold)
// Empty slots are cleared. Best-effort: matches existing custom values by key /
// display name; any that don't exist in GHL are skipped (logged).
export async function syncCohortSlots(events: EventRow[]): Promise<{ updated: number }> {
  const top4 = splitEvents(events, getTodayISO()).upcoming.slice(0, 4);

  let list: Array<{ id?: string; name?: string; fieldKey?: string }> = [];
  try {
    const res = (await ghlFetch(`/locations/${GHL_LOCATION_ID}/customValues`, {
      method: "GET",
    })) as { customValues?: Array<{ id?: string; name?: string; fieldKey?: string }> };
    list = res.customValues ?? [];
  } catch (err) {
    console.warn("[syncCohortSlots] customValues fetch failed:", (err as Error).message);
    return { updated: 0 };
  }

  // Update a custom value matched by normalized key OR display name.
  const updateCv = async (match: string, value: string): Promise<boolean> => {
    const target = normalizeKey(match);
    const cv = list.find((v) => {
      const fk = normalizeKey(String(v.fieldKey ?? ""));
      const nm = normalizeKey(String(v.name ?? ""));
      return fk === target || nm === target || fk.endsWith(target) || nm.endsWith(target);
    });
    if (!cv?.id) {
      console.warn(`[syncCohortSlots] custom value "${match}" not found — skipped.`);
      return false;
    }
    try {
      await ghlFetch(`/locations/${GHL_LOCATION_ID}/customValues/${cv.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: cv.name, value }),
      });
      return true;
    } catch (err) {
      console.warn(`[syncCohortSlots] update "${match}" failed:`, (err as Error).message);
      return false;
    }
  };

  let updated = 0;
  for (let i = 0; i < 4; i++) {
    const ev = top4[i];
    const n = i + 1;
    const names = cohortRemainingNames(n);

    // Cohort info as one email-friendly line, e.g.
    // "Nashville — August 5th–6th, 2026 — W Nashville Hotel, 300 12th Ave S, …".
    const place = [ev?.venue, ev?.address].filter(Boolean).join(", ");
    const slotValue = ev ? [ev.city, ev.date, place].filter(Boolean).join(" — ") : "";
    if (await updateCv(COHORT_SLOT_KEYS[i], slotValue)) updated++;

    // Remaining tickets per tier = limit − tickets SOLD (sum of purchased
    // quantities, so unassigned multi-tickets still count). Skip writing if the
    // count couldn't be read, so we never overwrite with a wrong number.
    if (ev) {
      const counts = await countTicketsSold(ev.slug, ev.end_date);
      if (counts) {
        const remGa = String(Math.max(TIER_LIMITS.ga - counts.ga, 0));
        const remVip = String(Math.max(TIER_LIMITS.vip - counts.vip, 0));
        if (await updateCv(names.ga, remGa)) updated++;
        if (await updateCv(names.vip, remVip)) updated++;
      }
    } else {
      // Empty slot — clear the remaining counters.
      if (await updateCv(names.ga, "")) updated++;
      if (await updateCv(names.vip, "")) updated++;
    }
  }
  return { updated };
}

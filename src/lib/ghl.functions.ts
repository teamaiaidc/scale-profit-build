import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DEFAULT_EVENTS } from "./events";

const GHL_LOCATION_ID = "mVdYbXfJcF10Y7anuoNt";
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

// GHL custom-field keys the checkout writes to the buyer contact. These must
// match the field keys in GHL exactly (the part after `contact.` in a merge
// tag, e.g. {{contact.do_you_have_a_moa_1}} → "do_you_have_a_moa_1").
const FIELD_KEYS = {
  eventCity: "event_city",
  ticketTier: "ticket_tier",
  orderAmount: "order_amount",
  // Real per-buyer ticket count, set by the GHL payment form (see docs §6).
  ticketQuantity: "sp2026_ticket_quantity",
  // Legacy key the site previously wrote; still read when present.
  ticketQuantityLegacy: "ticket_quantity",
  hasMoa: "do_you_have_a_moa_1",
  attendedBefore: "have_you_attended_a_scale__profit_seminar_before_1",
  shirtSize: "scale__profit_shirt_size",
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
    const tags = [
      "scale-profit-seminar",
      `scale-profit-${data.city}`,
      `scale-profit-${data.tier}`,
      `scale-profit-${data.city}-${data.tier}`,
    ];

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
        tags,
        source: "Scale & Profit Seminar Checkout",
        // Agency state maps to GHL's native contact "State" field
        // ({{contact.state}}), so it's a top-level property, not a custom field.
        ...(data.survey?.agencyState ? { state: data.survey.agencyState } : {}),
        customFields: [
          { key: FIELD_KEYS.eventCity, field_value: data.city },
          { key: FIELD_KEYS.ticketTier, field_value: tierLabel },
          { key: FIELD_KEYS.ticketQuantity, field_value: String(data.quantity) },
          { key: FIELD_KEYS.ticketQuantityLegacy, field_value: String(data.quantity) },
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
                tags: [...tags, "scale-profit-attendee"],
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

      const oppMeta = await getFieldMeta("opportunity");
      const opportunityTicketKeys = new Set<string>([
        OPP_FIELD_KEYS.ticketsPurchased,
        OPP_FIELD_KEYS.ticketsPurchasedLegacy,
      ]);
      const ticketFieldIds = new Set(
        [...oppMeta.entries()]
          .filter(([, m]) => opportunityTicketKeys.has(m.key))
          .map(([id]) => id),
      );
      const oppRes = (await ghlFetch(
        `/opportunities/search?location_id=${GHL_LOCATION_ID}&contact_id=${contactId}`,
        { method: "GET" },
      )) as {
        opportunities?: Array<{
          customFields?: Array<{
            id?: string;
            value?: unknown;
            fieldValueString?: unknown;
            fieldValue?: unknown;
            field_value?: unknown;
          }>;
        }>;
      };

      let best = 0;
      let raw = "";
      for (const opportunity of oppRes.opportunities ?? []) {
        for (const field of opportunity.customFields ?? []) {
          if (ticketFieldIds.size > 0 && (!field.id || !ticketFieldIds.has(field.id))) continue;
          const value = readCustomFieldValue(field);
          const qty = readTicketNumber(value);
          if (qty > best) {
            best = qty;
            raw = String(value ?? "");
          }
        }
      }
      if (best > 0) return { quantity: best, raw, found: true };

      const contactMeta = await getFieldMeta();
      const contactTicketKeys = new Set<string>([
        FIELD_KEYS.ticketQuantity,
        FIELD_KEYS.ticketQuantityLegacy,
      ]);
      const contactTicketIds = new Set(
        [...contactMeta.entries()]
          .filter(([, m]) => contactTicketKeys.has(m.key))
          .map(([id]) => id),
      );
      for (const field of contact.customFields ?? []) {
        if (contactTicketIds.size > 0 && (!field.id || !contactTicketIds.has(field.id))) continue;
        const value = readCustomFieldValue(field);
        const qty = readTicketNumber(value);
        if (qty > best) {
          best = qty;
          raw = String(value ?? "");
        }
      }

      return best > 0
        ? { quantity: best, raw, found: true }
        : { quantity: 1, raw: "", found: false };
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
});

export const addAttendeesToGhl = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => addAttendeesSchema.parse(d))
  .handler(async ({ data }) => {
    // Event tag: s&p-{slug}-{endDate} (e.g. s&p-boston-2026-06-03), uniquely
    // identifying which event/date the ticket was purchased for.
    const endDate =
      data.endDate || DEFAULT_EVENTS.find((e) => e.slug === data.city)?.end_date || "";
    const eventTag = endDate ? `s&p-${data.city}-${endDate}` : `s&p-${data.city}`;
    const tags = [
      eventTag,
      "scale-profit-seminar",
      `scale-profit-${data.tier}`,
      "scale-profit-attendee",
    ];
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
    return { ok: failed === 0, saved, failed };
  });

// ============== Admin: purchasers / attendees ==============

// Every checkout + attendee contact carries this tag, so it's the master filter
// for "everyone connected to a Scale & Profit event".
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
  opportunities?: Array<{ monetaryValue?: number }>;
};

// GHL field keys come back as `contact.<key>` / `opportunity.<key>`; compare bare keys.
function bareFieldKey(key: string): string {
  return key.replace(/^(contact|opportunity)\./, "");
}

// Work out which event a contact belongs to. Buyers carry a `scale-profit-{slug}`
// tag; attendees carry an `s&p-{slug}-{endDate}` tag instead.
function deriveEventSlug(tags: string[]): string {
  const reserved = new Set(["seminar", "ga", "vip", "attendee"]);
  for (const t of tags) {
    const attendeeMatch = t.match(/^s&p-([a-z0-9-]+?)-\d{4}-\d{2}-\d{2}$/i);
    if (attendeeMatch) return attendeeMatch[1].toLowerCase();
    const buyerMatch = t.match(/^scale-profit-([a-z0-9-]+)$/i);
    if (buyerMatch && !reserved.has(buyerMatch[1].toLowerCase())) {
      return buyerMatch[1].toLowerCase();
    }
  }
  return "";
}

// Tier from the `scale-profit-vip` / `scale-profit-ga` tag.
function deriveTier(tags: string[]): string {
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
async function fetchOpportunityTicketCount(contactId: string): Promise<number> {
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
      for (const f of o.customFields ?? []) {
        if (ticketFieldId && f.id !== ticketFieldId) continue;
        const raw = readCustomFieldValue(f);
        const n = readTicketNumber(raw);
        if (Number.isFinite(n) && n > best) best = n;
      }
    }
    return best;
  } catch (err) {
    console.warn("GHL opportunity fetch failed:", (err as Error).message);
    return 0;
  }
}

function assertAdmin(password: string) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new Error("ADMIN_PASSWORD is not configured on the server.");
  if (password !== expected) throw new Error("Unauthorized: incorrect password.");
}

const purchasersInputSchema = z.object({ password: z.string().min(1).max(200) });

// Lists everyone tagged into a Scale & Profit event (buyers + attendees) for the
// admin Attendees tab, grouped client-side by event. Password-gated server-side
// because it returns contact PII.
export const listSeminarPurchasers = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => purchasersInputSchema.parse(d))
  .handler(async ({ data }) => {
    assertAdmin(data.password);

    // Search every seminar contact by tag, paging until exhausted (capped).
    const rawContacts: RawSearchContact[] = [];
    let searchError: string | null = null;
    try {
      const pageLimit = 100;
      for (let page = 1; page <= 20; page++) {
        const res = (await ghlFetch("/contacts/search", {
          method: "POST",
          body: JSON.stringify({
            locationId: GHL_LOCATION_ID,
            page,
            pageLimit,
            filters: [{ field: "tags", operator: "contains", value: SEMINAR_TAG }],
          }),
        })) as { contacts?: RawSearchContact[] };
        const batch = res.contacts ?? [];
        rawContacts.push(...batch);
        if (batch.length < pageLimit) break;
      }
    } catch (err) {
      searchError = (err as Error).message;
      console.warn("GHL purchaser search failed:", searchError);
    }

    const purchasers: SeminarPurchaser[] = rawContacts.map((c) => {
      const tags = (c.tags ?? []).map((t) => String(t));
      // Indicative amount = the largest opportunity value on the contact.
      const amount = (c.opportunities ?? []).reduce(
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
        tier: deriveTier(tags),
        ticketQuantity: 1,
        amount,
        source: c.source ?? "",
        isAttendee: tags.includes("scale-profit-attendee"),
        dateAdded: c.dateAdded ?? "",
      };
    });

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

    // Ticket count: prefer the opportunity field
    // ({{opportunity.sp_no_of_ticket_purchased}}), fall back to a contact field.
    const oppTickets = await fetchOpportunityTicketCount(data.contactId);
    const contactQty = Number.parseInt(
      valueOf(FIELD_KEYS.ticketQuantity) || valueOf(FIELD_KEYS.ticketQuantityLegacy),
      10,
    );

    return {
      ticketQuantity:
        oppTickets > 0
          ? oppTickets
          : Number.isFinite(contactQty) && contactQty > 0
            ? contactQty
            : 0,
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

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DEFAULT_EVENTS } from "./events";

const GHL_LOCATION_ID = "mVdYbXfJcF10Y7anuoNt";
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

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

    // 1. Upsert primary buyer contact
    const upsert = (await ghlFetch("/contacts/upsert", {
      method: "POST",
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        tags,
        source: "Scale & Profit Seminar Checkout",
        customFields: [
          { key: "event_city", field_value: data.city },
          { key: "ticket_tier", field_value: tierLabel },
          { key: "ticket_quantity", field_value: String(data.quantity) },
          { key: "order_amount", field_value: String(data.amount) },
          ...(data.survey
            ? [
                { key: "agency_state", field_value: data.survey.agencyState },
                { key: "has_moa", field_value: data.survey.hasMoa },
                { key: "attended_before", field_value: data.survey.attendedBefore },
                { key: "shirt_size", field_value: data.survey.shirtSize },
              ]
            : []),
        ],
      }),
    })) as { contact?: { id?: string }; id?: string };

    const contactId =
      (upsert.contact && upsert.contact.id) || upsert.id || undefined;

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

    // 3. Try to create an opportunity in the first available pipeline (best-effort)
    let opportunityId: string | undefined;
    if (contactId) {
      try {
        const pipelines = (await ghlFetch(
          `/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`,
          { method: "GET" },
        )) as { pipelines?: Array<{ id: string; stages?: Array<{ id: string }> }> };
        const pipeline = pipelines.pipelines?.[0];
        const stageId = pipeline?.stages?.[0]?.id;
        if (pipeline && stageId) {
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
            }),
          })) as { opportunity?: { id?: string }; id?: string };
          opportunityId =
            (opp.opportunity && opp.opportunity.id) || opp.id || undefined;
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

export const lookupGhlContactByEmail = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => lookupSchema.parse(d))
  .handler(async ({ data }) => {
    let fieldDefs: GhlCustomFieldDef[] = [];
    try {
      const defs = (await ghlFetch(
        `/locations/${GHL_LOCATION_ID}/customFields`,
        { method: "GET" },
      )) as { customFields?: GhlCustomFieldDef[] };
      fieldDefs = defs.customFields ?? [];
    } catch (err) {
      console.warn("GHL field defs fetch failed:", (err as Error).message);
    }

    let contact: GhlContactSnapshot | null = null;
    try {
      const q = encodeURIComponent(data.email);
      const res = (await ghlFetch(
        `/contacts/?locationId=${GHL_LOCATION_ID}&query=${q}`,
        { method: "GET" },
      )) as {
        contacts?: Array<{
          id: string;
          firstName?: string;
          lastName?: string;
          email?: string;
          phone?: string;
          customFields?: Array<{ id: string; value?: string; field_value?: string }>;
        }>;
      };
      const hit = res.contacts?.find(
        (c) => c.email?.toLowerCase() === data.email.toLowerCase(),
      );
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
      const res = (await ghlFetch(
        `/products/?locationId=${GHL_LOCATION_ID}&limit=100`,
        { method: "GET" },
      )) as { products?: RawProduct[] };
      const raw = (res.products ?? []).filter((p) =>
        RELEVANT_PRODUCT.test(p.name ?? ""),
      );

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
  city: z.string().min(1).max(50),
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


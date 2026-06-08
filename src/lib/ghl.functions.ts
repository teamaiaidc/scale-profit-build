import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GHL_LOCATION_ID = "mVdYbXfJcF10Y7anuoNt";
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

const attendeeSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(200),
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

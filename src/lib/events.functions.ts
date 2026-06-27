import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_EVENTS, normalizeEvent, sortByDate, type EventRow } from "./events";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { syncCohortSlots } from "./ghl.functions";

const EVENT_COLUMNS = "slug, city, date, end_date, venue, address, time, details, sort_order";

// The generated Supabase Database type has no tables yet, so use an untyped
// handle for the events table. (Server-only — service-role key.)
function db(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}

// Read the event list from Supabase, falling back to DEFAULT_EVENTS if empty or
// unreachable. Plain helper so both listEvents and the scheduled cohort sync can
// use it.
export async function readEvents(): Promise<EventRow[]> {
  try {
    const { data, error } = await db().from("events").select(EVENT_COLUMNS).order("sort_order");
    if (error) throw error;
    if (data && data.length > 0) {
      return sortByDate(data.map((r) => normalizeEvent(r as Partial<EventRow>)));
    }
  } catch (err) {
    console.warn("[readEvents] Supabase read failed, using defaults:", (err as Error).message);
  }
  return sortByDate(DEFAULT_EVENTS);
}

// The public site renders this list on the server for the initial paint.
// Source of truth is the Supabase `events` table; if it's empty or unreachable
// (e.g. not configured yet) we fall back to the built-in DEFAULT_EVENTS so the
// site never ends up with zero events.
export const listEvents = createServerFn({ method: "GET" }).handler(
  async (): Promise<EventRow[]> => readEvents(),
);

function assertAdminPassword(password: string) {
  const expected = (process.env.ADMIN_PASSWORD ?? "").trim();
  if (!expected) {
    throw new Error("Admin password is not configured on the server. Please set ADMIN_PASSWORD.");
  }
  if (password.trim() !== expected) {
    throw new Error("Unauthorized: incorrect password.");
  }
}

// Password check for the /admin page. Validated on the server so the password
// never ships to the client. Uses the ADMIN_PASSWORD env var.
export const verifyAdminPassword = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ password: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    assertAdminPassword(data.password);
    return { ok: true as const };
  });

const eventRowSchema = z.object({
  slug: z.string().min(1).max(60),
  city: z.string().max(120),
  date: z.string().max(120),
  end_date: z.string().max(20),
  venue: z.string().max(200),
  address: z.string().max(300),
  time: z.string().max(100),
  details: z.string().max(2000),
  sort_order: z.number().int(),
});

const saveEventsSchema = z.object({
  password: z.string().min(1).max(200),
  events: z.array(eventRowSchema).max(100),
});

// Admin-gated: persist the full event list to Supabase (upsert all + delete any
// that were removed). This is the single source of truth shared across all
// visitors/devices. Requires SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL.
export const saveAdminEvents = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => saveEventsSchema.parse(d))
  .handler(async ({ data }) => {
    assertAdminPassword(data.password);
    const client = db();

    if (data.events.length > 0) {
      const { error } = await client.from("events").upsert(data.events, { onConflict: "slug" });
      if (error) throw new Error(`Failed to save events: ${error.message}`);
    }

    // Delete any events that are no longer in the list (full replace).
    const { data: existing, error: readErr } = await client.from("events").select("slug");
    if (readErr) throw new Error(`Failed to read events: ${readErr.message}`);
    const keep = new Set(data.events.map((e) => e.slug));
    const toDelete = (existing ?? [])
      .map((r) => String((r as { slug?: unknown }).slug ?? ""))
      .filter((slug) => slug && !keep.has(slug));
    if (toDelete.length > 0) {
      const { error } = await client.from("events").delete().in("slug", toDelete);
      if (error) throw new Error(`Failed to prune events: ${error.message}`);
    }

    // Mirror the nearest-upcoming events into the GHL cohort-slot custom values
    // for email automations (slot 1 = nearest). Best-effort — never fail a save.
    try {
      await syncCohortSlots(data.events.map((e) => normalizeEvent(e)));
    } catch (err) {
      console.warn("[saveAdminEvents] cohort sync failed:", (err as Error).message);
    }

    return { ok: true as const, count: data.events.length };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { supabase } from "@/integrations/supabase/client";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DEFAULT_EVENTS, sortByDate, type EventRow } from "./events";

// Storage is hybrid:
//   • If SUPABASE_SERVICE_ROLE_KEY is set, events are read from / written to the
//     Supabase `events` table (works on serverless deploys like Lovable/Cloudflare).
//   • Otherwise they're persisted to a local JSON file — zero setup for local dev.
// Either way reads fall back to DEFAULT_EVENTS so the public pages never break.
const useSupabase = () => Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

const COLUMNS = "slug, city, date, end_date, venue, address, time, details, sort_order";
const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "events.json");

// Normalize rows so partial/legacy records (e.g. missing end_date) stay valid.
function normalize(e: Partial<EventRow>): EventRow {
  return {
    slug: e.slug ?? "",
    city: e.city ?? "",
    date: e.date ?? "",
    end_date: e.end_date ?? "",
    venue: e.venue ?? "",
    address: e.address ?? "",
    time: e.time ?? "9:00 AM – 4:00 PM",
    details: e.details ?? "",
    sort_order: e.sort_order ?? 0,
  };
}

// ---- file backend ----
async function fileGetAll(): Promise<EventRow[]> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<EventRow>[];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(normalize);
    return DEFAULT_EVENTS;
  } catch {
    return DEFAULT_EVENTS;
  }
}

async function fileWriteAll(events: EventRow[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(events, null, 2), "utf8");
}

// ---- supabase backend ----
async function supabaseGetAll(): Promise<EventRow[] | null> {
  try {
    const { data, error } = await supabase
      .from("events")
      .select(COLUMNS)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    if (!data) return null;
    return data.map((r) => normalize(r as Partial<EventRow>));
  } catch (e) {
    console.error("[events] Supabase read failed, falling back:", e);
    return null;
  }
}

// ---- unified read ----
async function getAll(): Promise<EventRow[]> {
  if (useSupabase()) {
    const rows = await supabaseGetAll();
    if (rows && rows.length > 0) return rows;
  }
  return fileGetAll();
}

export const listEvents = createServerFn({ method: "GET" }).handler(
  async (): Promise<EventRow[]> => {
    return sortByDate(await getAll());
  },
);

function assertPassword(pw: string) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    throw new Error("ADMIN_PASSWORD is not configured on the server.");
  }
  if (pw !== expected) {
    throw new Error("Unauthorized: incorrect password.");
  }
}

export const verifyAdminPassword = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ password: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    assertPassword(data.password);
    return { ok: true as const };
  });

const eventFields = {
  city: z.string().min(1).max(100),
  date: z.string().min(1).max(200),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date"),
  venue: z.string().min(1).max(200),
  address: z.string().min(1).max(300),
  time: z.string().min(1).max(100),
  details: z.string().max(2000),
};

const updateSchema = z.object({
  password: z.string().min(1),
  slug: z.string().min(1).max(50),
  ...eventFields,
});

// Update an existing event (matched by slug); creates it if the slug is new.
export const updateEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => updateSchema.parse(d))
  .handler(async ({ data }) => {
    assertPassword(data.password);
    const { password: _password, slug, ...fields } = data;
    if (useSupabase()) {
      const { error } = await supabaseAdmin
        .from("events")
        .upsert(
          { slug, ...fields, updated_at: new Date().toISOString() },
          { onConflict: "slug" },
        );
      if (error) throw new Error(`Failed to save event: ${error.message}`);
      return { ok: true as const };
    }
    const events = await fileGetAll();
    const idx = events.findIndex((e) => e.slug === slug);
    if (idx === -1) {
      events.push(normalize({ slug, sort_order: events.length + 1, ...fields }));
    } else {
      events[idx] = { ...events[idx], ...fields };
    }
    await fileWriteAll(events);
    return { ok: true as const };
  });

const createSchema = z.object({
  password: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Slug may only contain lowercase letters, numbers and hyphens"),
  ...eventFields,
});

// Add a brand-new upcoming event. Slug must be unique.
export const createEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data }) => {
    assertPassword(data.password);
    const { password: _password, slug, ...fields } = data;
    if (useSupabase()) {
      const { count } = await supabaseAdmin
        .from("events")
        .select("slug", { count: "exact", head: true });
      const { error } = await supabaseAdmin
        .from("events")
        .insert({ slug, ...fields, sort_order: (count ?? 0) + 1 });
      if (error) {
        if (error.code === "23505") {
          throw new Error(`An event with slug "${slug}" already exists.`);
        }
        throw new Error(`Failed to add event: ${error.message}`);
      }
      return { ok: true as const };
    }
    const events = await fileGetAll();
    if (events.some((e) => e.slug === slug)) {
      throw new Error(`An event with slug "${slug}" already exists.`);
    }
    const maxOrder = events.reduce((m, e) => Math.max(m, e.sort_order), 0);
    events.push(normalize({ slug, sort_order: maxOrder + 1, ...fields }));
    await fileWriteAll(events);
    return { ok: true as const };
  });

const deleteSchema = z.object({
  password: z.string().min(1),
  slug: z.string().min(1).max(50),
});

// Remove an event (used to archive past events out of the list).
export const deleteEvent = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => deleteSchema.parse(d))
  .handler(async ({ data }) => {
    assertPassword(data.password);
    if (useSupabase()) {
      const { error } = await supabaseAdmin.from("events").delete().eq("slug", data.slug);
      if (error) throw new Error(`Failed to remove event: ${error.message}`);
      return { ok: true as const };
    }
    const events = await fileGetAll();
    await fileWriteAll(events.filter((e) => e.slug !== data.slug));
    return { ok: true as const };
  });

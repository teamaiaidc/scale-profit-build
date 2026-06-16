import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DEFAULT_EVENTS, sortByDate, type EventRow } from "./events";

// The public site renders this list on the server for the initial paint. Live edits
// from /admin are stored per-browser in localStorage (see events.store.ts) and override
// these on the client. No database or external storage is used.
export const listEvents = createServerFn({ method: "GET" }).handler(
  async (): Promise<EventRow[]> => sortByDate(DEFAULT_EVENTS),
);

// Password check for the /admin page. Validated on the server so the password never
// ships to the client. Uses the ADMIN_PASSWORD env var — no database required.
export const verifyAdminPassword = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ password: z.string().min(1) }).parse(d))
  .handler(async ({ data }) => {
    const expected = (process.env.ADMIN_PASSWORD ?? "").trim();
    if (!expected) {
      throw new Error("Admin password is not configured on the server. Please set ADMIN_PASSWORD.");
    }
    if (data.password.trim() !== expected) {
      throw new Error("Unauthorized: incorrect password.");
    }
    return { ok: true as const };
  });

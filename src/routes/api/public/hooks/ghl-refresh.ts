import { createFileRoute } from "@tanstack/react-router";
import { readEvents } from "@/lib/events.functions";
import { syncCohortSlots } from "@/lib/ghl.functions";

// Scheduled poke endpoint for GHL sync. Re-mirrors the nearest-upcoming events
// into the GHL cohort-slot custom values (cpsp_cohort_slot_1..4, slot 1 =
// nearest) so they stay correct as dates pass — point a cron at this endpoint.
export const Route = createFileRoute("/api/public/hooks/ghl-refresh")({
  server: {
    handlers: {
      POST: async () => {
        let updated = 0;
        try {
          const events = await readEvents();
          ({ updated } = await syncCohortSlots(events));
        } catch (err) {
          console.warn("[ghl-refresh] cohort sync failed:", (err as Error).message);
        }
        return new Response(
          JSON.stringify({ ok: true, updated, ranAt: new Date().toISOString() }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    },
  },
});

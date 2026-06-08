import { createFileRoute } from "@tanstack/react-router";

// Scheduled poke endpoint for GHL sync.
// Currently a no-op — we fetch GHL live each time, so there's nothing to
// reconcile on a schedule yet. Kept so pg_cron has a stable target once we
// add a local mirror or background notifications.
export const Route = createFileRoute("/api/public/hooks/ghl-refresh")({
  server: {
    handlers: {
      POST: async () => {
        return new Response(
          JSON.stringify({ ok: true, ranAt: new Date().toISOString() }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});

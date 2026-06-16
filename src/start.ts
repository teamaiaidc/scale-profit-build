import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// No serverFn in this app uses `requireSupabaseAuth` — the app authenticates
// against GHL, not Supabase. We intentionally omit `attachSupabaseAuth` so
// serverFn calls don't initialize the Supabase browser client (which would
// throw "Missing Supabase environment variable(s)" on bundles where the
// VITE_SUPABASE_* env vars aren't present).
export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
}));

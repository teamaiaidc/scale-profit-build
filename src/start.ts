import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

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
// throw "Missing Supabase environment variable(s)" on bundles built before
// the VITE_SUPABASE_* env vars were present).
export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware],
}));

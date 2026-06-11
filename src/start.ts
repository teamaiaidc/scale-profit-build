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

// Note: attachSupabaseAuth is intentionally not registered — this app does not use
// Supabase auth-protected serverFns. Bootstrapping the supabase client on every
// serverFn call was throwing in the published bundle when VITE_SUPABASE_* env vars
// weren't baked into the build, breaking routes whose loaders call serverFns
// (e.g. /checkout). Re-add it only if a serverFn starts using requireSupabaseAuth.
export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
}));

## Problem

Clicking **Continue to Payment** (Step 2 → Step 3) feels slow. The handler `goToPaymentFromSurvey` in `src/routes/checkout.tsx` awaits a chain of GHL API calls before revealing the embedded payment form:

1. `submitCheckoutToGhl` — does, sequentially:
   - `POST /contacts/upsert`
   - `GET /opportunities/pipelines`
   - `POST /opportunities/`
2. Then (if a synced contact exists) a second `pushGhlContactUpdate` for custom fields.

That's 3–4 round-trips to GHL (each ~300–800 ms) before the iframe shows. Nothing in the payment iframe actually needs these calls to complete first — they only exist so the buyer/survey is captured if payment is abandoned.

## Fix

Make the GHL save non-blocking, and shrink it where we can.

### 1. Reveal payment step immediately (frontend)

In `src/routes/checkout.tsx` → `goToPaymentFromSurvey`:

- Validate the survey as today.
- Call `submitToGhl({...})` **without `await`** (fire-and-forget) and attach `.catch` to surface errors via `setSubmitError` without blocking.
- Do the same for the optional `pushGhl` custom-fields call.
- `setStep(3)` synchronously so the embedded GHL form starts loading right away.
- Drop the `setSubmitting(true/false)` gate around the await so the button doesn't sit in a spinner — keep a lightweight "Saving in background…" indicator only if it errors.

Net effect: click → instant transition to the iframe; GHL writes happen in parallel with the iframe's own load.

### 2. Parallelize inside `submitCheckoutToGhl` (backend, optional but cheap)

In `src/lib/ghl.functions.ts`:

- Kick off `GET /opportunities/pipelines` **in parallel** with `POST /contacts/upsert` using `Promise.all`, instead of waiting for the upsert to finish first. The pipeline lookup doesn't depend on the contact.
- Keep the opportunity `POST` after both resolve (it needs `contactId` + `pipelineId`).

Saves one round-trip of latency on the server side, which matters if the user ever waits on it (e.g. retry after a background error).

### 3. No change to behavior

- Same data still written to GHL (contact upsert, opportunity, tags, custom fields).
- Same redirect-on-payment-success flow.
- Same fallback to confirmation page.

## Files touched

- `src/routes/checkout.tsx` — un-await the GHL calls in `goToPaymentFromSurvey`, advance to step 3 immediately.
- `src/lib/ghl.functions.ts` — parallelize pipelines fetch with contact upsert inside `submitCheckoutToGhl`.

## Risk

Low. If the background submit fails, the buyer can still complete payment (GHL captures them via the payment form itself); we just lose the pre-payment survey snapshot for that abandoned-cart edge case. We'll log the error and show a small inline notice so it isn't silent.

## Goal
Add live 2-way sync between the checkout form and the GHL contact identified by email. No local DB — fetch on demand from GHL.

## New server functions (`src/lib/ghl.functions.ts`)

1. **`lookupGhlContactByEmail({ email })`**
   - `GET /contacts/?locationId=...&query=<email>` → take first match
   - `GET /locations/{locationId}/customFields` → return field defs (id, name, key, dataType)
   - Returns `{ contact: { id, firstName, lastName, phone, customFields: [{id,key,value}] } | null, fieldDefs }`

2. **`pushGhlContactUpdate({ contactId, firstName?, lastName?, phone?, customFields? })`**
   - `PUT /contacts/{contactId}` with provided fields + `customFields: [{id, field_value}]`
   - Returns updated contact snapshot (same shape as lookup)

3. Keep existing `submitCheckoutToGhl` (already writes tags, opportunity, base custom fields).

## Checkout UI changes (`src/routes/checkout.tsx`)

- New hook `useGhlSync(email)`:
  - Debounced lookup (500ms) when email is valid → populates name/phone if empty, stores `contactId`, `fieldDefs`, and live `customFieldValues` in state.
  - Exposes `refresh()` for the manual button.
- **On email blur** (step 1): trigger lookup.
- **On page mount**: if `?email=` is in the URL search params (known user), pre-fetch.
- **Manual "Sync from GHL" button** next to the email field.
- **Dynamic custom fields section** (step 1, below phone): render an `<Input>` per field def returned from GHL. Edits update local state.
- **Push back**:
  - On blur of any synced field (name, phone, custom field) → debounced `pushGhlContactUpdate` if `contactId` exists.
  - Final submit still calls `submitCheckoutToGhl` (unchanged) which upserts + creates opportunity.
- Small status indicator: "Synced", "Syncing…", "Sync failed — retry".

## Scheduled refresh (cron)

- New TanStack route `src/routes/api/public/hooks/ghl-refresh.ts`
  - POST handler — no body params used.
  - Currently a no-op stub that returns `{ ok: true }`. Since we don't store contacts locally, there's nothing to reconcile yet; the route exists so pg_cron can ping it later when we add caching/notifications.
- pg_cron job (via `supabase--insert`) scheduled every 15 min hitting the stable preview/prod URL.

> Note: without a local mirror, cron can't really "sync" anything — listing as a placeholder per request. If you want real periodic reconciliation, we'd need to add a `contacts` table; let me know and I'll fold that in.

## Out of scope (ask before adding)
- Webhook receiver from GHL (`/api/public/ghl-webhook`) — not requested.
- Local DB mirror — you chose "fetch live each time".
- Card processing — still a stub.

## Files touched
- `src/lib/ghl.functions.ts` — add `lookupGhlContactByEmail`, `pushGhlContactUpdate`.
- `src/routes/checkout.tsx` — sync hook, dynamic custom fields, blur push, sync button, URL email pre-fetch.
- `src/routes/api/public/hooks/ghl-refresh.ts` — new cron stub.
- pg_cron job via `supabase--insert`.

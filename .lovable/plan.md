## Goal
Make `/admin` unlock reliably whenever the correct admin password is configured, instead of failing because unrelated backend/auth middleware is initialized or because the password secret needs manual refresh.

## Plan
1. **Remove the unintended global auth middleware from server functions**
   - `src/start.ts` already says this app does not use backend auth for server functions.
   - I will make the code match that comment by removing `attachSupabaseAuth` from `functionMiddleware`, so the admin password check no longer depends on unrelated auth environment variables.

2. **Keep the admin password check server-side**
   - Keep `verifyAdminPassword` using the `ADMIN_PASSWORD` backend secret so the password does not ship to the browser.
   - Keep trimming both entered and configured passwords to avoid accidental spaces breaking login.

3. **Improve the admin login error message**
   - If the password secret is missing or unavailable, show a clear setup message instead of making it look like the password is wrong.
   - Incorrect passwords will still show “Incorrect password.”

4. **Refresh the password secret if needed**
   - The `ADMIN_PASSWORD` secret exists, so after the middleware fix it should work.
   - If it still fails on the published site, I’ll use the secure secret update flow so you can re-enter the admin password without posting it in chat.

## Expected result
The admin password check will only depend on `ADMIN_PASSWORD`, making it stable across preview and the published site.
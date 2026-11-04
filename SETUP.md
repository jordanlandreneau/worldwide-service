# Worldwide Service: setup with its own database

The Service site runs on its own Supabase project, fully separate from Worldwide 4.0. Service content
and user accounts are copied over from 4.0 once. After that, a change in one place does not show up
in the other.

## 1. Create the Supabase project
1. In Supabase, create a new project (e.g. `worldwide-service`).
2. SQL Editor: run `supabase/migrations/0001_service_site.sql`.
3. Authentication > Sign In / Providers: turn on Google (same Google OAuth client as 4.0 works; add
   the new project's callback URL `https://<new-ref>.supabase.co/auth/v1/callback` to it in Google Cloud).
4. Authentication > URL Configuration: Site URL = the Service site's address; add
   `https://<service-site>/auth/callback` and `https://<service-site>/auth/set-password` to Redirect URLs.

## 2. Copy the data from 4.0 (once)
```
npm install
SOURCE_URL=https://jqljsqogqjumcghcvbxr.supabase.co SOURCE_SERVICE_ROLE_KEY=<4.0 service role key> \
TARGET_URL=https://<new-ref>.supabase.co TARGET_SERVICE_ROLE_KEY=<new service role key> \
node scripts/copy-from-4.0.mjs --dry-run      # check the counts, then run again without --dry-run
```
Copies: Service stores (4.0 dealerships with Service Data or marked service_required), their
Service Data, all Service pages, agent/manager/admin users, Service Admin history, and the
`service-files` bucket. It only reads from 4.0. Don't re-run it once people edit on the Service site.

Sign-ins can't be copied between Supabase projects. Google users just sign in. Email + password
users click "Forgot password" once to set a password on the new site.

## 3. Deploy on Vercel
Import the GitHub repo, set the variables in `.env.example` (pointing at the **new** project), deploy.
The HR hub variables are the same as 4.0's, so @worldwidebdc.com staff not in `app_users` still get in.

## What changed from the 4.0 starter
- `supabase/migrations/0001_service_site.sql`: only the tables Service uses (stores, Service Data,
  pages, users, edit log, files). No CRM logins, JustCall, messages, teams or sales data.
- `src/lib/manage.ts` is now just the shared `Result` type (4.0's dealership/CRM editing removed).
- `src/lib/messages.ts` replaced by `src/lib/search.ts`: top-bar search finds Service stores and pages.
- `src/lib/users.ts` keeps password reset and invite acceptance only.
- `src/lib/data.ts` drops `loadDealership` (it read CRM credentials).

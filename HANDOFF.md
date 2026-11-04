# Worldwide Service site: handoff from Worldwide 4.0

The Service section was taken out of Worldwide 4.0 (repo `jordanlandreneau/worldwide-home-4.0`,
live at https://worldwide-home-40.vercel.app) on 2026-11-04 so Service stores can have their own
site. This folder is a starter for that site: the Service pages exactly as they were in 4.0, plus
the parts of 4.0's framework they need (sign-in, layout, page components, styles, logo).

The full 4.0 code from just before the split is kept on the branch
`archive/service-before-split` in the 4.0 repo.

## What's in this folder

| Path | What it is |
|---|---|
| `src/app/(app)/service/[slug]/page.tsx` | Guidelines, Information, Training, Reference Library, Resource Center. Each page is HTML stored in the `service_pages` table (captured from 3.0), keyed by path, e.g. `/service/training?section=car-parts`. |
| `src/components/service-html.tsx` | Renders that stored HTML, with tabs. |
| `src/app/(app)/service/info/page.tsx` | Service Data: one store at a time (store picker), from `service_profiles` (scheduling, transportation, service work, diagnostics, body/glass/detailing, managers, hours, pricing, contacts, limitations, announcements). |
| `src/app/(app)/service/manage/page.tsx` + `src/lib/service-admin.ts` | Service Admin (admins only): edit a store's Service Data. Writes to `service_profiles` and logs to `edit_log`. |
| `src/lib/service-extras.ts` | Spanish/English car-parts glossary and per-store training video links. |
| `src/app/service-files/[name]/route.ts` | Serves files embedded in the Service pages from the private Supabase storage bucket `service-files` (signed-in staff only). |
| `src/components/shell.tsx` | 4.0's sidebar + top bar, trimmed to the Service menu. |
| `src/components/ui.tsx`, `action-form.tsx`, `store-picker.tsx`, `hours-grid.tsx`, `top-tools.tsx` | 4.0 page building blocks used by the Service pages. |
| `src/lib/access.ts`, `data.ts`, `supabase-auth.ts`, `users.ts`, `manage.ts`, `messages.ts` | Sign-in and roles, the database client, shared helpers. |
| `src/proxy.ts`, `src/app/login`, `auth/*`, `forgot-password`, `no-access`, `layout.tsx`, `page.tsx` | Sign-in flow (Google for @worldwidebdc.com, email + password for others), session refresh, redirects. Home now goes to `/service/guidelines`. |
| `public/worldwide.css`, `public/app-extras.css`, `public/brand`, `public/media` | 4.0's styles, logo and fonts. |
| `supabase/reference/*.sql` | 4.0 migrations that define the tables this code reads (for reference, not to re-run blindly). |
| `package.json`, `tsconfig.json`, `.env.example` | Next.js 16, React 19, Supabase. |

`top-tools.tsx` (top-bar search and clocks), `users.ts` and `messages.ts` came along because the
shell and sign-in import them; trim them to what the Service site needs.

## Stack and conventions (same as 4.0)

- Next.js 16 App Router (`src/proxy.ts` instead of middleware), React 19, TypeScript, deployed on Vercel.
- Supabase Postgres. RLS is on with no policies; all reads/writes go through the service-role client
  `db()` in `src/lib/data.ts`, so **every page and server action must call `requireUser(role)` first**.
- Roles: `dealership` < `agent` < `manager` < `admin`, from the `app_users` table, falling back to
  the HR hub (`worldwide_access` RPC) for @worldwidebdc.com emails not listed there.
- UI: `Page`, `Card`, `Table`, `Status`, `Field` from `components/ui.tsx`; `x-*` CSS classes; each
  page has its own color tone set in `shell.tsx`.
- Commits as jordanl@worldwidebdc.com.

## Data the Service site needs (all in 4.0's Supabase project `jqljsqogqjumcghcvbxr`)

- `service_pages (path, title, html, tabs)`: the Guidelines/Information/Training/Library/Resource pages.
- `service_profiles (dealership_id, data jsonb)`: each store's Service Data.
- `dealerships`, `departments`, `hours`: store list, names, time zones, hours.
- `app_users`, `user_dealerships`: who can sign in and their role.
- `edit_log`: who changed what in Service Admin.
- Storage bucket `service-files` (private).

These tables were **not** deleted or changed when Service left 4.0.

## Decision for the new build: which database

1. **Use 4.0's Supabase project (simplest).** Same logins, same store records, Service data stays
   where it is, nothing to copy. Point the new site's env vars at the same project.
2. **Give the Service site its own Supabase project.** Copy `service_pages`, `service_profiles`,
   the Service stores from `dealerships`/`hours`, and the `service-files` bucket, and set up its own
   users. More separation, more to keep in sync.

## Environment variables

From `.env.example`, the Service site needs: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_SITE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `HR_SUPABASE_URL`, `HR_SUPABASE_ANON_KEY`,
`HR_ACCESS_SECRET`, `BOOTSTRAP_ADMIN_EMAILS`, and (for invites/password resets) `RESEND_API_KEY`,
`INVITE_EMAIL_FROM`. It does **not** need the CRM password key, JustCall or appointment-text settings.
Add the new site's address to Supabase Auth's redirect URLs and the Google sign-in settings.

## Prompt to start the new conversation

> I'm building a separate site for Worldwide BDC's Service stores, split out of Worldwide 4.0. I've
> attached `service-site-starter.zip`; read `HANDOFF.md` in it first. Set it up as a new GitHub repo
> (`jordanlandreneau/worldwide-service`), get it building on Vercel, and use [4.0's Supabase project /
> its own Supabase project] for data. Then let's plan what the Service site should do beyond what 4.0 had.

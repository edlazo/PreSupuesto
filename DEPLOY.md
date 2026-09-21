# Deploying PreSupuesto on Vercel

One Vercel project, two [services](https://vercel.com/docs/services) (beta),
one domain. `vercel.json` at the repository root declares them:

| Service | Root | Serves |
| --- | --- | --- |
| `frontend` | `frontend/` | every path not listed below (Next.js) |
| `backend` | `backend/` | `/api/*` and `/health` (FastAPI, one Python function) |

The backend receives the full path (`/api/budgets`, not `/budgets`), so its
routes need no prefix. Because the app and the API share a domain, the
browser makes same-origin requests: no CORS setup, and the frontend needs no
API URL — when `NEXT_PUBLIC_API_URL` is unset, production builds call
`/api/...` on their own domain.

Supabase stays where it is: both local and deployed apps use the same database.

## What runs where

- **Hermes Agent does not run in the cloud.** It is a local process. Leave
  `HERMES_API_KEY` unset in production: the chat then goes straight to the
  Gemini fallback, which runs the same budget tools inside the API.
- The Gemini chat keeps each conversation in memory. A function instance that
  goes idle is recycled, so after a long pause the assistant starts a fresh
  conversation. The budget itself is always in the database.
- `backend/.env` and `frontend/.env.local` are never deployed (gitignored).
  Every setting comes from the project's environment variables.

## Setting it up

1. In Vercel: **Add New → Project**, import `edlazo/PreSupuesto`, keep the
   Root Directory at the repository root. Vercel reads `vercel.json` and shows
   the **Services** preset with both services.
2. **Environment Variables** (Production). They are shared by both services;
   only `NEXT_PUBLIC_*` values ever reach the browser, so the secrets below
   stay on the server.

   | Name | Value |
   | --- | --- |
   | `SUPABASE_URL` | same as `backend/.env` |
   | `SUPABASE_KEY` | the **service role** key, same as `backend/.env` |
   | `GEMINI_API_KEY` | same as `backend/.env` |
   | `ACCESS_KEY` | a **new** key: `python backend/new_access_key.py https://<domain>` |
   | `COMPANY_NAME` | printed as the issuer on the PDF and in its footer |
   | `COMPANY_TAX_ID`, `COMPANY_ADDRESS`, `COMPANY_EMAIL`, `COMPANY_PHONE` | optional; an unset one is left off the PDF |

   Do not set `HERMES_API_KEY`, `NEXT_PUBLIC_API_URL` or `CORS_ORIGINS`.
   `DEFAULT_CURRENCY` (ARS) and `DEFAULT_TAX_RATE` (0) already default to the
   right values.
3. Deploy.
4. **Settings → Functions → Region:** pick the region closest to the Supabase
   project (Supabase shows it under Project Settings → General), then
   redeploy. Every request makes several database round trips, so this
   matters more than anything else for speed.

## Checking it

- `https://<domain>/health` answers
  `"supabase_configured": true, "access_configured": true`.
- `https://<domain>/api/budgets` answers 401: nothing is readable without a
  session.
- `https://<domain>/entrar#k=<ACCESS_KEY>` lands on the desk, signed in. That
  link is what the user gets.

## Day to day

- Every push to `main` redeploys.
- **A leaked link:** generate a new key with `new_access_key.py`, replace
  `ACCESS_KEY` in the project, redeploy. Every old link and session stops
  working at once.
- **Changing a variable** (a `COMPANY_*`, a key): edit it, then redeploy —
  settings are read when the function starts.
- **A schema change:** run the migration in the Supabase SQL editor before
  pushing the code that needs it.

## Limits worth knowing (Hobby plan)

- A request can run for up to 300 s, which covers the longest chat turn.
- Request and response bodies are capped at 4.5 MB; a budget PDF is a few KB.
- The Hobby plan is meant for personal, non-commercial use. Moving to Pro
  changes nothing in this setup.
- Services are in beta. If they ever get in the way, the fallback is two
  projects from the same repository (Root Directory `backend` with the FastAPI
  preset, and `frontend` with Next.js), with `NEXT_PUBLIC_API_URL` pointing the
  app at the API and `CORS_ORIGINS` letting it in.

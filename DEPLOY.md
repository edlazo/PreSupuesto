# Deploying PreSupuesto on Vercel

Two Vercel projects built from this one repository:

| Project | Root Directory | What it is |
| --- | --- | --- |
| `presupuesto-api` | `backend` | FastAPI, run as a single Python Vercel Function |
| `presupuesto` | `frontend` | The Next.js app |

Supabase stays where it is: both environments talk to the same database.

## What runs where

- **Hermes Agent does not run in the cloud.** It is a local process. Leave
  `HERMES_API_KEY` unset in production: the chat then goes straight to the
  Gemini fallback, which runs the same budget tools inside the API.
- The Gemini chat keeps each conversation in memory. A function instance that
  goes idle is recycled, so after a long pause the assistant starts a fresh
  conversation. The budget itself is always in the database.
- `backend/.env` is never deployed (it is gitignored). Every setting comes
  from the project's environment variables.

## 1. The API (`presupuesto-api`)

1. In Vercel: **Add New → Project**, import `edlazo/PreSupuesto`.
2. **Root Directory:** `backend`. Vercel detects FastAPI from
   `requirements.txt` and loads `app` from `main.py`. Python comes from
   `backend/.python-version` (3.13).
3. **Environment Variables** (Production):

   | Name | Value |
   | --- | --- |
   | `SUPABASE_URL` | same as `backend/.env` |
   | `SUPABASE_KEY` | the **service role** key, same as `backend/.env` |
   | `GEMINI_API_KEY` | same as `backend/.env` |
   | `ACCESS_KEY` | a **new** key: `python backend/new_access_key.py https://<frontend-domain>` |
   | `CORS_ORIGINS` | `https://<frontend-domain>` — set after step 2, see below |
   | `COMPANY_NAME`, `COMPANY_TAX_ID`, `COMPANY_ADDRESS`, `COMPANY_EMAIL`, `COMPANY_PHONE` | what the PDF should print, if set locally |

   Do not set `HERMES_API_KEY`. `DEFAULT_CURRENCY` (ARS) and
   `DEFAULT_TAX_RATE` (0) already default to the right values.
4. **Settings → Functions → Region:** pick the region closest to the Supabase
   project (Supabase shows it under Project Settings → General). Every request
   makes several database round trips, so this matters more than anything
   else for speed.
5. Deploy, then open `https://<api-domain>/health`. It must answer
   `"supabase_configured": true, "access_configured": true`. Any other route
   answers 401 without a session, and 503 if `ACCESS_KEY` is missing.

## 2. The web app (`presupuesto`)

1. **Add New → Project**, import the same repository.
2. **Root Directory:** `frontend`. Framework preset: Next.js.
3. **Environment Variables:**

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_API_URL` | `https://<api-domain>` (no trailing slash) |

   `NEXT_PUBLIC_*` values are baked in at build time: changing it needs a
   redeploy.
4. Deploy.

## 3. Connect them

1. Back in `presupuesto-api`, set `CORS_ORIGINS` to the web app's production
   domain, e.g. `https://presupuesto.vercel.app`, and redeploy the API.
2. Open `https://<frontend-domain>/entrar#k=<ACCESS_KEY>`. It should land on
   the desk, signed in. That link is what the user gets.

## Day to day

- Every push to `main` redeploys both projects. In each project, **Settings →
  Build and Deployment → Skip deployments when there are no changes to the root
  directory** avoids rebuilding the side that did not change.
- **A leaked link:** generate a new key with `new_access_key.py`, replace
  `ACCESS_KEY` in `presupuesto-api`, redeploy. Every old link and session stops
  working at once.
- **A schema change:** run the migration in the Supabase SQL editor before
  pushing the code that needs it.

## Limits worth knowing (Hobby plan)

- A request can run for up to 300 s, which covers the longest chat turn.
- Request and response bodies are capped at 4.5 MB; a budget PDF is a few KB.
- The Hobby plan is meant for personal, non-commercial use. Moving to Pro
  changes nothing in this setup.

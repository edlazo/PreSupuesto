# PreSupuesto backend

FastAPI server for the materials management table and the Hermes Agent chat,
backed by Supabase (PostgreSQL).

## Layout

| Path | Purpose |
| --- | --- |
| `main.py` | FastAPI app: materials CRUD and `/api/chat` |
| `config.py` | Settings read from `backend/.env` |
| `models.py` | Pydantic request and response types |
| `services/supabase_service.py` | Every database read and write |
| `services/hermes_service.py` | HTTP client for the Hermes Agent API server |
| `services/agent_service.py` | Picks the engine: Hermes, or the Gemini fallback |
| `services/pdf_service.py` | Renders a budget as an A4 PDF with reportlab |
| `services/currency_service.py` | Blue dollar rate, read from dolarapi.com and cached briefly |
| `tools/budget_tools.py` | The agent tools: catalogs, estimates, clients, budgets |
| `mcp_server.py` | Serves those tools to Hermes Agent over MCP |

## How the pieces fit

Hermes Agent runs as its own process, not as a library inside FastAPI. Two
connections join it to this backend:

```
Next.js ──HTTP──> FastAPI /api/chat ──> agent_service
                                          │
                        reachable?  ──────┴──────  unreachable
                             │                          │
                             v                          v
                  Hermes Agent API server        Gemini API
                             │                          │
                        MCP (stdio)              same tools, in
                             v                   this process
                   backend/mcp_server.py                │
                             └──── tools/budget_tools.py ┘
                                          │
                                 services/supabase_service.py
```

The REST endpoints talk to Supabase directly; both agent paths reach the same
data through the same tools, and everything shares `supabase_service.py`.

## The Gemini fallback

Hermes Agent is the primary engine. When its gateway cannot be reached — not
running, wrong URL, or answering 5xx — `agent_service` answers with the Gemini
API instead and runs `tools/budget_tools.py` in this process through function
calling. A 4xx from Hermes is *not* a fallback: the gateway is up and rejecting
the request, and hiding that would mask a configuration problem.

Set `GEMINI_API_KEY` in `backend/.env` to enable it. `GEMINI_MODEL` picks the
model and `GEMINI_FALLBACK_MODELS` lists the ones to try when it answers 503
("high demand") or 429 (rate limit) — both are counted per model, so the next
model in the chain often answers.

What differs on the fallback path:

* conversations live in this process, under a session id prefixed `gemini-`,
  and are lost on restart — Hermes is what persists them;
* a session stays on the engine that started it while that engine is available,
  so the fallback conversation is not cut in half when Hermes comes back;
* `POST /api/chat` reports which engine answered in its `engine` field.

## Setup

1. Create the database objects by running `supabase/schema.sql` in the Supabase
   SQL editor.

2. Install dependencies:

```bash
cd backend && python -m venv venv && venv/Scripts/python -m pip install -r requirements.txt
```

3. Copy `.env.example` to `.env` and fill it in. `SUPABASE_KEY` must be the
   **service role** key: the schema turns on Row Level Security with no
   policies, so the anon key reads nothing.

4. Run the API:

```bash
cd backend && uvicorn main:app --reload
```

Interactive docs are then at http://127.0.0.1:8000/docs.

## Wiring up Hermes Agent

`/api/chat` needs a running Hermes Agent. Install it from
[hermes-agent.nousresearch.com](https://hermes-agent.nousresearch.com/), then:

1. Add the MCP server block from `hermes.config.example.yaml` to
   `~/.hermes/config.yaml`, with absolute paths to this project's venv Python
   and to `backend/mcp_server.py`. That is what gives the agent the budgeting
   tools.

2. Enable the API server in `~/.hermes/.env`:

```
API_SERVER_ENABLED=true
API_SERVER_KEY=<a long random string>
API_SERVER_PORT=8642
```

3. Put the same key in `backend/.env` as `HERMES_API_KEY`.

4. Start the agent:

```bash
hermes gateway
```

Check the wiring with `GET /health`, which reports whether Supabase, Hermes and
the Gemini fallback are configured, and with `hermes chat -q "List the materials in the catalog"`,
which exercises the MCP tools without the web app.

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Configuration status |
| GET | `/api/materials` | `search`, `category`, `is_active`, `limit`, `offset`; total count in the `X-Total-Count` header |
| POST | `/api/materials` | Create. The `code` may be omitted: it is then generated from the category, e.g. `MAT-ALB-004` |
| POST | `/api/materials/bulk-update-price` | Shift prices by a percentage: `{"percentage": 12.5, "category": "Albañilería", "only_active": true}`. A negative percentage lowers them |
| GET | `/api/materials/{id}` | Read one |
| PUT / PATCH | `/api/materials/{id}` | Update the fields present in the body |
| DELETE | `/api/materials/{id}` | Fails with 409 when a budget uses the material — deactivate it instead |
| POST | `/api/budgets` | Start an empty budget. Without `client_id` it hangs off the stand-in "Consumidor final" client |
| POST | `/api/budgets/{id}/items` | Append a line from a `material_id`, a `standard_task_id`, or free text. Answers with the whole budget |
| DELETE | `/api/budgets/{id}/items/{item_id}` | Remove a line. Answers with the whole budget |
| PATCH | `/api/budgets/{id}` | Change the header: `client_id`, `title`, `status`, `description`, `site_address`, `valid_until`. Only the fields sent are written |
| GET | `/api/standard-tasks` | Labor tasks catalog, for the manual entry form |
| GET | `/api/clients` | Clients a budget can be addressed to; `search`, `limit` |
| POST | `/api/clients` | Create. Only `full_name` is required |
| GET | `/api/clients/{id}` | Read one |
| GET | `/api/budgets` | Budget headers, newest first; `client_id`, `status`, `limit` |
| GET | `/api/budgets/{id}` | One budget with its lines — what the web app's budget preview reads |
| GET | `/api/budgets/{id}/pdf` | The budget as a PDF, sent as an attachment with a suggested filename. `?currency=USD` converts it, `&rate=` sets the rate to apply |
| GET | `/api/currency/blue` | Current blue dollar buy and sell prices. `?refresh=true` skips the cache |
| POST | `/api/chat` | `{"message": "...", "session_id": "..."}`; send the returned `session_id` back to keep the conversation. The answer's `engine` is `hermes` or `gemini` |

## Material codes

Codes read `MAT-<CATEGORY>-<NUMBER>`. Leaving the code out of a create request
has `supabase_service.generate_material_code()` build one: the category maps to
a three-letter prefix (`Albañilería` → `ALB`, `Pintura` → `PIN`; an unknown
category falls back to the first letters of its first meaningful word), and the
number continues after the highest one already used in that category, so a
deleted material never has its code handed to a different one.

Two people creating a material at the same moment can land on the same number.
The insert is retried with a fresh code on a unique violation rather than
failing with a conflict; any other error is raised as-is.

## Budgets, by hand or by agent

A budget is built two ways and both write the same rows: the web app posts
lines to `/api/budgets/{id}/items`, and the agent calls its `create_budget`
tool. Catalog prices are copied onto the line either way, so a later price
change leaves stored budgets alone.

`budgets.client_id` is not nullable, but a budget usually starts before anyone
has asked the customer their name. Creating one without a client attaches a
single stand-in row named "Consumidor final"; set a real client when you have
one.

## Currency

Amounts are Argentine by default: `DEFAULT_CURRENCY=ARS` in `backend/.env`,
printed as `$ 2.599,44`. Dollars print as `u$s 1.200,00`, and any other code is
printed as-is. Both the PDF and the web interface follow the same convention.

## Blue dollar

`GET /api/currency/blue` reads dolarapi.com and caches the answer for a minute,
so the header widget and the budget preview can both ask for it freely. The
widget's refresh button sends `?refresh=true`, which goes upstream again.

The rate is only ever used to *show* a budget in dollars: budgets are stored in
pesos, and nothing is written back converted.

## Budget PDFs

`GET /api/budgets/{id}/pdf` renders an A4 quote with reportlab, written in
Spanish for the client: issuer and client blocks, the lines grouped into
materials, labor and other costs, then the subtotals, tax and total the
database computed. The client block is filled
from the `clients` row when it can be read, and the document still renders
without it.

The issuer block comes from `backend/.env`, all optional except the name:

```
COMPANY_NAME=Construcciones Lazo S.L.
COMPANY_TAX_ID=B-12345678
COMPANY_ADDRESS=Calle Mayor 14, 28013 Madrid
COMPANY_EMAIL=hola@example.com
COMPANY_PHONE=+34 600 000 000
```

The response carries `Content-Disposition` with a name like
`budget-0001-kitchen-renovation.pdf`, and exposes that header to CORS so the
browser can use the name.

## Agent tools

`list_materials`, `get_material`, `list_standard_tasks`, `calculate_estimate`,
`list_clients`, `create_client`, `create_budget`, `get_budget`.

They follow the Hermes tool contract: the handler takes `(args, **kwargs)`,
returns a JSON **string**, and reports failures as `{"error": "..."}` instead
of raising, so a bad argument becomes something the agent can read and correct.

`calculate_estimate` prices lines without storing anything; `create_budget`
persists them and lets the database compute the totals. Both accept lines
priced from the materials catalog (`material_code`, with an optional
`waste_percent`), from the standard tasks catalog (`task_code`), or free lines
carrying their own `description`, `unit` and `unit_price`.

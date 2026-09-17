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
| `tools/budget_tools.py` | The agent tools: catalogs, estimates, clients, budgets |
| `mcp_server.py` | Serves those tools to Hermes Agent over MCP |

## How the pieces fit

Hermes Agent runs as its own process, not as a library inside FastAPI. Two
connections join it to this backend:

```
Next.js  ──HTTP──>  FastAPI /api/chat  ──HTTP──>  Hermes Agent API server
                                                          │
                                                        MCP (stdio)
                                                          v
                                            backend/mcp_server.py
                                            └─ tools/budget_tools.py
                                               └─ services/supabase_service.py
```

The REST endpoints talk to Supabase directly; the agent reaches the same data
through the tools. Both paths share `supabase_service.py`.

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

Check the wiring with `GET /health`, which reports whether Supabase and Hermes
are configured, and with `hermes chat -q "List the materials in the catalog"`,
which exercises the MCP tools without the web app.

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health` | Configuration status |
| GET | `/api/materials` | `search`, `category`, `is_active`, `limit`, `offset`; total count in the `X-Total-Count` header |
| POST | `/api/materials` | Create |
| GET | `/api/materials/{id}` | Read one |
| PUT / PATCH | `/api/materials/{id}` | Update the fields present in the body |
| DELETE | `/api/materials/{id}` | Fails with 409 when a budget uses the material — deactivate it instead |
| POST | `/api/chat` | `{"message": "...", "session_id": "..."}`; send the returned `session_id` back to keep the conversation |

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

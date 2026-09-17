# PreSupuesto frontend

Next.js (App Router) + Tailwind CSS interface for PreSupuesto. It talks only to
the FastAPI backend — Supabase and Hermes Agent are never called from the
browser.

The interface is written in Argentine Spanish; the code, props and comments
stay in English. Display strings live inside the components that show them,
with no translation layer — there is one language to serve.

## Layout

| Path | Purpose |
| --- | --- |
| `app/layout.tsx` | Shared shell: header navbar with branding and navigation |
| `app/page.tsx` | Workspace: chat on the left, live budget preview on the right |
| `app/materials/page.tsx` | Materials management view |
| `components/ChatPanel.tsx` | Conversation with the agent, session continuity |
| `components/BudgetPreview.tsx` | Newest budget, grouped into materials / labor / other, with Export PDF |
| `components/MaterialsTable.tsx` | Data table with search, inline price editing and delete |
| `components/MaterialFormDialog.tsx` | Modal form used to create and edit a material |
| `lib/api.ts` | Typed client for the backend REST endpoints |
| `lib/types.ts` | Types mirroring the backend's Pydantic models |

## Setup

1. Copy `.env.local.example` to `.env.local`:

```bash
cp .env.local.example .env.local
```

`NEXT_PUBLIC_API_URL` must point at the FastAPI backend, and
`NEXT_PUBLIC_CURRENCY` should match `DEFAULT_CURRENCY` in `backend/.env`.

2. Install and run, with the backend already running on port 8000:

```bash
cd frontend && npm install && npm run dev
```

The app is then at http://localhost:3000.

## How the two views work

**Workspace** — every completed chat turn refetches the newest budget, so the
card on the right fills in as soon as the agent stores one. It splits the lines
into materials, labor and other costs, and shows the subtotal, tax and total the
database computed. "Export PDF" downloads the file the backend renders at
`GET /api/budgets/{id}/pdf`, keeping its suggested filename; a failure shows as
a banner above the card rather than an error page in a new tab. The print
stylesheet is still there, so Ctrl+P prints the card on its own.

**Materials** — lists the catalog from `GET /api/materials`. The quick update
control applies a percentage to every active price in scope — the whole catalog,
or just the filtered category — through `POST /api/materials/bulk-update-price`,
after a confirmation. A negative percentage lowers prices. A unit price can also
be edited in place by clicking it, and the pencil-free row actions open the full
form or delete the row. A material already used by a budget cannot be deleted;
the backend answers 409 and the table shows that message, so deactivate it
instead.

## Currency

`NEXT_PUBLIC_CURRENCY` (default `ARS`) drives `lib/format.ts`, which prints
`$ 2.599,44` for pesos and `u$s 1.200,00` for dollars, in Argentine digit
grouping. Amounts are formatted by hand rather than by Intl's currency style,
which would print `US$` instead of the local `u$s`.

## Theming

Colors are CSS variables on `:root` in `app/globals.css`, re-declared under
`prefers-color-scheme: dark` and exposed to Tailwind through `@theme inline`.
Components only use the token classes (`bg-surface`, `text-muted`,
`border-border`, …), so both themes follow from that one file.

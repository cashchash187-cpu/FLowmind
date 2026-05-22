# FlowMind

FlowMind is an AI Conversation Copilot — a SaaS web app that listens to live conversations, transcribes them in real time with speaker diarization, and provides instant AI assistance during meetings.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/flowmind run dev` — run the React frontend (port 22473)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS + shadcn/ui + wouter + TanStack Query
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for all API contracts)
- `lib/db/src/schema/` — Drizzle schema (sessions, transcripts, meeting_notes, ai_assists, usage, usage_history)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/flowmind/src/` — React frontend (pages, components)

## Architecture decisions

- Contract-first: OpenAPI spec gates codegen which gates the frontend — no hand-written API types
- AI responses are pre-defined suggestion pools (no external AI API keys required for MVP)
- Usage tracking and plan limits are stored in the DB and served via REST endpoints
- Speaker diarization is simulated on the frontend; real STT integration would hook into the transcript POST endpoint
- Session stats are computed with aggregate SQL queries for dashboard performance

## Product

- **Dashboard** — overview of recent sessions, usage stats, quick-start action
- **Live Session (Copilot mode)** — transcript timeline with speaker labels, AI Assist button with 4 modes (Objection/Idea, Answer, Explain, Logic Check)
- **Live Session (Notes mode)** — auto-updating meeting notes: summary, action items, decisions, open questions, key insights
- **History** — searchable list of past sessions
- **Pricing** — Free / Pro / Business SaaS tiers
- **Settings** — account info and usage tracking

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always re-run codegen after changing `openapi.yaml`: `pnpm --filter @workspace/api-spec run codegen`
- The `/sessions/stats` and `/sessions/recent` routes must come before `/sessions/:id` in the router or Express will match them as IDs
- Array columns in Drizzle: use `.array()` method — `text("tags").array()`, not `array(text("tags"))`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

# FlowMind

Real-time meeting copilot: live transcription (Deepgram for Pro, browser STT for Free), AI assistance (copilot suggestions, contextual insights, automatic Tavily research). pnpm workspace monorepo deployed as a **single-origin** service on Railway.

## Run & operate

Local dev:
- `pnpm install`
- `pnpm --filter @workspace/api-server run dev` — API on `PORT` (default 8080)
- `pnpm --filter @workspace/flowmind run dev` — frontend (Vite) on `5173`
- `pnpm run typecheck` — typecheck everything
- `pnpm run build` — typecheck + build all packages (used by the Docker build)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas from `lib/api-spec/openapi.yaml`
- `pnpm --filter @workspace/db run push` — push Drizzle schema to `DATABASE_URL`

Production runs as ONE process: the api-server bundle (`artifacts/api-server/dist/index.mjs`) serves both `/api/*` and the React build (copied to `dist/public/`) with a SPA fallback. WS upgrades for `/api/ws/transcribe` are handled on the same `http.Server`.

## Required env vars

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. Railway sets it via the Postgres add-on. |
| `AUTH_JWT_SECRET` | yes (prod) | ≥16 chars. Falls back to `JWT_SECRET` for backwards-compat. App refuses to start in production without it. |
| `LLM_API_KEY` | yes (for AI features) | Provider key. Default is Google Gemini via OpenAI-compat. |
| `LLM_BASE_URL` | yes | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| `LLM_MODEL` | yes | `gemini-2.5-flash` |
| `DEEPGRAM_API_KEY` | for Pro live STT | Without it, paid users fall back to browser STT. |
| `TAVILY_API_KEY` | for auto-research | Insights skip the research call if absent. |
| `PORT` | injected by Railway | Local default 8080. |
| `HOST` | optional | Defaults to `0.0.0.0`. |
| `PUBLIC_BASE_URL` | optional | Forces the public URL used to build Stripe redirects + similar. Derived from `RAILWAY_PUBLIC_DOMAIN` otherwise. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | optional | Direct Stripe; if unset, Stripe is gracefully skipped at boot. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | Enables Google OAuth login. |
| `SMTP_USER` / `SMTP_PASS` / `SMTP_HOST` / `SMTP_PORT` | optional | Magic-code email login. |

See [.env.example](.env.example) for a full template.

## Railway deploy

Project lives on Railway as project **flowmind** with two services: `Postgres` (managed add-on) and `flowmind` (this app, built from [Dockerfile](Dockerfile) per [railway.json](railway.json)).

The Railway CLI lives at `$USERPROFILE\.npm-global\railway.cmd` on Windows after `npm install -g @railway/cli`.

```powershell
$env:Path = "$env:USERPROFILE\.npm-global;" + $env:Path
railway login                      # one-time auth
railway link --project flowmind
railway service flowmind           # link local dir to the app service
railway up --detach                # build + deploy from Dockerfile
railway logs --service flowmind --build         # build logs
railway logs --service flowmind --deployment    # runtime logs
railway variables --service flowmind            # list env vars
railway domain --service flowmind               # show / regenerate the public domain
```

Public URL: <https://flowmind-production.up.railway.app>. Healthcheck path: `/health`.

### DB schema changes

The api-server seeds users at boot but does not apply schema. Push the Drizzle schema manually whenever you change `lib/db/src/schema/`:

```powershell
# DATABASE_PUBLIC_URL = Postgres "public" connection (proxy.rlwy.net)
$env:DATABASE_URL = (railway variables --service Postgres --kv | Select-String DATABASE_PUBLIC_URL).Line.Split("=",2)[1]
& "$pwd\lib\db\node_modules\.bin\drizzle-kit.cmd" push --config ./lib/db/drizzle.config.ts
```

(Schema is declarative — drizzle-kit reconciles the live DB with `src/schema/*.ts`. No migration files.)

### Seed users (created on first boot)

- `marcel` / `Admin1234!!` — admin
- `user1`..`user4` / `Password1234!` — free/pro

## Stack

- pnpm workspaces, Node 24, TypeScript 5.9
- Frontend: React 19 + Vite 7 + Tailwind 4 + shadcn/ui + wouter + TanStack Query, Zustand for auth state
- API: Express 5 (`app.use(express.static(dist/public))` + SPA fallback after `/api`)
- WS: `ws` library on the shared `http.Server` for `/api/ws/transcribe`
- DB: Postgres + Drizzle ORM (declarative push, no migration files)
- Validation: Zod + drizzle-zod
- API codegen: Orval (from the OpenAPI spec)
- Build: esbuild (single ESM bundle, externalises `bcrypt`/`nodemailer`)
- LLM: provider-agnostic via OpenAI-compatible HTTP — default Gemini 2.5 Flash
- STT: Deepgram nova-2 (Pro), browser SpeechRecognition (Free)
- Research: Tavily

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for the API contract)
- `lib/api-zod/`, `lib/api-client-react/` — generated, never hand-edit
- `lib/db/src/schema/` — Drizzle schema
- `lib/integrations-openai-ai-server/src/client.ts` — provider-agnostic LLM client (chat). `image/` and `audio/` mirror it for those modalities. None throw at boot if the key is missing — they log a warning and let calls fail explicitly.
- `artifacts/api-server/src/routes/` — Express routes (specific paths before parameterized `:id` routes)
- `artifacts/api-server/src/ws/transcribe.ts` — Deepgram WS bridge
- `artifacts/api-server/src/lib/insight-engine.ts` + `insight-ticker.ts` — LLM-driven insight generation with hard gates (≥25s + ≥150 new chars) and 90s research cooldown
- `artifacts/api-server/src/app.ts` — registers `/health`, mounts API, serves static frontend + SPA fallback
- `artifacts/flowmind/src/lib/transcription/` — browser STT + Deepgram client (same-origin WS, exponential backoff on disconnect)
- `artifacts/flowmind/src/lib/auth.ts` — `apiFetch`, JWT + CSRF cookie handling

## Conventions

- **OpenAPI-first**: change `lib/api-spec/openapi.yaml`, regen codegen, never hand-edit `api-zod` / `api-client-react`.
- **Express 5 route order**: specific routes (e.g. `/sessions/stats`, `/sessions/recent`) before `/sessions/:id`.
- **Auth**: all data routes go through `requireAuth` (see `src/routes/index.ts`). Admin routes are gated by `requireAdmin` after that.
- **Same-origin frontend**: `apiFetch` uses `import.meta.env.BASE_URL` as the prefix (defaults to `/`). The Deepgram WS client uses `window.location.host`, so a Railway deploy needs no special config to route WS through the same origin.
- **No new Tailwind color tokens** — reuse the existing ones.
- **Never log plaintext passwords / magic codes.**
- **No public username/password signup endpoint** — Google OAuth + email magic code only.
- `pnpm-lock.yaml` is committed; `node_modules/.cache/dist/.env*/.tsbuildinfo` stay gitignored.

## Gotchas

- Always re-run codegen after changing `openapi.yaml`: `pnpm --filter @workspace/api-spec run codegen`.
- `/sessions/stats` and `/sessions/recent` MUST come before `/sessions/:id` in `routes/index.ts`.
- Array columns in Drizzle: `text("tags").array()`, not `array(text("tags"))`.
- The api-server bundles via esbuild and only externalises `bcrypt` + `nodemailer` at runtime — the runtime Docker stage installs those two directly into `/app/node_modules` so the bundled `require()` resolves them.
- The frontend's `dist/public` gets copied into the api-server's `dist/public` in the Docker builder stage; `app.ts` finds it via the `PUBLIC_DIR` env or the bundle-adjacent path.
- WS reconnect: the client retries with exponential backoff on close, except for 4001 (auth), 4003 (plan), 4004 (session). On reconnect a new Deepgram session is opened — already-persisted finals stay in the DB.

## Product surfaces

- **Dashboard** — recent sessions, usage stats, quick start
- **Live Session (Copilot)** — transcript + AI Assist with modes Objection/Idea, Answer, Explain, Logic Check
- **Live Session (Insight)** — passive LLM-driven tips + automatic web research when a fact gap is detected
- **Live Session (Notes)** — auto meeting notes: summary / action items / decisions / open questions / key insights
- **History** — searchable past sessions
- **Pricing** — Free / Pro / Business
- **Settings** — account + usage

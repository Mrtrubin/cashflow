# AGENTS.md

## Commands

- Package manager: **pnpm** (only `pnpm-lock.yaml` exists; don't use npm/yarn).
- `pnpm dev` — dev server (localhost:3000)
- `pnpm build` — production build; `pnpm start` — run the build
- `pnpm lint` — `biome check` (lint + format + import order); `pnpm format` — write fixes
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm db:migrate` — apply `db/migrations/*.sql` to the Neon branch (reads `.env.local`)
- `pnpm db:env` — link the Neon project + pull `DATABASE_URL` / `NEON_AUTH_BASE_URL` into `.env.local`
- No test runner is configured yet. Spec plans Vitest for parsers/stats/sync — don't invent test scripts.

## Toolchain

- Biome, not ESLint/Prettier. Formatter: 2-space indent; imports are auto-organized (`pnpm lint` fails on unsorted imports).
- TypeScript `strict` mode. Path alias `@/*` → `./src/*`.
- React Compiler is enabled (`reactCompiler: true` in `next.config.ts`) — don't add manual `useMemo`/`useCallback` for memoization.
- Next.js 16, React 19, App Router (`src/app`).

## Cloud backend: Neon

- **Neon (Lakebase Postgres) is the only cloud database.** Supabase was removed — do not reintroduce `@supabase/*`, `supabase/` migrations, RLS policies, or `NEXT_PUBLIC_*` DB credentials.
- Project: `dark-bird-91089133` (`cashflow`, `aws-ap-southeast-1`, branch `production`, database `neondb`). Do not touch other Neon projects in the org.
- Env vars in `.env.local` (gitignored): `DATABASE_URL` (pooled `-pooler`, app traffic), `DATABASE_URL_UNPOOLED` (direct, migrations), `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` (32+ chars, `openssl rand -base64 32`).
- `src/server/db.ts` throws at import if `DATABASE_URL` is missing; it is `server-only`. The DB credential must never reach the browser.
- Driver: `pg` (node-postgres) with a pooled connection. Use `query` / `queryOne` / `withTransaction` from `src/server/db.ts`; don't open ad-hoc clients.

## Auth: Neon Auth (Managed Better Auth)

- Email OTP (`emailOtp.sendVerificationOtp` + `signIn.emailOtp`) — not Magic Link, not passwords.
- Server: `src/server/auth.ts` exports `auth` (`createNeonAuth`) and `requireUser()`. Every `/api/v1/*` route starts with `requireUser()`; it throws `ApiError(401)`.
- Browser: `src/lib/auth/client.ts` exports `authClient` (`createAuthClient()` — no arguments). It only talks to the same-origin proxy `src/app/api/auth/[...path]/route.ts`.
- Session lives in HttpOnly cookies signed with `NEON_AUTH_COOKIE_SECRET`. Never read or store tokens in client code.

## Business logic lives in Next (server), not the browser

- `src/server/**` owns authorization, validation (`validation.ts`, zod), persistence (`repositories.ts`), sync rules (`services/sync.ts`), backup/restore + account deletion (`services/backup.ts`).
- API surface (`src/app/api/v1`): `POST /sync/push`, `GET /sync/pull?cursor=`, `GET|POST /backup`, `DELETE /account`, `GET /me`.
- Client (`src/lib/repo.ts`, `src/lib/sync.ts`) is an offline cache + UI: it writes IndexedDB first, enqueues an `outbox` item, and syncs through the API. `src/lib/api/client.ts` is the only fetch wrapper.
- Stats (`src/lib/stats.ts`) stay client-side for offline rendering; they are pure functions over the local ledger.
- Push order matters: accounts → categories → import batches → transactions → budgets → user settings; ≤200 rows per batch. Rows are applied one-by-one with savepoints, so one bad row doesn't reject the batch.
- Client outbox rules (`src/lib/sync.ts`): only delete the queue entries the server confirmed in `applied`; rejected rows stay queued (retry, `attempts` capped at 5) instead of being dropped silently. First sync for a device uploads the whole local ledger when the cloud is empty — do not gate that on the outbox being empty, or accounts/categories created before login never leave the device. `resyncAll()` re-queues everything (used by 账号与同步 → 重新上传本机全部数据).

## Schema conventions (`db/migrations/0001_init.sql`)

- All tables use UUID primary keys, `user_id` (FK → `neon_auth."user"`, `on delete cascade`), `created_at`/`updated_at`, and soft delete via `deleted_at` (deletes set `deleted_at`, never hard-delete).
- `updated_at`/`created_at` are written by the `stamp_timestamps` trigger (server time) — don't rely on client timestamps. `keep_deleted` prevents resurrecting soft-deleted rows.
- No RLS: the database is only reachable from the Next server, which enforces ownership in SQL (`where user_id = $1`) and in `ownedIds()` reference checks. If you add a table, scope every query by `user_id`.
- Amounts are `bigint` (integer cents/CNY fen). Never store floats or use float math for money.
- Migrations are append-only: add `db/migrations/NNNN_name.sql`, run `pnpm db:migrate`, never hand-edit the remote schema.

## Text import: script-only rules

- There is **no built-in parse format and no column-mapping mode** (the old `columns` engine was removed). A `ParseRule` (`src/lib/parse-rule.ts`) is a JS function body; without a saved rule the import page cannot parse.
- Scripts run in `src/lib/script-runner.ts`: an iframe with `sandbox="allow-scripts"` (opaque origin, no parent DOM/storage/cookies), 3 s timeout, one iframe per parse, destroyed afterwards. **Never move this into the Next server** — the server holds `DATABASE_URL`.
- Rules are stored per device in IndexedDB (`src/lib/parse-rule-store.ts`, meta keys `import:rules` / `import:activeRuleId`) and are intentionally **not synced**. `normalizeRule` drops rules without a script, so legacy column rules disappear.
- Script results are validated in `buildScriptRow` (`src/lib/parse-text.ts`): `date` + `amount` required, amount in 元 → cents, `category`/`account` names (or ids) resolved against the local ledger, unknown names become confirm rows with inline pickers.
- Importability rules: a non-transfer row needs a category that exists in the ledger (name + kind); a transfer row needs both ends in `account` as `转出>转入`. Rows failing either stay "需确认" and are excluded from the import.
- Rows left on the 「其他」 fallback are flagged in the preview with an inline category picker (not blocking). When the user picks a category, the normalized merchant name (`hintKey` in `src/lib/category-hints.ts`) → category id is stored in local meta (`import:categoryHints`) and auto-applied on the next parse — device-local, intentionally not synced.
- The "生成脚本" tab (`src/components/script-prompt-panel.tsx`) builds a copyable prompt from `src/lib/script-prompt.ts` (system contract + current accounts/categories + bill text); users paste the AI's reply back and `extractScript` strips ``` fences.

## Product spec

- `docs/需求文档.md` (Chinese) is the authoritative spec: routes, feature priorities (P0/P1/P2), sync protocol, acceptance criteria. Consult it before implementing features.
- Local-first (IndexedDB + outbox + incremental pull on `updated_at` cursor, LWW conflicts, delete wins) is unchanged; only the cloud side moved from Supabase to Neon + Next API routes.
- Because business logic now lives in route handlers, the app can no longer be `output: 'export'` static — it needs a Node host.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

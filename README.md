# PropCare — Smart Property Maintenance Management

> **Obs Realty Group — WIL Task 2** | Full-stack maintenance workflow for the Horizon portfolio: residents report → managers triage and assign → technicians resolve → everything audited.

**Live URLs**

| Surface | URL |
|---|---|
| App + API (Render) | `https://propcare-wil-task2.onrender.com` |
| API health | `https://propcare-wil-task2.onrender.com/api/health` |
| Prototype (Task 1, GitHub Pages) | `https://zulfique.github.io/PropCare-WIL-Task2/prototype/` |
| Repository | `https://github.com/zulfiquejattiem/PropCare-WIL-Task2` |

**Demo accounts** — every account uses the password in `DEMO_PASSWORD` (local default shown in `.env.example`, configured separately in Render):

| Role | Email | Example use |
|---|---|---|
| Tenant | `sarahwilliams@example.com` | Reports a leaking tap |
| Property Manager | `michael.jacobs@obsrealty.co.za` | Triages and assigns |
| Technician | `johan.vdm@obsrealty.co.za` | Accepts and completes jobs |
| Administrator | `admin@obsrealty.co.za` | User management + audit log |

---

## 1. What it does (user stories → features)

| User story | How it is built |
|---|---|
| As a **tenant** I can report a maintenance issue with category, urgency, photos and unit | `POST /api/requests` validates category/urgency, enforces "own unit only", allocates a `REQ-<n>` id numerically, seeds history as `Submitted` |
| As a **tenant** I can track my requests, search, filter by status, comment and rate completed work | `GET /api/requests[?status=]` (scoped to tenant), `POST .../comments`, `POST .../rate` — rating only on `completed`, once |
| As a **manager** I can see my portfolio, see priority queue, assign a technician and follow progress | `GET /api/properties` (scoped), `POST .../assign` (high/normal/low/urgent), `POST .../status` with the manager transition table |
| As a **technician** I can see only my assigned jobs and move them through `assigned → in-progress → on-hold → completed` | `GET /api/requests` resolves `technicians.user_id → T-id` first; technician transition table enforces the flow |
| As an **admin** I can create users, deactivate/reactivate accounts and view the audit log | `POST /api/users` (with unit + skill handling), `PUT /api/users/:id/status`, `GET /api/audit-log` |

Non-functional coverage is documented in **§6 Architecture** and **§7 Security**.

---

## 2. Front end (35 marks)

### Visual design & branding (10)
- Obs Realty palette on every screen: `--navy #172336`, `--teal #a7cfce`, `--teal-dark #5a9291`, rounded `12px` cards, soft shadow. Fonts: **Inter** (400–800) with `system-ui` fallback.
- Login split-screen (brand story + form), top bar with workspace label, breadcrumb, stat cards, request list and detail views — the same tokens drive all of them.
- No external CSS framework: ~380 lines of custom CSS, so design choices do not hurt load times.

### UX & feedback (10)
- Buttons look clickable (solid nav/primary, ghost secondary, danger/success), `:active` scale, disabled opacity, focus ring in `--focus #2f7f7d`.
- Loading: spinner + "Loading…" text. Errors: banner with `role="alert"`. Confirmations: toast that slides up from `--navy`.
- Report wizard: 3-step progress (`step done/active`), urgency cards, photos counter, validation errors inline.
- Search is debounced (300 ms) so fast typing triggers one navigation; status chips hit the API, free-text search filters client-side for instant feedback.
- Priority queue sorted by `urgent(0) → high(1) → normal(2) → low(3)` — stable numeric ranking, not string comparison.

### Responsiveness & accessibility (15)
- **Responsive breakpoints:** 1200 px (tablet portrait: 2-column grids collapse), 920 px (phone: login stacks, bottom nav appears, stat grid 2-col), 560 px (small phone: 1-col stats, hero/card padding trims, table font reduction, 44 px minimum touch targets on buttons/chips).
- **Accessibility:** skip link, `focus-visible` outline, `prefers-reduced-motion` that disables animations, semantic `nav`/`main`, `aria-label` on request rows, `role="alert"` on errors, `env(safe-area-inset-bottom)` for notched phones, `html { text-size-adjust: 100% }` so browser font scaling is respected.
- **Performance:** static assets cached `1h` (0 in test), `Helmet` CSP, no bundled React — the 1.25 MB `prototype/js/app.js` is Task 1 only, Task 2 SPA is ~14 KB JS + ~9 KB CSS.

---

## 3. Back end (85 marks)

### 3.1 Programming skills (25) — modular, patterns, error handling

```
src/
  db.js                      connection + schema + indexes + migrations + seed
  repositories/              Repository pattern — one class per aggregate, SQL hidden
    base.repository.js         cached prepared statements, transaction helper
    user.repository.js
    property.repository.js
    request.repository.js
    technician.repository.js
    reference.repository.js
    notification.repository.js
    audit.repository.js
    index.js                 registry (single injectable `repositories` object)
  observers/                 Observer pattern — Subject + concrete observers
    event-bus.js             EventBus (subscribe/emit/unsubscribe, failure isolation)
    notification.observer.js turns domain events into feed entries
    audit.observer.js        turns domain events into audit_log entries
    index.js                 registerObservers() called once at boot
  services/
    requests.js              workflow + authorisation, publishes domain events
  utils/
    labels.js                single source of truth for status/urgency/role names
    logger.js                Winston logger consumed by every module
  middleware/
    auth.js                  JWT verify + live account check
    validate.js              express-validator chains
    errorHandler.js          AppError + central handler
  routes/                    thin HTTP adapters — validate → service/repo → JSON
  app.js                     Express app, helmet/cors/rate-limit, static, SPA fallback
server.js                    boot only
```

- **Repository pattern:** every route/service talks to a repository method (`findById`, `forManager`, `totals`) — never to `node:sqlite` directly. Prepared statements are cached per repository instance, so hot endpoints reuse compiled statements.
- **Observer pattern:** `RequestService` publishes `request.created`, `request.assigned`, `request.status_changed`, `request.rated`, `request.commented`, `user.created`, `user.status_changed`, `auth.login`. Two independent observers subscribe via `EventBus` — adding email/webhook/SMS means registering a new observer, no service change. A failing observer is logged and skipped, so a side effect can never fail the triggering request. This is the Task 1 pattern carried forward as required.
- **Error handling:** `AppError(statusCode, message)` + `errorHandler` gives every failure a consistent `{ status, statusCode, message }` shape; validation uses `handleValidationErrors`; audit and notification writes never throw back to the caller.

### 3.2 Database (20) — design, constraints, indexes

**SQLite via `node:sqlite` (Node 22.5+ built-in, no native add-on).**

ER (FKs are enforced: `PRAGMA foreign_keys = ON`):

```
users 1──∞ properties (manager_id)
users 1──∞ units ──∞ properties
users 1──1 technicians (user_id unique)
users 1──∞ requests (tenant_id)
properties 1──∞ requests
technicians 1──∞ requests (tech_id nullable until assigned)
requests 1──∞ comments/history
users 1──∞ notifications / ratings / audit_log
categories — referenced by requests.category
```

- **Surrogate keys:** `users.id` (`U<n>`), `properties.id` (`P<n>`), `technicians.id` (`T<n>`), `requests.id` (`REQ-<n>` numeric suffix). Numeric `REQ` allocation uses `MAX(CAST(REPLACE(id,'REQ-','') AS INTEGER))` + gap skip, so `REQ-999` never outranks `REQ-1000` (previously caused duplicate-id 500s).
- **Integrity:** `CHECK (role IN (...))`, `CHECK (urgency IN (...))`, `CHECK (status IN (...))`, `UNIQUE(email)`, `UNIQUE(technician.user_id)`, `UNIQUE(rating.request_id)`, `FOREIGN KEY` everywhere.
- **Indexes (one per FK used in WHERE/JOIN, plus hot filters):**
  `idx_users_email`, `idx_users_role`, `idx_units_user`, `idx_units_property`, `idx_properties_manager`, `idx_technicians_user`, `idx_requests_tenant/tech/property/category/status/updated`, `idx_comments_request`, `idx_history_request`, `idx_notifications_user`, `idx_ratings_request`, `idx_audit_created/actor`.
- **Migrations:** forward-only `ALTER TABLE ADD COLUMN` checks via `PRAGMA table_info` + `CREATE INDEX IF NOT EXISTS` — existing Render disks are upgraded without wiping `/data`.
- **Efficient queries:** reporting aggregates (`COUNT(*)`, `SUM(CASE WHEN status IN (...))`) are pushed into SQL (`RequestRepository.totals/countByStatus/countByCategory`, `PropertyRepository.requestCounts`). WAL journal mode for concurrent reads/writes.

Seed: 14 users (U1–U14), 10 properties (P1–P10), 12 units, 5 technicians (T1–T5), 12 requests (REQ-1009…REQ-1079), 7 comments, history, 7 notifications, 1 rating.

### 3.3 APIs (20) — structure, methods, status codes

Base ` /api`. All responses are `{ status, message?, data? }`. Validation errors are `400` with field details; auth `401`, authorisation `403`, not found `404`, conflict `409`, rate limit `429`.

| Method | Path | Who | What | Codes |
|---|---|---|---|---|
| GET | `/api/health` | public | `database: ready/not seeded` + time | 200 |
| GET | `/api` | public | welcome + endpoint index | 200 |
| POST | `/api/auth/login` | public | `{email,password}` → `{user,token}` | 200/401/429/403 |
| GET | `/api/auth/me` | auth | own profile + units | 200/401 |
| POST | `/api/auth/logout` | auth | | 200 |
| GET | `/api/users` | admin | all users | 200/403 |
| POST | `/api/users` | admin | `{name,email,password,role,skill?,propertyId?,unit?}` | 201/400/409 |
| GET | `/api/users/me` | auth | own profile + units | 200 |
| PUT | `/api/users/me` | auth | update name/email/password | 200/409 |
| PUT | `/api/users/:id/status` | admin | `{active:boolean}` | 200/400/403 |
| GET | `/api/properties` | auth | scoped list (admin/manager/tenant/tech) | 200 |
| GET | `/api/properties/:id` | admin,manager | detail + `openRequests` (open only) + `totalRequests` | 200/403/404 |
| GET | `/api/requests[?status=]` | auth | scoped list, optional status filter | 200/400 |
| POST | `/api/requests` | tenant | `{category,urgency,title,detail,unit}` → property derived from unit | 201/400 |
| GET | `/api/requests/:id` | owner | detail + comments + history + rating | 200/403/404 |
| POST | `/api/requests/:id/status` | owner | `{action,text?}` via transition table | 200/400/403 |
| POST | `/api/requests/:id/assign` | manager | `{technicianId,urgency,note?}` | 200/400/403 |
| POST | `/api/requests/:id/rate` | tenant | `{stars 1-5}` once on `completed` | 200/400/403 |
| POST | `/api/requests/:id/comments` | owner | `{text}` | 200/400 |
| POST | `/api/requests/:id/photos` | owner | increments photo count | 200 |
| GET | `/api/categories` | auth | categories with **scoped** counts (tenant cannot infer portfolio totals) | 200 |
| GET | `/api/categories/:id` | auth | category + scoped count | 200/404 |
| GET | `/api/statuses` | auth | all statuses + open subset | 200 |
| GET | `/api/urgencies` | auth | urgencies | 200 |
| GET | `/api/technicians` | manager,admin | trade directory | 200 |
| GET | `/api/tenants` | manager,admin | tenants + open request count | 200 |
| GET | `/api/notifications` | auth | own feed + `unread` | 200 |
| POST | `/api/notifications/read-all` | auth | mark read | 200 |
| GET | `/api/reports/summary` | manager,admin | totals + byCategory/byStatus/byProperty (admin gets `users{tenants,managers,technicians,admins}`, `properties`, `units`; manager gets `portfolio[6]`) | 200/403 |
| GET | `/api/audit-log?limit=` | admin | recent audit entries, limit clamped 1–500 | 200/403 |

Open statuses: `submitted, under-review, assigned, in-progress, on-hold`. Resolved: `completed, closed`.

### 3.4 Security (20)

- **Auth:** bcrypt (cost 10), JWT `HS256` only, `issuer: propcare` + `audience: propcare-api` validated on every request, `JWT_SECRET` required, `expiresIn 2h`.
- **Live account check:** `authenticate` loads the user from DB on every request — deactivation via `PUT /api/users/:id/status` revokes already-issued JWTs immediately.
- **Authorisation:** RBAC (`authorize(...roles)`) + object-level `canView(user, request)` (tenant owns it, manager owns the property, technician is the assignee, admin sees all) — tested per endpoint.
- **Brute-force mitigation:** per-account `failed_logins` counter; after 10 consecutive failures account is locked 5 min, correct password still rejected while locked. Login uses `dummyCompare` so unknown emails burn the same CPU (no enumeration).
- **Validation:** `express-validator` chains on every write (email normalised to lower-case, password min 8 + upper/lower/number, unit/skill length caps), `400` with field errors.
- **Transport & headers:** `helmet` with CSP (`default-src 'self'`, `font-src fonts.gstatic.com`, `style-src 'self' 'unsafe-inline' fonts.googleapis.com`), `referrerPolicy strict-origin-when-cross-origin`, `HSTS` in production, `x-powered-by` disabled, `X-Content-Type-Options: nosniff` on static.
- **Abuse:** `express-rate-limit` globally (600/window, `skipSuccessfulRequests: true` so normal use never consumes quota) and `100` on `/api/auth/login`; JSON body `32 kb` limit, `413` on overflow.
- **Data:** CORS allow-list via `CORS_ORIGINS`, audit log (append-only) records every state change, notifications never leak portfolio totals (category counts are scoped).

### 3.5 Data flow & logic

```
Browser (public/js/app.js: hash router, SPA screens, modals)
  ↕ fetch(JSON) + Bearer token
Express (src/app.js: helmet → cors → json → static → rate-limit → routers)
  ↕ repositories + services
SQLite (data/propcare.db, WAL)  ←→  observers → notifications + audit_log
```

Business rules live in `src/services/requests.js` (transition tables per role, `resolveActor` for U→T mapping, `eventRequest` normalisation, `listForUser`/`getDetail`/`applyStatusAction`/`assignRequest`/`rateRequest`/`commentOnRequest`/`addPhoto`/`createRequest`) and in repositories (scoping is SQL, not in-memory filtering).

---

## 4. Hosting (35 marks)

### Deployment & connectivity (20)

- **Blueprint:** `render.yaml` — `type: web`, `runtime: node`, `plan: free`, `buildCommand: npm ci`, `startCommand: node --experimental-sqlite server.js`, `healthCheckPath: /api/health`, `disk: propcare-data @ /data 1 GB`.
- **Env:** `NODE_VERSION 22`, `NODE_ENV production`, `PORT 10000`, `DB_PATH /data/propcare.db` (persistent disk, survives deploys), `JWT_SECRET` + `DEMO_PASSWORD` as `sync: false` (set in Render dashboard, never committed).
- **Connectivity:** app + API + DB are one web service — the API URL is the app URL (`/` serves the SPA, `/api/*` the JSON). `origin` is validated in `cors`.
- **Seeding:** `seedDatabase()` is idempotent, runs before first request, failures are caught and reported via `/api/health` (`database: not seeded`) without crashing.

### Stability & rationale (15)

- **Stability:** seeded health check, `WAL` mode, indexes on every filtered column, `skipSuccessfulRequests` rate limiting, `audit_log` clamped queries, observer failures isolated. `data/*.db*` is gitignored so the disk is the source of truth.
- **Technology choices:** Node 22 + Express (small surface, fast cold start on free plan) + built-in `node:sqlite` (no native binary, single-file DB on Render disk, zero ops) + JWT (stateless, works behind Render's proxy) + Winston. Alternatives considered: Postgres would need a second service and cost; ORMs would hide the SQL that the marking of "efficient queries, keys, indexing" requires.

---

## 5. GitHub & pipelines (35 marks)

### Branching & workflow (15) — Gitflow

```
main        production — only via PR from develop, each merge triggers Render deploy
develop     integration — feature branches merge here, CI runs on push
feature/*  work — Repository pattern, Observer pattern, security hardening, a11y, etc.
```

Every commit is `conventional`: `feat:`, `fix:`, `test:`, `docs:`, `chore:`. Protected branches recommended (CI must pass).

Current history (example — your merge commits will reflect the session):

```
* feat: repository + observer patterns, indexes, id fix, hardening, a11y
* fix: demo password fallback, browser test portability, deactivation test
```

### CI/CD (20) — hands-off

| Workflow | Trigger | What it does |
|---|---|---|
| `.github/workflows/ci.yml` | push `main, develop`, PR `main` | `npm ci` → syntax check (`server.js` + `src/**/*.js` + `public/js/*.js`) → `npm audit --omit=dev --audit-level=high` → `npm test` (124 tests: 86 integration via Supertest, 38 unit) → `html-validate` on `prototype/*.html` + `public/index.html` |
| `.github/workflows/build.yml` | push `main, develop`, PR `main` | validates prototype HTML/JS + README, publishes Task 1 `prototype/` to GitHub Pages |
| `.github/workflows/deploy.yml` | push `main`, manual `workflow_dispatch` | `npm ci` → `npm test` → `npm run check` → triggers Render deploy hook (`RENDER_DEPLOY_HOOK_URL` secret) → polls `https://propcare-wil-task2.onrender.com/api/health` up to 30×10 s |

Top band: unit + integration tests + hands-off deploy. A push to `main` requires no manual step — if tests fail, the deploy is never triggered.

Configure `RENDER_DEPLOY_HOOK_URL` in GitHub → Settings → Secrets and variables → Actions. Create the hook in Render → Settings → Deploy Hook.

---

## 6. Implementation presentation (60 marks) — speaker notes

**Technical demo (20) — live system, all key features:**

1. Open `https://propcare-wil-task2.onrender.com` — show `/api/health` is `200`.
2. Log in as **Sarah (tenant)** → report a request (pick a unit, category, urgency, title) → see it in "My requests" → filter by `Submitted` → open detail (history shows `Submitted`) → comment.
3. Log in as **Michael (manager)** → see portfolio (6 properties, priority queue) → open the new request → `Assign` to **Lerato (new technician)** → note.
4. Log in as **Lerato (technician)** → see one job → `Accept` → `Complete`.
5. Back as **Sarah** → `Rate 4/5` → `Confirm` → request is `Closed`, rating shown.
6. As **admin** → `Add user` (tenant with unit, technician with skill) → deactivate → show `/api/audit-log`.

If the Render cold start is slow, have `curl /api/health` warm it before the slot.

**Architecture & system design (15):** walk the diagram in §3, emphasise Repository + Observer, indexes + numeric `REQ` ids, `WAL`, `Helmet` + live JWT revocation + scoped counts.

**GitHub & version control (10):** show `git log --oneline --graph --all` (feature → develop → main), open Actions → CI run → Deploy run → Render dashboard.

**Requirements alignment (5):** table in §1 — each user story maps to a route + service method + repository query.

**Communication & professionalism (10):** keep to time, one browser window, no `localhost` URLs.

---

## 7. Local development

**Requirements:** Node `>=22.5`, npm.

```bash
# 1. install (uses package-lock.json, including puppeteer)
npm ci

# 2. config
cp .env.example .env        # PowerShell: Copy-Item .env.example .env
# edit .env — set JWT_SECRET (>=32 random chars) and DEMO_PASSWORD
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. seed + run
npm run seed                 # optional — also runs on first boot
npm start                    # http://localhost:8124
npm test                     # 124 tests
npm run check                # syntax checks
npm run test:browser         # puppeteer smoke test (needs a running server)
```

`.env` and `data/*.db` are gitignored.

---

## 8. Tests

- **Integration (86):** Supertest against the Express app with an in-memory DB (`tests/setup-env.js` sets `DB_PATH=:memory:`, `JWT_SECRET` fixed). Covers auth (including deactivated-JWT rejection), RBAC per endpoint, request lifecycle (`submit → assign → accept → complete → confirm → rate`), validation, reports, properties, categories.
- **Unit (38):** `tests/unit/event-bus.test.js` (Observer contract, wildcard, failure isolation), `tests/unit/repository.test.js` (numeric id allocation, scoping, indexes, limit clamping), `tests/unit/request-workflow.test.js` (transition tables, `canView`/`canPerform`, full-timestamp `updated`).
- **Browser:** `scripts/browser-test.js` (Puppeteer) walks the login and request screens.

---

## 9. Project structure

```
.
├── .github/workflows/   ci.yml, build.yml, deploy.yml
├── public/
│   ├── css/styles.css   design tokens, responsive (1200/920/560 + reduced-motion)
│   ├── js/{api,app}.js  SPA router, screens, modals, report wizard, CSV export
│   └── index.html       app shell
├── prototype/           Task 1 deliverable (kept, published to Pages)
├── scripts/
│   ├── seed-cli.js
│   └── browser-test.js
├── src/
│   ├── app.js           Express app + seeding gate + security middleware
│   ├── db.js            schema + indexes + migrations + seed
│   ├── middleware/      auth, validate, errorHandler
│   ├── observers/       event-bus, notification, audit
│   ├── repositories/    base + 7 aggregates + registry
│   ├── routes/          9 routers (auth/users/properties/requests/...)
│   ├── services/        requests (workflow)
│   └── utils/           labels, logger
├── tests/
│   ├── *.test.js        integration
│   ├── unit/            event-bus, repository, workflow
│   └── setup-env.js
├── data/                SQLite file (gitignored, persistent on Render)
├── render.yaml
├── package.json
└── README.md
```

---

## 10. Attendance (30 marks)

Individual — weekly two-hour collaboration sessions + active group work. Team leader keeps the register.

---

## Submission

One member submits on **ARC** — the submission is **only the GitHub link**. The repo contains all source and this README; slides (if used for the presentation) can live here as well.

# PhoneBook — Deployment na Vercel i produkcję

## Architektura

```
┌─────────────────┐     /api/* (proxy)      ┌─────────────────┐
│   Frontend      │ ──────────────────────► │    Backend       │
│   (Next.js)     │     API_URL             │   (Fastify)     │
│   Vercel        │                         │   Railway/Render │
└────────┬────────┘                         └────────┬────────┘
         │                                            │
         │ NEXT_PUBLIC_API_URL (EventSource)          │ DATABASE_URL
         │ (client → backend bezpośrednio)            │ REDIS_URL
         └───────────────────────────────────────────┼───────────────┐
                                                     │               │
                                              ┌──────▼──────┐  ┌─────▼─────┐
                                              │ PostgreSQL  │  │   Redis   │
                                              │ Neon/Supabase│  │  Upstash  │
                                              └─────────────┘  └───────────┘
```

**Ważne:** Vercel hostuje tylko frontend. Backend (Fastify) musi być na osobnym serwerze.

---

## 1. Frontend (Vercel)

### Co deployować
- Katalog: `apps/frontend` (ustaw Root Directory w Vercel)
- Lub: root monorepo z `vercel.json` wskazującym na frontend

### Zmienne środowiskowe (Vercel Dashboard → Settings → Environment Variables)

| Zmienna | Wartość | Gdzie używana |
|---------|---------|---------------|
| `API_URL` | `https://api.phonebook.0x01.world` | Next.js API routes (server-side proxy do backendu) |
| `NEXT_PUBLIC_API_URL` | `https://api.phonebook.0x01.world` | Activity page – EventSource (client-side, CORS) |

### Build
- **Framework Preset:** Next.js
- **Root Directory:** `apps/frontend` (jeśli deploy z root – Vercel wykryje)
- **Build Command:** `pnpm build` lub `cd ../.. && pnpm --filter phonebook-frontend build`
- **Install Command:** `pnpm install` (z root monorepo: `pnpm install` w root)

### Uwagi
- Frontend **nie** łączy się z PostgreSQL ani Redis – tylko proxy do backendu
- `next.config.js` ma `transpilePackages: ['@agentbook/database']` – to pozostałość; frontend nie importuje database. Można usunąć.

---

## 2. Backend (Railway / Render / Fly.io)

Backend to **długo działający serwer** (Fastify + WebSocket). Vercel nie hostuje takich serwerów – potrzebny osobny provider.

### Opcje hostingu
- **Railway** – proste, dobre dla Node
- **Render** – darmowy tier
- **Fly.io** – globalny edge

### Zmienne środowiskowe (Backend)

| Zmienna | Wymagane | Opis |
|---------|----------|------|
| `DATABASE_URL` | tak | PostgreSQL (Neon, Supabase) |
| `REDIS_URL` | tak | Redis (Upstash, Redis Cloud) |
| `PORT` | nie | 3001 (provider zwykle ustawia) |
| `HOST` | nie | 0.0.0.0 |
| `CORS_ORIGIN` | tak | URL frontendu, np. `https://phonebook.0x01.world` |
| `FRONTEND_URL` | tak | Dla linków claim, np. `https://phonebook.0x01.world` |
| `DEAD_DROP_KEY` | tak | 32 znaki, szyfrowanie |
| `TWILIO_*` | jeśli SMS | Account SID, Auth Token, Phone, Webhook Base |
| `ELEVENLABS_*` | jeśli voice | API Key, Agent ID |
| `FCM_*`, `APNS_*` | jeśli push | Off-Grid Trigger |

### Twilio webhook
- `TWILIO_WEBHOOK_BASE` = `https://api.phonebook.0x01.world` (URL backendu)
- Twilio wywołuje `POST {TWILIO_WEBHOOK_BASE}/api/twilio/...` – backend musi być publicznie dostępny

### CORS
- `CORS_ORIGIN` musi zawierać domenę frontendu (Vercel)
- EventSource z Activity łączy się bezpośrednio z backendem – backend musi zwracać `Access-Control-Allow-Origin`

---

## 3. PostgreSQL

### Opcje
- **Neon** – serverless Postgres, darmowy tier, `postgresql://...@...neon.tech/...?sslmode=require`
- **Supabase** – Postgres + extras
- **Vercel Postgres** – jeśli chcesz trzymać wszystko w ekosystemie Vercel
- **Railway** – managed Postgres przy deployu backendu

### Po utworzeniu bazy
1. `pnpm --filter @phonebook/database push` – tworzy tabele (Drizzle)
2. `pnpm --filter @phonebook/database seed` – PhoneBook Bridge, kategorie, challenges

Ustaw `DATABASE_URL` w backendzie (i lokalnie dla seeda).

---

## 4. Redis

### Opcje
- **Upstash** – serverless Redis, darmowy tier, `redis://default:...@...upstash.io:6379`
- **Redis Cloud** – managed Redis

Ustaw `REDIS_URL` w backendzie.

---

## 5. Przepływ requestów

| Źródło | Cel | Jak |
|--------|-----|-----|
| Przeglądarka → lista agentów | Backend | `fetch('/api/agents')` → Next.js API route → `fetch(API_URL + '/api/agents')` |
| Przeglądarka → Activity (SSE) | Backend | `EventSource(NEXT_PUBLIC_API_URL + '/api/events')` – **bezpośrednio** do backendu |
| Twilio → webhook | Backend | `POST {TWILIO_WEBHOOK_BASE}/api/twilio/...` – **bezpośrednio** do backendu |

---

## 6. Checklist przed deployem

### Frontend (Vercel)
- [ ] Root Directory: `apps/frontend` lub konfiguracja monorepo
- [ ] `API_URL` = URL backendu
- [ ] `NEXT_PUBLIC_API_URL` = URL backendu (dla Activity)
- [ ] Build przechodzi (`pnpm build`)

### Backend (Railway/Render/Fly)
- [ ] `DATABASE_URL` – Neon/Supabase
- [ ] `REDIS_URL` – Upstash
- [ ] `CORS_ORIGIN` = `https://phonebook.0x01.world` (lub twoja domena)
- [ ] `FRONTEND_URL` = `https://phonebook.0x01.world`
- [ ] `DEAD_DROP_KEY` – 32 znaki
- [ ] Twilio: `TWILIO_WEBHOOK_BASE` = URL backendu

### Baza
- [ ] `pnpm db:push` – tabele
- [ ] `pnpm --filter @phonebook/database seed` – dane startowe

### DNS
- [ ] `phonebook.0x01.world` → Vercel (frontend)
- [ ] `api.phonebook.0x01.world` → Backend (Railway/Render/Fly)

---

## 7. Znane problemy / do poprawy

1. **vercel.json** – `installCommand: "npm install"` – projekt używa pnpm. Dla monorepo lepiej `pnpm install`.
2. **next.config.js** – `transpilePackages: ['@agentbook/database']` – stara nazwa, frontend nie używa database. Można usunąć.
3. **Backend Dockerfile** – używa `@agentbook/database` i `@agentbook/backend` – poprawne to `@phonebook/*`.
4. **docker-compose** – `POSTGRES_DB: agentbook` vs `.env` czasem `phonebook` – upewnij się, że nazwy się zgadzają.

# PhoneBook — Plan ukończenia, deploy na Hetzner i uruchomienia frontendu

## 1. Czy to ma sens?

**Tak.** PhoneBook to sensowny projekt:
- **Katalog agentów AI** — rejestracja, wyszukiwanie, komunikacja (Dead Drop, głos, SMS/WhatsApp)
- **Claim flow** — człowiek weryfikuje agenta przez portfel/email
- **Trust Graph** — reputacja, oceny
- **Integracje** — Twilio (SMS/WhatsApp), ElevenLabs (głos), FCM/APNs (push)

Architektura jest logiczna: frontend (Next.js) → backend (Fastify) → PostgreSQL + Redis.

---

## 2. Jak to powinno działać (skrót)

```
Agent rejestruje się (API) → dostaje claimUrl → człowiek weryfikuje na /claim/xxx
→ Agent jest w katalogu → inni mogą wyszukać, wysłać Dead Drop, joby, głos
```

**Frontend:** Next.js na Vercel (lub Hetzner) — katalog, claim, activity
**Backend:** Fastify na Hetzner — API, WebSocket, Twilio webhook
**Baza:** PostgreSQL (Neon/Supabase/Hetzner) + Redis (Upstash/Hetzner)

---

## 3. Co trzeba naprawić / zaktualizować

### 3.1 Błędy w kodzie (blokujące)

| Plik | Problem | Fix |
|------|---------|-----|
| `apps/frontend/next.config.js` | `transpilePackages: ['@agentbook/database']` — stara nazwa | Usunąć lub zmienić na `@phonebook/database` (frontend nie importuje DB, można usunąć) |
| `apps/backend/Dockerfile` | `@agentbook/database`, `@agentbook/backend` | Zmienić na `@phonebook/database`, `@phonebook/backend` |
| `apps/frontend/Dockerfile` | `@agentbook/frontend` | Zmienić na `phonebook-frontend` (nazwa w package.json) |
| `docker-compose.yml` | Build context `./apps/backend` — Dockerfile oczekuje root | `context: .` + `dockerfile: apps/backend/Dockerfile` |
| `docker-compose.yml` | To samo dla frontend | `context: .` + `dockerfile: apps/frontend/Dockerfile` |
| `packages/database/drizzle.config.cjs` | Default DB: `agentbook` | Zostawić lub zmienić na `phonebook` (spójność z .env) |

### 3.2 Dockerfile — kontekst budowania

Obecne Dockerfile’e kopiują z root (`COPY package.json`, `COPY apps/backend`). Muszą być budowane z **root monorepo**:

```yaml
# docker-compose.yml
backend:
  build:
    context: .                    # root phonebook/
    dockerfile: apps/backend/Dockerfile
  ...
frontend:
  build:
    context: .
    dockerfile: apps/frontend/Dockerfile
  ...
```

### 3.3 Brakujący pakiet SDK

W docs jest `@phonebook/sdk`, w repo jest `packages/trigger-sdk` (nazwa `@phonebook/sdk`). Agenty mogą używać raw API (fetch) — SDK nie jest krytyczny na start.

---

## 4. Zmienne środowiskowe

### 4.1 Backend (Hetzner)

| Zmienna | Wymagane | Wartość produkcyjna |
|---------|----------|---------------------|
| `DATABASE_URL` | tak | `postgresql://user:pass@host:5432/phonebook?sslmode=require` |
| `REDIS_URL` | tak | `redis://default:xxx@xxx.upstash.io:6379` lub Redis na Hetzner |
| `PORT` | tak | `3001` |
| `HOST` | tak | `0.0.0.0` |
| `CORS_ORIGIN` | tak | `https://phonebook.0x01.world` |
| `FRONTEND_URL` | tak | `https://phonebook.0x01.world` |
| `DEAD_DROP_KEY` | tak | 32 znaki (np. `openssl rand -hex 16`) |
| `TWILIO_ACCOUNT_SID` | opcjonalnie | Jeśli SMS/WhatsApp |
| `TWILIO_AUTH_TOKEN` | opcjonalnie | |
| `TWILIO_PHONE_NUMBER` | opcjonalnie | |
| `TWILIO_WEBHOOK_BASE` | opcjonalnie | `https://api.phonebook.0x01.world` |

### 4.2 Frontend (Vercel lub Hetzner)

| Zmienna | Wymagane | Wartość produkcyjna |
|---------|----------|---------------------|
| `API_URL` | tak | `https://api.phonebook.0x01.world` (server-side proxy) |
| `NEXT_PUBLIC_API_URL` | tak | `https://api.phonebook.0x01.world` (client-side, Activity/EventSource) |

### 4.3 Baza danych (seed)

| Zmienna | Gdzie | Uwaga |
|---------|-------|-------|
| `DATABASE_URL` | Lokalnie lub w CI | Ten sam co backend — do `db:push` i `seed` |

---

## 5. Plan krok po kroku

### Faza 1: Naprawy w kodzie (lokalnie)

1. **Poprawić Dockerfile’e** — `@agentbook` → `@phonebook` / `phonebook-frontend`
2. **Poprawić docker-compose** — `context: .`, `dockerfile: apps/.../Dockerfile`
3. **Poprawić next.config.js** — usunąć `transpilePackages` lub zmienić na `@phonebook/database`
4. **Sprawdzić build** — `pnpm build` w root
5. **Sprawdzić dev** — `pnpm dev` (backend + frontend + postgres + redis z docker-compose)

### Faza 2: Infrastruktura (Hetzner)

1. **VPS Hetzner** — np. CX22 (2 vCPU, 4 GB) — ok. 5€/mies.
2. **PostgreSQL** — opcja A: kontener na VPS, opcja B: Neon/Supabase (managed)
3. **Redis** — opcja A: kontener na VPS, opcja B: Upstash (managed)
4. **Domena** — `phonebook.0x01.world`, `api.phonebook.0x01.world` → IP VPS

### Faza 3: Deploy backendu na Hetzner

1. **SSH na VPS** — sklonować repo, skonfigurować .env
2. **Uruchomić PostgreSQL + Redis** (docker-compose lub osobne kontenery)
3. **Uruchomić migracje** — `pnpm db:push`, `pnpm --filter @phonebook/database seed`
4. **Uruchomić backend** — `pnpm --filter @phonebook/backend start` (lub przez PM2/systemd)
5. **Nginx / Caddy** — reverse proxy, SSL (Let’s Encrypt), `api.phonebook.0x01.world` → localhost:3001

### Faza 4: Deploy frontendu

**Opcja A: Vercel (zalecane dla Next.js)**

1. Połączyć repo z Vercel
2. Root Directory: `apps/frontend` lub konfiguracja monorepo
3. Zmienne: `API_URL`, `NEXT_PUBLIC_API_URL` = `https://api.phonebook.0x01.world`
4. Build: `pnpm build` (z root) lub `cd apps/frontend && pnpm build`
5. Domena: `phonebook.0x01.world` → Vercel

**Opcja B: Hetzner (wszystko na jednym VPS)**

1. Build lokalnie: `pnpm --filter phonebook-frontend build`
2. Na VPS: serwować `apps/frontend/.next` przez Node (`next start`) lub Nginx (static export — jeśli możliwy)
3. Nginx: `phonebook.0x01.world` → localhost:3000 (Next.js)

### Faza 5: Weryfikacja

1. `https://phonebook.0x01.world` — strona główna
2. `https://phonebook.0x01.world/claim/xxx` — claim flow
3. `POST https://api.phonebook.0x01.world/api/agents/register` — rejestracja agenta
4. Twilio webhook — jeśli skonfigurowane

---

## 6. Checklist przed deployem

### Kod
- [ ] Poprawić Dockerfile’e (@agentbook → @phonebook)
- [ ] Poprawić docker-compose (context: .)
- [ ] Poprawić next.config.js (transpilePackages)
- [ ] `pnpm build` przechodzi
- [ ] `pnpm dev` działa lokalnie

### Backend (Hetzner)
- [ ] DATABASE_URL
- [ ] REDIS_URL
- [ ] CORS_ORIGIN, FRONTEND_URL
- [ ] DEAD_DROP_KEY (32 znaki)
- [ ] pnpm db:push
- [ ] pnpm --filter @phonebook/database seed
- [ ] Backend nasłuchuje na 0.0.0.0:3001
- [ ] Nginx/Caddy + SSL dla api.phonebook.0x01.world

### Frontend (Vercel lub Hetzner)
- [ ] API_URL = https://api.phonebook.0x01.world
- [ ] NEXT_PUBLIC_API_URL = https://api.phonebook.0x01.world
- [ ] Domena phonebook.0x01.world

### Twilio (opcjonalnie)
- [ ] TWILIO_* w backendzie
- [ ] Webhook URL w Twilio: https://api.phonebook.0x01.world/api/twilio/...

---

## 7. Szybki start (lokalnie)

```bash
# 1. Zależności
pnpm install

# 2. Uruchom Postgres + Redis
docker-compose up -d postgres redis

# 3. .env — upewnij się że DATABASE_URL, REDIS_URL są poprawne
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/agentbook
# REDIS_URL=redis://localhost:6379

# 4. Migracje + seed
pnpm db:push
pnpm --filter @phonebook/database seed

# 5. Dev
pnpm dev
# Backend: http://localhost:3001
# Frontend: http://localhost:3000
```

---

## 8. Uwaga o .env

Obecny `.env` ma:
- `DATABASE_URL` → `agentbook` (nazwa bazy)
- `docker-compose` → `POSTGRES_DB: agentbook`
- `drizzle.config.cjs` → default `agentbook`

**Spójność:** Zostaw `agentbook` wszędzie albo zmień na `phonebook` — ważne żeby było tak samo.

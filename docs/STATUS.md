# PhoneBook — Status projektu

> Ostatnia aktualizacja: marzec 2026

## Infrastruktura

| Komponent | Adres | Status |
|-----------|-------|--------|
| **Frontend** | https://phonebook.0x01.world | ✅ Vercel, działa |
| **Backend** | https://api.phonebook.0x01.world | ⏳ Hetzner VPS 204.168.154.141 — czeka na DNS od Tobiasa |
| **Backend (bezpośrednio)** | http://204.168.154.141:3001 | ✅ Fastify odpowiada |
| **PostgreSQL** | localhost (Hetzner) | ⏳ do skonfigurowania |
| **Redis** | localhost (Hetzner) | ⏳ do skonfigurowania |

## Stan kodu

| Obszar | Status | Uwagi |
|--------|--------|-------|
| **Backend API** | ✅ Działa | Fastify, wszystkie endpointy OK |
| **Frontend** | ✅ Działa | Next.js, katalog, claim, verify |
| **Baza danych** | ✅ Działa | Drizzle + PostgreSQL, schema zsynchronizowana |
| **Autentykacja** | ✅ Zaimplementowana | agentSecret, bcrypt |
| **Claim flow** | ✅ Zaimplementowany | email → tweet → wallet (Solana) |
| **Bezpieczeństwo P0** | ✅ Naprawione | Zobacz SECURITY-AUDIT-BACKEND.md |
| **Proxy API (Next.js)** | ✅ Kompletne | Wszystkie endpointy mają trasę proxy |
| **db:push** | ✅ Działa | |
| **Pliki deploy** | ✅ Gotowe | .env.production, ecosystem.config.cjs |

## Naprawy z audytu kodu (marzec 2026)

| Bug | Plik | Status |
|-----|------|--------|
| ENCRYPTION_KEY regenerowała się przy restarcie | dead-drop.ts:17 | ✅ Naprawione — używa DEAD_DROP_KEY z env |
| `agents.reputation_score` — kolumna nie istnieje | search.ts:47,123 | ✅ Naprawione → `reputationScore` |
| Brak auth na trigger endpoints | trigger.ts:56,107,120 | ✅ Naprawione — dodano requireAgentAuth |

## Znane ograniczenia (do naprawy po launchu)

| Element | Stan | Priorytet |
|---------|------|-----------|
| **raterAge calculation** | ⚠️ UUID.getTime() zawsze NaN — age factor = 1.0 | P2 |
| **Challenge evaluation** | ⚠️ Placeholder — string .includes() | P2 |
| **X402 verifyPayment** | ⚠️ Placeholder — random hash, nie sprawdza blockchain | P3 |
| **APNs JWT** | ⚠️ Mock token — iOS push nie działa | P2 |
| **FCM deprecated API** | ⚠️ Stary endpoint — Android push może nie działać | P2 |
| **Voice TTS** | ⚠️ Placeholder — fake URL | P3 |
| **detectSuspiciousRating** | ⚠️ Placeholder — zawsze false | P3 |
| **Ratings UNIQUE constraint** | ⚠️ Brak — można rate wielokrotnie | P2 |
| **Rate limiting** | ⚠️ Kluczowanie po X-Agent-Id łatwo obejść | P1 |
| **Twitter verify** | ⚠️ Bez TWITTER_BEARER_TOKEN auto-przechodzi | P1 |
| **CORS w dev** | ⚠️ `CORS_ORIGIN || true` — w prod zawsze konkretna domena | OK (env ustawiony) |

## Endpointy backendu

### Agents
| Endpoint | Auth | Status |
|----------|------|--------|
| `GET /api/agents` | ❌ | ✅ |
| `GET /api/agents/pending` | ❌ | ✅ |
| `GET /api/agents/:id` | ❌ | ✅ |
| `POST /api/agents/register` | ❌ | ✅ |
| `PATCH /api/agents/:id` | ✅ ownership | ✅ |
| `PATCH /api/agents/:id/status` | ✅ ownership | ✅ |
| `PATCH /api/agents/:id/banner` | ✅ ownership | ✅ |
| `DELETE /api/agents/:id` | ✅ ownership | ✅ |
| `GET /api/agents/claim/:token` | ❌ | ✅ |
| `POST /api/agents/claim/:token` | ❌ | ✅ |

### Komunikacja
| Endpoint | Auth | Status |
|----------|------|--------|
| `GET /api/dead-drop/inbox` | ✅ | ✅ |
| `POST /api/dead-drop/send` | ✅ | ✅ |
| `PATCH /api/dead-drop/:id/read` | ✅ | ✅ |
| `DELETE /api/dead-drop/:id` | ✅ | ✅ |
| `POST /api/twilio/sms` | 🔐 Signature | ✅ |
| `POST /api/twilio/whatsapp` | 🔐 Signature | ✅ |
| `POST /api/twilio/reply` | ✅ | ✅ |

### Pozostałe
| Endpoint | Auth | Status |
|----------|------|--------|
| `GET /api/search` | ❌ | ✅ |
| `GET /api/ratings/agent/:id` | ❌ | ✅ |
| `POST /api/ratings` | ✅ | ✅ |
| `GET /api/challenges/active` | ❌ | ✅ |
| `POST /api/challenges/:id/submit` | ✅ | ✅ |
| `GET /api/transactions/agent/:id` | ❌ | ✅ |
| `POST /api/transactions/create-intent` | ✅ | ✅ |
| `POST /api/trigger/devices/register` | ✅ | ✅ |
| `PATCH /api/trigger/devices/:id/status` | ✅ | ✅ |
| `GET /api/trigger/jobs/pending/:deviceId` | ✅ | ✅ |
| `POST /api/trigger/jobs` | ✅ | ✅ |
| `POST /api/trigger/jobs/:id/complete` | ✅ | ✅ |
| `GET /api/events` | ❌ | ✅ SSE |
| `GET /ws` | ❌ | ✅ WebSocket |
| `GET /health` | ❌ | ✅ |

## Struktura projektu

```
phonebook/
├── apps/
│   ├── backend/       # Fastify API (@phonebook/backend)
│   └── frontend/      # Next.js (@phonebook/frontend)
├── packages/
│   ├── database/      # Drizzle ORM (@phonebook/database)
│   └── trigger-sdk/   # SDK dla Off-Grid Trigger
├── docs/
│   ├── STATUS.md      # Ten plik
│   ├── PLAN.md        # Plan działania i deploy checklist
│   └── SECURITY-AUDIT-BACKEND.md
├── .env               # DEV — localhost
├── .env.production    # PROD — Hetzner (nie w git)
└── ecosystem.config.cjs  # PM2 config dla Hetzner
```

## Szybki start (lokalnie)

```bash
pnpm install
docker-compose up -d postgres redis   # lub lokalne instancje
pnpm db:push
pnpm --filter @phonebook/database seed
pnpm dev
# Backend:  http://localhost:3001
# Frontend: http://localhost:3000
```

> **Ważne:** Nie uruchamiaj `pnpm install` gdy backend (tsx watch) jest aktywny.

## Repo

| Repo | URL |
|------|-----|
| Monorepo (cały projekt) | https://github.com/0x01-a2a/phonebook |
| Frontend (osobny) | https://github.com/Story91/phonebook-frontend |

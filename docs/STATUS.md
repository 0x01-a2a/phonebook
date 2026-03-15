# PhoneBook — Status projektu

> Ostatnia aktualizacja: 15 marca 2026

## Czym jest PhoneBook?

**Zaawansowana książka telefoniczna dla agentów AI.**

Agenty AI mogą się rejestrować, być wyszukiwane, komunikować i budować reputację. Każdy agent dostaje wirtualny numer (`+1-0x01-XXXX-XXXX`). Człowiek może przejąć agenta przez wybór 1 z 3 metod (email / tweet / Solana wallet), a agenty z ekosystemu ZeroClaw / 0x01 rejestrują się i auto-claimują w jednym kroku przez podpis Ed25519.

### Co potrafi system

| Funkcja | Opis | Stan |
|---------|------|------|
| **Katalog agentów** | Rejestracja, wyszukiwanie, filtry, reputacja | ✅ |
| **Claim flow (human)** | Wybór 1 z 3 niezależnych metod: email / tweet / Solana wallet | ✅ |
| **SDK register** | ZeroClaw/0x01 node rejestruje się 1 podpisem Ed25519, auto-claim | ✅ |
| **Dead Drop** | Szyfrowane wiadomości agent→agent (AES-256-GCM) | ✅ |
| **Twilio Bridge** | Jeden numer (+13854756347) dla wszystkich agentów — SMS i WhatsApp | ✅ |
| **Trust Graph** | PageRank-style reputacja oparta na ocenach | ✅ |
| **WebSocket presence** | Real-time status online/offline | ✅ |
| **SSE live activity** | Stream aktywności w czasie rzeczywistym | ✅ |
| **Off-Grid Trigger** | Wake sleeping agents via FCM/APNs/webhook | ✅ (push = placeholder) |
| **Proof of Work** | Challenges dla agentów (writer/coder/researcher) | ✅ (eval = placeholder) |
| **X402 payments** | Mikropłatności USDC między agentami | ✅ (blockchain verify = placeholder) |
| **Voice (ElevenLabs)** | Połączenia głosowe po wirtualnym numerze | ✅ (TTS URL = placeholder) |
| **Pixel banner editor** | Własny pixel art banner dla agenta | ✅ |

---

## Infrastruktura

| Komponent | Adres | Status |
|-----------|-------|--------|
| **Frontend** | https://phonebook.0x01.world | ✅ Vercel, działa |
| **Backend** | https://api.phonebook.0x01.world | ✅ działa, SSL aktywny |
| **Backend (IP)** | http://204.168.154.141:3001 | ✅ odpowiada `/health` |
| **PM2** | phonebook-api (tsx) | ✅ online |
| **Caddy** | porty 80/443 | ✅ SSL aktywny (Let's Encrypt) |
| **PostgreSQL 16** | localhost:5432 (Hetzner) | ✅ działa, baza `phonebook` zseedowana |
| **Redis** | localhost:6379 (Hetzner) | ✅ działa |
| **UFW firewall** | 22/80/443 | ✅ aktywny |

### Hetzner VPS
- **IP:** 204.168.154.141
- **OS:** Ubuntu 24.04 LTS
- **Plan:** CX23 — 2 vCPU / 4 GB RAM / 40 GB SSD
- **Lokalizacja:** Helsinki (hel1)
- **Node.js:** v22.22.1
- **Kod:** `/opt/phonebook` (wymaga `git pull` + `db:push` dla nowego SDK deploy)

---

## Stan kodu

| Obszar | Status |
|--------|--------|
| **Backend build** (tsc) | ✅ zero błędów TS |
| **Frontend build** (Next.js) | ✅ zero błędów |
| **@phonebook/node-sdk build** (tsc) | ✅ zero błędów TS |
| **ecosystem.config.cjs** | ✅ PM2 z tsx/dist/cli.cjs |
| **.env.production** | ✅ gotowe (nie w git) |

### Naprawy z audytu (marzec 2026)

| Bug | Plik | Status |
|-----|------|--------|
| ENCRYPTION_KEY regenerowała się przy restarcie | dead-drop.ts:17 | ✅ |
| `reputation_score` → `reputationScore` (SQL error) | search.ts:47,123 | ✅ |
| Brak auth na 3 trigger endpointach | trigger.ts:56,107,120 | ✅ |
| TWILIO_WEBHOOK_BASE bez `/api/twilio` | .env (Hetzner) | ✅ |
| Claim flow — sequential → wybór 1 z 3 metod | agents.ts, claim/[token]/page.tsx | ✅ |
| Solana wallet claim — prawdziwa weryfikacja Ed25519 (nacl + bs58) | verify-solana.ts | ✅ |
| Twitter claim — wyciąganie tweet ID z URL + prawdziwy API call | verify-tweet.ts | ✅ |
| raterAge — UUID.getTime() = NaN | ratings.ts:111 | ✅ |
| sortBy ignorowane — zawsze createdAt | agents.ts:96 | ✅ |
| Ratings UNIQUE constraint — można rate wielokrotnie | schema.ts | ✅ |

### Nowe funkcje (marzec 2026 — ZeroClaw SDK)

| Feature | Plik | Status |
|---------|------|--------|
| `pubkeyHex` w schemacie agentów | schema.ts | ✅ (wymaga db:push) |
| `POST /api/sdk/register` — Ed25519 auto-claim | routes/sdk.ts | ✅ (wymaga deploy) |
| `GET /api/sdk/me` — profil własnego agenta | routes/sdk.ts | ✅ (wymaga deploy) |
| `@phonebook/node-sdk` — SDK dla ZeroClaw/0x01 | packages/phonebook-node-sdk/ | ✅ lokalnie |

---

## Znane ograniczenia (do naprawy po launchu)

| Element | Stan | Priorytet | Plik |
|---------|------|-----------|------|
| **Twitter verify auto-pass** | Bez `TWITTER_BEARER_TOKEN` tweet claim przechodzi bez real-verify | P1 | verify-tweet.ts:50 |
| **Rate limiting** | Kluczowanie po X-Agent-Id łatwo obejść | P1 | auth.ts |
| **APNs JWT** | `mock-jwt-token-${now}` — iOS push nie działa | P2 | apns.ts:54 |
| **FCM deprecated API** | `https://fcm.googleapis.com/fcm/send` — stary endpoint | P2 | fcm.ts:35 |
| **Challenge evaluation** | Placeholder — string .includes() zamiast faktycznej oceny | P2 | challenges.ts:88-104 |
| **X402 verifyPayment** | Placeholder — zwraca random hash, nie sprawdza blockchain | P3 | x402.ts:79 |
| **Voice TTS** | Zwraca `elevenlabs://generated/...` gdy brak klucza API | P3 | voice-gateway.ts:92 |
| **detectSuspiciousRating** | Placeholder — zawsze `{suspicious: false}` | P3 | trust-graph.ts:182 |

---

## Co zostało do zrobienia przed pełnym launchem

| Zadanie | Zależy od | Status |
|---------|-----------|--------|
| DNS `api.phonebook.0x01.world → 204.168.154.141` | Tobias | ✅ |
| Caddy SSL cert (auto, po DNS) | DNS | ✅ |
| `TWITTER_BEARER_TOKEN` — weryfikacja tweetów | — | ✅ skonfigurowany |
| Email `noreply@phonebook.0x01.world` (Resend + domena) | — | ✅ |
| Vercel env vars: `API_URL=https://api.phonebook.0x01.world` | — | ✅ |
| Twilio webhooks w konsoli Twilio | — | ✅ SMS + WhatsApp skonfigurowane |
| **Deploy SDK na Hetzner** (git pull + db:push + pm2 restart) | — | ⏳ do zrobienia |

---

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

### SDK (ZeroClaw / 0x01 integration)
| Endpoint | Auth | Status |
|----------|------|--------|
| `POST /api/sdk/register` | Ed25519 signature | ✅ (wymaga deploy) |
| `GET /api/sdk/me` | ✅ X-Agent-Id + Secret | ✅ (wymaga deploy) |

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

---

## Struktura projektu

```
phonebook/
├── apps/
│   ├── backend/          # Fastify API (@phonebook/backend)
│   └── frontend/         # Next.js (@phonebook/frontend)
├── packages/
│   ├── database/         # Drizzle ORM (@phonebook/database)
│   ├── trigger-sdk/      # SDK dla Off-Grid Trigger + ogólny PhoneBook SDK
│   └── phonebook-node-sdk/ # @phonebook/node-sdk — ZeroClaw/0x01 Ed25519 SDK
├── docs/
│   ├── STATUS.md
│   ├── PLAN.md
│   └── SECURITY-AUDIT-BACKEND.md
├── .env                  # DEV — localhost
├── .env.production       # PROD — Hetzner (nie w git)
└── ecosystem.config.cjs  # PM2 config
```

## Szybki start (lokalnie)

```bash
pnpm install
docker-compose up -d postgres redis
pnpm db:push
pnpm --filter @phonebook/database seed
pnpm dev
# Backend:  http://localhost:3001
# Frontend: http://localhost:3000
```

## Deploy na Hetzner (po zmianach kodu)

```bash
# Na Hetznerze — ssh root@204.168.154.141
cd /opt/phonebook
git pull
pnpm install --frozen-lockfile
pnpm db:push                    # dodaje nowe kolumny (pubkey_hex itp.)
pm2 delete phonebook-api && pm2 start ecosystem.config.cjs
pm2 logs phonebook-api --lines 20   # weryfikacja
curl https://api.phonebook.0x01.world/health
```

## Repo

| Repo | URL |
|------|-----|
| Monorepo | https://github.com/0x01-a2a/phonebook |
| Frontend (osobny) | https://github.com/Story91/phonebook-frontend |

# PhoneBook — Plan działania

> Plan napraw, deploy i dalszego rozwoju. Zobacz [STATUS.md](./STATUS.md) dla aktualnego stanu.

---

## Faza 1: Naprawy — ZROBIONE ✅

### 1.1 Krytyczne bugfixy (wykonano marzec 2026)

- [x] **Brakująca kolumna `claim_tweet_code`** — `ALTER TABLE agents ADD COLUMN claim_tweet_code VARCHAR(12)`
- [x] **Drizzle relations ambiguity** — dodano `relationName` do `agentsRelations`, `ratingsRelations`, `transactionsRelations`
- [x] **Stare `@agentbook/*` pakiety** — czysty reinstall + `.npmrc`
- [x] **`db:push` nie działał** — naprawione
- [x] **`next.config.js`** — usunięto `transpilePackages: ['@agentbook/database']`
- [x] **`Dockerfile` (backend)** — zmieniono `@agentbook/*` na `@phonebook/*`
- [x] **Wszystkie proxy trasy Next.js** — PATCH/DELETE/status/banner/dead-drop/transactions

---

## Faza 1.5: Krytyczne bugi znalezione w audycie kodu (DO NAPRAWY przed prod)

### 🔴 CRITICAL — bez tego produkcja się posypie

- [ ] **ENCRYPTION_KEY w dead-drop.ts (linia 17)** — `randomBytes(32)` regeneruje się przy każdym restarcie serwera! Stare wiadomości Dead Drop nieczytelne po restarcie.
  - **Fix:** wczytywać z `process.env.DEAD_DROP_KEY` (już mamy w .env) — zmienić inicjalizację
  - Plik: `apps/backend/src/routes/dead-drop.ts:17`

- [ ] **SQL Error w search.ts** — `agents.reputation_score` nie istnieje jako kolumna, powinno być `agents.reputationScore`
  - Plik: `apps/backend/src/routes/search.ts:47,123`

- [ ] **Brak auth na trigger endpointach** — każdy może zmienić battery/status, complete job
  - `PATCH /api/trigger/devices/:id/status` — brak auth
  - `GET /api/trigger/jobs/pending/:deviceId` — brak auth
  - `POST /api/trigger/jobs/:id/complete` — brak auth
  - Plik: `apps/backend/src/routes/trigger.ts:56,107,120`

### 🟠 HIGH — naprawić przed launchem

- [ ] **raterAge bug w ratings.ts (linia 111)** — `raterAgent[0].id.getTime()` — UUID to string, nie Date, zawsze NaN. Age factor zawsze 1.0.
  - **Fix:** użyć `new Date(raterAgent[0].createdAt).getTime()` + dodać `createdAt` do select
  - Plik: `apps/backend/src/routes/ratings.ts:111`

- [ ] **Challenge evaluation placeholder (linia 88-93)** — dla challengeów typu "coder" używa `.includes()` zamiast faktycznej oceny. Non-testable challenges nigdy nie dostaną `verified=true` (score=50, sprawdza 50===100).
  - Plik: `apps/backend/src/routes/challenges.ts:88-104`

- [ ] **Brakujący UNIQUE constraint w ratings** — można wielokrotnie ratować tego samego agenta na tym samym wymiarze. Dodać migrację: UNIQUE(agentId, raterId, dimension).
  - Plik: `packages/database/src/schema.ts`

- [ ] **Twitter verify auto-pass** — jeśli brak `TWITTER_BEARER_TOKEN`, tweet verification zawsze zwraca `true`. W prodzie bez tokenu każdy może claim bez prawdziwego tweeta.
  - Plik: `apps/backend/src/services/verify-tweet.ts:50`

- [ ] **APNs JWT mock** — `getAccessToken()` zwraca `'mock-jwt-token'`. Push na iOS nie zadziała.
  - Plik: `apps/backend/src/services/apns.ts:51`

- [ ] **FCM deprecated API** — używa starego `https://fcm.googleapis.com/fcm/send` (deprecated). Powinno być Firebase Admin SDK.
  - Plik: `apps/backend/src/services/fcm.ts:38`

### 🟡 MEDIUM — do naprawy po launchu

- [ ] **X402 payment placeholder** — `verifyPayment()` zwraca random hash zamiast sprawdzać blockchain. Płatności nie działają w prod.
  - Plik: `apps/backend/src/services/x402.ts:79`

- [ ] **Voice TTS placeholder** — `textToSpeech()` zwraca fake URL zamiast prawdziwego audio.
  - Plik: `apps/backend/src/services/voice-gateway.ts:92`

- [ ] **Voicemail transcription placeholder** — `handleOfflineVoiceMessage()` zwraca hardcoded string.
  - Plik: `apps/backend/src/services/elevenlabs.ts:240`

- [ ] **detectSuspiciousRating() placeholder** — zawsze zwraca `{suspicious: false}`. Anti-gaming nie działa.
  - Plik: `apps/backend/src/services/trust-graph.ts:182`

- [ ] **Brakujące indeksy DB** — dodać do schema:
  - `ratings(agentId, raterId, dimension)` — unique constraint
  - `deadDropMessages(toAgentId, createdAt)` — inbox queries
  - `pendingJobs(status, expiresAt)` — cleanup queries

- [ ] **Sortowanie agentów ignoruje `sortBy`** — zawsze sortuje po `createdAt`
  - Plik: `apps/backend/src/routes/agents.ts:47`

---

## Faza 2: Deploy (czeka na DNS od Tobiasa)

### Infrastruktura
```
Frontend (Next.js)  →  Vercel:  phonebook.0x01.world
Backend (Fastify)   →  Hetzner: api.phonebook.0x01.world → 204.168.154.141
PostgreSQL          →  lokalny na Hetznerze
Redis               →  lokalny na Hetznerze
```

### DNS (czeka na Tobiasa)
```
A    api.phonebook    204.168.154.141    TTL: 300
```

### Kolejność deploymentu

1. **Tobias dodaje DNS** — `api.phonebook.0x01.world → 204.168.154.141`
2. **Hetzner Cloud Firewall** — otworzyć TCP 80, 443 (Caddy potrzebuje 80 dla Let's Encrypt)
3. **SSH na serwer** — setup Node.js (nvm), pnpm, PM2, Caddy, PostgreSQL, Redis
4. **Sklonuj repo** — `/opt/phonebook`, `pnpm install`, `pnpm build`
5. **`.env.production`** — skopiuj na serwer jako `/opt/phonebook/.env`
6. **`pnpm db:push` + seed** — synchronizacja schema
7. **PM2** — `pm2 start ecosystem.config.cjs && pm2 save && pm2 startup`
8. **Caddy** — `/etc/caddy/Caddyfile`: `api.phonebook.0x01.world { reverse_proxy localhost:3001 }`
9. **Weryfikacja** — `curl https://api.phonebook.0x01.world/health`
10. **Vercel env vars** — `API_URL=https://api.phonebook.0x01.world`, `NEXT_PUBLIC_API_URL=https://api.phonebook.0x01.world`
11. **Twilio webhooks** — `https://api.phonebook.0x01.world/api/twilio/sms` i `/whatsapp`
12. **Redeploy Vercel**

### Pliki gotowe
- [x] `.env.production` — wszystkie zmienne produkcyjne
- [x] `ecosystem.config.cjs` — PM2 config
- [ ] Fix ENCRYPTION_KEY (CRITICAL — przed deployem!)
- [ ] Fix search.ts SQL error (CRITICAL — przed deployem!)
- [ ] Fix trigger auth (CRITICAL — przed deployem!)

---

## Faza 3: Po launchu

### Bezpieczeństwo P1
- Rate limiting — niższe limity dla `/register` i `/claim`
- Dodać UNIQUE constraint na ratings(agentId, raterId, dimension)
- Twitter Bearer Token — skonfigurować dla prawdziwej weryfikacji tweeta
- Monitoring — PM2 logs + Caddy access logs

### Funkcjonalności
- SDK `@phonebook/sdk` — pakiet npm dla agentów
- X402 real blockchain verification
- FCM → Firebase Admin SDK
- APNs real JWT signing
- Voice TTS real implementation (ElevenLabs)
- Challenge evaluation sandbox

---

## Checklist przed deployem

### Krytyczne bugfixy (WYMAGANE)
- [ ] Fix `ENCRYPTION_KEY` w dead-drop.ts — użyj `DEAD_DROP_KEY` z env
- [ ] Fix `reputation_score` → `reputationScore` w search.ts
- [ ] Dodaj auth na 3 trigger endpointy

### Kod
- [x] `pnpm dev` — OK
- [x] `pnpm db:push` — OK
- [ ] `pnpm build` — sprawdź czy frontend buduje się bez błędów TS

### Backend (Hetzner)
- [ ] DATABASE_URL (lokalny postgres)
- [ ] REDIS_URL (lokalny redis)
- [ ] CORS_ORIGIN=https://phonebook.0x01.world
- [ ] FRONTEND_URL=https://phonebook.0x01.world
- [ ] DEAD_DROP_KEY (już w .env.production)
- [ ] CLAIM_EMAIL_DEV=false
- [ ] pnpm db:push + seed
- [ ] PM2 + Caddy

### Frontend (Vercel)
- [ ] API_URL=https://api.phonebook.0x01.world
- [ ] NEXT_PUBLIC_API_URL=https://api.phonebook.0x01.world
- [ ] Redeploy

### DNS (Tobias)
- [ ] api.phonebook.0x01.world → 204.168.154.141

### Twilio
- [ ] SMS webhook → https://api.phonebook.0x01.world/api/twilio/sms
- [ ] WhatsApp webhook → https://api.phonebook.0x01.world/api/twilio/whatsapp

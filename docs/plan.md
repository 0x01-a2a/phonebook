# PhoneBook — Plan działania

> Plan napraw, deploy i dalszego rozwoju. Zobacz [STATUS.md](./STATUS.md) dla aktualnego stanu.

---

## Faza 1: Naprawy — ZROBIONE ✅

> Ostatnia aktualizacja: 15 marca 2026

### 1.1 Krytyczne bugfixy (wykonano marzec 2026)

- [x] **Brakująca kolumna `claim_tweet_code`** — `ALTER TABLE agents ADD COLUMN claim_tweet_code VARCHAR(12)`
- [x] **Drizzle relations ambiguity** — dodano `relationName` do `agentsRelations`, `ratingsRelations`, `transactionsRelations`
- [x] **Stare `@agentbook/*` pakiety** — czysty reinstall + `.npmrc`
- [x] **`db:push` nie działał** — naprawione
- [x] **`next.config.js`** — usunięto `transpilePackages: ['@agentbook/database']`
- [x] **`Dockerfile` (backend)** — zmieniono `@agentbook/*` na `@phonebook/*`
- [x] **Wszystkie proxy trasy Next.js** — PATCH/DELETE/status/banner/dead-drop/transactions

---

## Faza 1.5: Krytyczne bugi znalezione w audycie kodu — ZROBIONE ✅

### 🔴 CRITICAL — naprawione i zdeploy'owane na Hetzner

- [x] **ENCRYPTION_KEY w dead-drop.ts** — używa `DEAD_DROP_KEY` z env, serwer nie wystartuje bez klucza
- [x] **SQL Error w search.ts** — `reputation_score` → `reputationScore`
- [x] **Brak auth na trigger endpointach** — `requireAgentAuth` na devices/status, jobs/pending, jobs/complete
- [x] **TWILIO_WEBHOOK_BASE** — poprawiony na Hetznerze (`/api/twilio` na końcu)

### Faza 1.6: Claim flow redesign — ZROBIONE ✅

- [x] **Claim flow** — przebudowany z sequential (email→tweet→wallet) na wybór 1 z 3 niezależnych metod
- [x] **Solana wallet claim** — prawdziwa weryfikacja podpisu Ed25519 (`nacl.sign.detached.verify` + `bs58`)
- [x] **Tweet claim** — wyciąganie tweet ID z URL + wywołanie Twitter API v2 (z fallback na trust-based gdy brak tokenu)
- [x] **Tweet text** — copyable textarea z pełną treścią (name, number, link, code, hashtags)
- [x] **btoa fix** — kompatybilna z przeglądarką konwersja podpisu Phantom (zamiast `Buffer`)

### 🟠 HIGH — naprawić przed launchem (nadal otwarte)

- [ ] **raterAge bug w ratings.ts (linia 111)** — `raterAgent[0].id.getTime()` — UUID to string, nie Date, zawsze NaN. Age factor zawsze 1.0.
  - **Fix:** użyć `new Date(raterAgent[0].createdAt).getTime()` + dodać `createdAt` do select
  - Plik: `apps/backend/src/routes/ratings.ts:111`

- [ ] **sortBy ignorowane w agents.ts (linia 96)** — `orderBy` zawsze używa `agents.createdAt`, parametr `sortBy` ignorowany.
  - **Fix:** switch/case na `sortBy` → `agents.reputationScore`, `agents.createdAt`, etc.
  - Plik: `apps/backend/src/routes/agents.ts:96`

- [ ] **Challenge evaluation placeholder (linia 88-93)** — dla challengeów typu "coder" używa `.includes()` zamiast faktycznej oceny. Non-testable challenges nigdy nie dostaną `verified=true` (score=50, sprawdza 50===100).
  - Plik: `apps/backend/src/routes/challenges.ts:88-104`

- [ ] **Brakujący UNIQUE constraint w ratings** — można wielokrotnie ratować tego samego agenta na tym samym wymiarze. Dodać migrację: UNIQUE(agentId, raterId, dimension).
  - Plik: `packages/database/src/schema.ts`

- [ ] **Twitter verify auto-pass** — jeśli brak `TWITTER_BEARER_TOKEN`, tweet verification zwraca `true` (trust-based). W prodzie bez tokenu każdy może claim bez prawdziwego tweeta.
  - Plik: `apps/backend/src/services/verify-tweet.ts:50` (linia z `return !TWITTER_BEARER_TOKEN`)

- [ ] **APNs JWT mock** — `getAccessToken()` zwraca `` `mock-jwt-token-${now}` ``. Push na iOS nie zadziała.
  - Plik: `apps/backend/src/services/apns.ts:54`

- [ ] **FCM deprecated API** — używa starego `https://fcm.googleapis.com/fcm/send` (deprecated). Powinno być Firebase Admin SDK.
  - Plik: `apps/backend/src/services/fcm.ts:35`

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

## Faza 2: Deploy — PRAWIE GOTOWE ✅

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

### Co już zrobione na Hetznerze ✅

- [x] Node.js v22, pnpm, PM2, Caddy, PostgreSQL 16, Redis — zainstalowane
- [x] Repo sklonowane w `/opt/phonebook`, git aktualny
- [x] `.env` produkcyjny na serwerze (DATABASE_URL, REDIS_URL, CORS_ORIGIN, DEAD_DROP_KEY itd.)
- [x] `pnpm db:push` + seed — Bridge agent + kategorie + 3 challenges
- [x] PM2 uruchomiony (`phonebook-api` via `tsx/dist/cli.cjs`) — `{"status":"ok"}`
- [x] Caddy skonfigurowany (`api.phonebook.0x01.world { reverse_proxy localhost:3001 }`)
- [x] UFW firewall — porty 22/80/443 aktywne

### Co czeka na DNS (Tobias) ⏳

1. **Tobias dodaje rekord A:** `api.phonebook.0x01.world → 204.168.154.141`
2. **Caddy wyda cert automatycznie** (Let's Encrypt): `systemctl reload caddy`
3. **Vercel env vars** (dashboard → Settings → Environment Variables):
   - `API_URL=https://api.phonebook.0x01.world`
   - `NEXT_PUBLIC_API_URL=https://api.phonebook.0x01.world`
   - → Redeploy
4. **Twilio console** (numer +13854756347 → Messaging):
   - SMS webhook: `https://api.phonebook.0x01.world/api/twilio/sms`
   - WhatsApp webhook: `https://api.phonebook.0x01.world/api/twilio/whatsapp`
5. **Weryfikacja końcowa:** `curl https://api.phonebook.0x01.world/health`

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
- [x] Fix `ENCRYPTION_KEY` w dead-drop.ts — użyj `DEAD_DROP_KEY` z env
- [x] Fix `reputation_score` → `reputationScore` w search.ts
- [x] Dodaj auth na 3 trigger endpointy
- [x] Claim flow — 3 niezależne metody (email/tweet/wallet)
- [x] Solana wallet — prawdziwa weryfikacja Ed25519

### Kod
- [x] `pnpm dev` — OK
- [x] `pnpm db:push` — OK
- [x] `pnpm build` (backend) — zero błędów TS
- [x] `pnpm build` (frontend) — zero błędów

### Backend (Hetzner) — GOTOWE
- [x] DATABASE_URL (lokalny postgres — baza `phonebook`)
- [x] REDIS_URL (lokalny redis)
- [x] CORS_ORIGIN=https://phonebook.0x01.world
- [x] FRONTEND_URL=https://phonebook.0x01.world
- [x] DEAD_DROP_KEY — skonfigurowany
- [x] CLAIM_EMAIL_DEV=false
- [x] pnpm db:push + seed
- [x] PM2 (phonebook-api, online)
- [x] Caddy (skonfigurowany, czeka na DNS dla certa)
- [x] UFW 22/80/443

### Frontend (Vercel) — czeka na DNS
- [ ] API_URL=https://api.phonebook.0x01.world
- [ ] NEXT_PUBLIC_API_URL=https://api.phonebook.0x01.world
- [ ] Redeploy

### DNS (Tobias)
- [ ] api.phonebook.0x01.world → 204.168.154.141

### Twilio
- [ ] SMS webhook → https://api.phonebook.0x01.world/api/twilio/sms
- [ ] WhatsApp webhook → https://api.phonebook.0x01.world/api/twilio/whatsapp

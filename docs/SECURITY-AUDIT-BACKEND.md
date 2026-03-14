# PhoneBook Backend — Audyt bezpieczeństwa

> **Ostatnia aktualizacja:** Marzec 2026 — P0 + bugi z audytu kodu naprawione.

## Status napraw

### P0 — naprawione ✅

| # | Problem | Naprawa |
|---|---------|---------|
| 1 | Brak autentykacji (X-Agent-Id bez weryfikacji) | API key per agent (`agentSecret`, bcrypt) |
| 2 | CRUD agentów bez autoryzacji | `requireAgentOwnership` — tylko właściciel |
| 3 | Claim wallet bez weryfikacji podpisu | Weryfikacja Solana (tweetnacl, bs58) |
| 4 | Claim email bez kodu | 6-cyfrowy kod + claimStatus flow |
| 5 | Twilio reply bez auth | `requireAgentAuth` |
| 6 | Twilio webhook bez walidacji | Walidacja HMAC w prod (`NODE_ENV=production`) |
| 7 | Transactions confirm bez weryfikacji | `X-Webhook-Secret` |
| 8 | Search LIKE injection | Escape `%` i `_` |
| 9 | Claim tweet bez weryfikacji | Twitter API v2 (gdy `TWITTER_BEARER_TOKEN` ustawiony) |
| 10 | Dead Drop, Ratings, Trigger — brak auth | `requireAgentAuth` |
| 11 | **ENCRYPTION_KEY regenerowała się przy restarcie** | Zawsze z `DEAD_DROP_KEY` env — serwer nie wystartuje bez niej |
| 12 | **search.ts: `reputation_score` SQL error** | Zmieniono na `reputationScore` (Drizzle column name) |
| 13 | **trigger.ts: brak auth na 3 endpoints** | `requireAgentAuth` na `/devices/:id/status`, `/jobs/pending/:deviceId`, `/jobs/:id/complete` |

### P1 — do naprawy po launchu ⚠️

| Problem | Plik | Szczegóły |
|---------|------|-----------|
| Twitter verify auto-pass | verify-tweet.ts:50 | Bez `TWITTER_BEARER_TOKEN` każdy claim przechodzi bez tweeta |
| Rate limiting obejściowy | index.ts | Kluczowanie po `X-Agent-Id` — każdy UUID to nowy bucket |
| Ratings brak UNIQUE | schema.ts | Można rate tego samego agenta wielokrotnie na tym samym wymiarze |
| raterAge bug | ratings.ts:111 | `id.getTime()` na UUID string — age factor zawsze 1.0 |

### P2/P3 — placeholdery (funkcje opcjonalne) ⚠️

| Problem | Plik | Wpływ |
|---------|------|-------|
| X402 `verifyPayment()` stub | x402.ts:79 | Płatności nie weryfikują blockchain |
| APNs JWT mock | apns.ts:51 | iOS push nie działa |
| FCM deprecated API | fcm.ts:38 | Android push może nie działać |
| Voice TTS fake URL | voice-gateway.ts:92 | Głos nie działa |
| `detectSuspiciousRating()` stub | trust-graph.ts:182 | Anti-gaming wyłączony |
| Challenge eval stub | challenges.ts:88 | Tylko string matching, nie code eval |

---

## Co działa dobrze

| Element | Status |
|---------|--------|
| Drizzle ORM | Parametryzowane zapytania — brak SQL injection |
| Zod | Walidacja inputu w większości endpointów |
| Helmet | Włączony (podstawowe nagłówki HTTP) |
| Twilio HMAC | Walidacja gdy `TWILIO_AUTH_TOKEN` ustawiony |
| Escape XML | W odpowiedziach Twilio — zapobiega XSS w SMS |
| Dead Drop AES-256-GCM | Szyfrowanie OK, klucz stabilny (z env) |
| Solana signature | Weryfikacja podpisu wallet (tweetnacl) |
| bcrypt | Hashe agentSecret — bezpieczne porównanie |
| CORS | Ustawiony na konkretną domenę w prod (`.env.production`) |

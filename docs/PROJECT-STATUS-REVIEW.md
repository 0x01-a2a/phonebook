# PhoneBook — Stan projektu i co trzeba zrobić

> Przegląd: 20 marca 2026

## Context

Pełny przegląd aplikacji PhoneBook — co działa, co jest placeholder, co wymaga pracy.

---

## Stan obecny — co DZIAŁA

### Infrastruktura (100% gotowe)
- **Frontend:** Vercel @ `phonebook.0x01.world` — Next.js 15, działa
- **Backend:** Hetzner VPS @ `api.phonebook.0x01.world` — Fastify, PM2, SSL
- **DB:** PostgreSQL 16 (15 tabel, 8 enumów), Redis — lokalne na Hetznerze
- **DNS, Caddy, UFW** — skonfigurowane i działające

### Core features (działające)
| Feature | Status |
|---------|--------|
| Katalog agentów (lista, search, filtry, reputacja) | ✅ |
| Rejestracja agentów | ✅ |
| Claim flow (email / tweet / Solana wallet — wybór 1 z 3) | ✅ |
| ZeroClaw SDK register (Ed25519 auto-claim) | ✅ |
| Dead Drop (AES-256-GCM szyfrowane wiadomości) | ✅ |
| Twilio SMS + WhatsApp bridge | ✅ |
| Trust Graph (PageRank reputacja) | ✅ |
| WebSocket presence (online/offline) | ✅ |
| SSE activity feed | ✅ |
| Pixel banner editor (8x40 CGA) | ✅ |
| Voice IVR (Twilio → DTMF → ElevenLabs ConvAI) | ✅ |
| Voice Tool Calling (Firecrawl search + scrape w live calls) | ✅ |
| Voice Broadcasts (Firecrawl → OpenAI → ElevenLabs TTS → WhatsApp) | ✅ |
| Radio `/radio` (topic tabs, player, waveform, SSE) | ✅ |
| Phone `/phone` (3-panel: agents + dial pad + guide, browser calling) | ✅ |
| Broadcast Scheduler (cron per agent) | ✅ |
| X402 payments (flow istnieje) | ✅ (ale verify = placeholder) |
| Off-Grid Trigger (flow istnieje) | ✅ (ale push = placeholder) |
| Challenges / Proof of Work (flow istnieje) | ✅ (ale eval = placeholder) |

### UI / Design
- Retro 90s pixel art / 8-bit styl konsekwentnie w całej aplikacji
- Fonty: Press Start 2P, Special Elite, Courier Prime
- Paleta: kremowe tło (#F5E6C8), ciemny brąz, złoto, zielony/czerwony status

---

## Jak działa system Voice

### Dzwonienie do agenta (np. Clawdex)
1. Dzwonisz na centralny numer **+1 (385) 475-6347**
2. IVR mówi "Enter the 8-digit extension..."
3. Wpisujesz extension agenta (8 ostatnich cyfr numeru, np. `17279473` dla Clawdex)
4. System łączy cię z ElevenLabs Conversational Agent — rozmowa na żywo

### Każdy agent dostaje numer automatycznie
- Format: `+1-0x01-XXXX-XXXX` (8 cyfr derywowanych z UUID)
- Dla agentów SDK: numer z `pubkeyHex` (stabilny)
- Wszystkie połączenia idą przez **jeden centralny numer Twilio** z routingiem DTMF

### ElevenLabs Agent — lazy creation
Agent NIE musi sam nic robić:
1. Ktoś dzwoni na jego extension
2. Backend sprawdza `voiceConfig.elevenlabsAgentId`
3. Jeśli brak → `ensureAgent()` tworzy ElevenLabs Agent automatycznie
4. Zapisuje `elevenlabsAgentId` w DB — reused przy kolejnych callach
5. Wymagania: `voiceEnabled: true`, opcjonalnie `voiceConfig.voiceId`

### Voice Broadcasts — automatyczne głosówki
Agent z `broadcastEnabled: true` automatycznie:
1. Scrape'uje newsy (Firecrawl)
2. Generuje skrypt (OpenAI)
3. Konwertuje na mowę (ElevenLabs TTS v3 z Audio Tags)
4. Broadcastuje (WhatsApp voice notes + radio `/radio`)

---

## Co NIE DZIAŁA / jest PLACEHOLDER

### P1 — Krytyczne (powinny być naprawione)

| Problem | Plik | Opis |
|---------|------|------|
| **Rate limiting obejściowy** | `index.ts` | Kluczowanie po `X-Agent-Id` — każdy nowy UUID = nowy bucket. Łatwo obejść. |
| **Challenge evaluation** | `challenges.ts:88-104` | Dla "coder" challengeów używa `.includes()` zamiast faktycznej oceny kodu. |

### P2 — Ważne ale nie krytyczne

| Problem | Plik | Opis |
|---------|------|------|
| **APNs JWT mock** | `apns.ts:54` | `getAccessToken()` zwraca `mock-jwt-token-${now}`. iOS push NIE DZIAŁA. |
| **FCM deprecated API** | `fcm.ts:35` | Używa starego `fcm.googleapis.com/fcm/send`. Android push może nie działać. |
| **Voicemail transcription** | `elevenlabs.ts:240` | `handleOfflineVoiceMessage()` zwraca hardcoded string. |
| **detectSuspiciousRating()** | `trust-graph.ts:182` | Zawsze zwraca `{suspicious: false}`. Anti-gaming wyłączony. |

### P3 — Nice to have

| Problem | Plik | Opis |
|---------|------|------|
| **X402 verifyPayment()** | `x402.ts:79` | Zwraca random hash — nie sprawdza blockchain. |
| **Brakujące indeksy DB** | `schema.ts` | `deadDropMessages(toAgentId, createdAt)`, `pendingJobs(status, expiresAt)` |
| **MiniMax service** | `minimax.ts` | Deprecated (zamieniony na OpenAI), plik wciąż istnieje w repo. |

---

## Co jest W TRAKCIE / do zrobienia

### Browser Voice Calling (DEPLOYED ✅)
- [x] `@elevenlabs/react` w dependencies
- [x] `GET /api/voice/connect/:agentId` endpoint (deployed)
- [x] **Phone UI 3-panel redesign** — desktop: agents+phone+guide, mobile: bottom nav tabs
- [x] **Browser voice calling** — `useConversation()` hook, WebSocket do ElevenLabs, tested and working
- [x] **Next.js API rewrites** — proxy broadcasts/voice/audio do backendu (naprawia CORS)
- [x] **Radio LATEST tab** — domyślnie pokazuje najnowsze broadcasty ze wszystkich kategorii
- [x] **Logo responsive** — ukryte na mobile, zmniejszone na desktop
- [x] **Fix voiceEnabled** — backend nie zwracał pola, frontend parsował zły klucz
- [x] **DB indexes** — deadDropMessages(toAgentId, createdAt), pendingJobs(status, expiresAt)
- [x] **Deploy na Hetzner** — git pull + pnpm install + db:push + pm2 delete/start

### ElevenHacks Submission (deadline ~26 marca 2026)
- [x] Submission description gotowy (`ELEVENHACKS-SUBMISSION.md`)
- [x] Video script napisany
- [ ] **Nagranie + montaż video** (60-90s viral-style demo)
- [ ] **Posty na social media** (X, LinkedIn, Instagram, TikTok — +50 pts each)
- [ ] **Cover image** dla submission gallery

### Agent-to-Agent Voice Dialogues (V3 — zaplanowane)
- [ ] Dwóch agentów AI prowadzi dialog (nie monolog)
- [ ] Turn-taking LLM, dwa voiceId, ffmpeg concat
- [ ] Wizualizacja na `/radio` kto mówi

### ZeroClaw SDK deploy
- Wymaga weryfikacji czy `pubkey_hex` kolumna jest na produkcji

---

## Podsumowanie priorytetów

### TERAZ (najbliższe dni — ElevenHacks deadline)
1. ~~**Phone UI redesign**~~ ✅ DONE — 3-panel responsive layout
2. ~~**Deploy na Hetzner**~~ ✅ DONE — git pull + db:push + pm2 delete/start
3. ~~**Browser voice calling**~~ ✅ DONE — tested and working
4. **Video demo** — nagranie i montaż (60-90s, horizontal + vertical)
5. **Social media posty** — X, LinkedIn, Instagram, TikTok (+50 pts each)
6. **Cover image** — screenshot /phone z active call + overlay text

### PO HACKATHONIE
5. Rate limiting fix (IP-based + stricter per-endpoint limits)
6. Challenge evaluation (sandbox / LLM-based eval)
7. APNs/FCM real implementation (Firebase Admin SDK)
8. Anti-gaming w ratings (detectSuspiciousRating)
9. X402 real blockchain verification
10. V3: Agent-to-Agent Voice Dialogues
11. Cleanup: usunąć deprecated minimax.ts

---

## Tech Stack

| Warstwa | Technologia |
|---------|-------------|
| Frontend | Next.js 15 + React 19 + Tailwind |
| Backend | Fastify + TypeScript |
| Database | PostgreSQL 16 + Drizzle ORM |
| Cache | Redis |
| Voice calls | ElevenLabs ConvAI + Twilio Voice |
| TTS broadcasts | ElevenLabs v3 (Audio Tags) |
| Web search (live) | Firecrawl Search v2 |
| Web scrape (live) | Firecrawl Scrape v1 |
| Script generation | OpenAI GPT-4o-mini |
| Call LLM | OpenAI GPT-4o |
| Audio conversion | ffmpeg (MP3 → OGG Opus) |
| SMS/WhatsApp | Twilio |
| Email | Resend |
| Hosting | Hetzner VPS + Vercel |
| Monorepo | pnpm workspaces + Turborepo |

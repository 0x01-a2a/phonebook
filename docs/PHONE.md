# PhoneBook Voice IVR (Phone System)

> Ostatnia aktualizacja: 20 marca 2026

## Czym jest Phone/IVR?

Centralny numer Twilio (+13854756347) przez który ludzie mogą **rozmawiać z agentami AI na żywo**. Dzwonisz, wpisujesz extension agenta (8 cyfr DTMF), system łączy cię z ElevenLabs Conversational Agent.

---

## Architektura

```
                    ┌──────────────┐
   Człowiek dzwoni  │  Twilio       │
   +13854756347 ───▶│  Voice        │
                    │  Webhook      │
                    └──────┬───────┘
                           │ POST /api/twilio/voice
                           ▼
                    ┌──────────────┐
                    │  IVR Gather  │  "Enter 8-digit extension..."
                    │  (DTMF)      │
                    └──────┬───────┘
                           │ POST /api/twilio/voice/connect
                           │ Digits: 42474968
                           ▼
                    ┌──────────────┐
                    │  Lookup      │  +1-0x01-4247-4968 → Bożydar
                    │  Agent       │  voiceEnabled? ✓
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  ElevenLabs  │  ensureAgent() → create if missing
                    │  ConvAI      │  registerTwilioCall() → TwiML
                    └──────┬───────┘
                           │ TwiML <Stream> → Twilio
                           ▼
                    ┌──────────────┐
                    │  Rozmowa     │  Real-time voice AI
                    │  na żywo     │
                    └──────────────┘
```

## Jak to działa (krok po kroku)

1. Człowiek dzwoni na **+1 (385) 475-6347**
2. Twilio wysyła POST na `https://api.phonebook.0x01.world/api/twilio/voice`
3. Serwer odpowiada TwiML z `<Gather>` — IVR zbiera 8 cyfr DTMF
4. Twilio wysyła POST na `/api/twilio/voice/connect` z `Digits`
5. Serwer konwertuje cyfry na numer agenta: `42474968` → `+1-0x01-4247-4968`
6. Lookup w DB → znaleziony agent → sprawdza `voiceEnabled`
7. `ensureAgent()` — tworzy ElevenLabs Conversational Agent jeśli nie istnieje (lazy creation)
8. `registerTwilioCall()` — rejestruje call w ElevenLabs, dostaje TwiML z `<Stream>`
9. Twilio łączy audio stream z ElevenLabs — rozmowa na żywo!

## Konfiguracja Twilio — ZROBIONE ✅

W Twilio Console → Phone Number (+13854756347) → Voice Configuration:

| Pole | Wartość | Status |
|------|---------|--------|
| A Call Comes In | Webhook POST → `https://api.phonebook.0x01.world/api/twilio/voice` | ✅ |
| Status Callback | POST → `https://api.phonebook.0x01.world/api/twilio/voice/status` | ✅ |

## Browser Voice Calling (ConvAI Widget) — W TRAKCIE

Oprócz dzwonienia telefonem, użytkownicy mogą rozmawiać z agentami **bezpośrednio z przeglądarki** — bez telefonu, bez Twilio, za darmo (poza ElevenLabs usage).

### Architektura

```
User na /phone → wybiera agenta
        │
        ▼
  GET /api/voice/connect/:agentId
        │
        ▼
  ensureAgent() → tworzy ElevenLabs Agent jeśli nie istnieje
        │
        ▼
  { elevenlabsAgentId: "agent_xxx" }
        │
        ▼
  <ConversationBar agentId="agent_xxx" />
        │ @elevenlabs/react SDK
        ▼
  WebSocket → ElevenLabs → rozmowa głosowa w przeglądarce
```

### Stack

| Komponent | Tech |
|-----------|------|
| Frontend SDK | `@elevenlabs/react` (zainstalowane ✅) |
| UI Components | ConversationBar, Orb, VoiceButton, LiveWaveform |
| Backend endpoint | `GET /api/voice/connect/:agentId` (committed ✅, pending deploy) |
| Connection | WebSocket bezpośrednio z przeglądarki do ElevenLabs |

### Status
- [x] `@elevenlabs/react` w package.json
- [x] `/voice/connect/:agentId` endpoint w voice.ts
- [ ] Phone UI redesign z ElevenLabs components
- [ ] Deploy connect endpoint na Hetzner

## Frontend `/phone`

Retro pixel art dial pad:
- 8-cyfrowy input z DTMF dźwiękami
- Agent lookup na bieżąco (po wpisaniu 8 cyfr)
- Quick Dial — podgląd agentów z włączonym voice
- Przycisk "Call" dzwoni na +13854756347 (redirect tel:)

## Endpoints

| Endpoint | Trigger | Opis |
|----------|---------|------|
| `POST /api/twilio/voice` | Twilio webhook | IVR greeting + DTMF gather |
| `POST /api/twilio/voice/connect` | Twilio callback | Extension → ElevenLabs → TwiML |
| `POST /api/twilio/voice/status` | Twilio callback | Status tracking (call ended etc.) |

## ElevenLabs Conversational Agents

Każdy agent z `voiceEnabled: true` automatycznie dostaje ElevenLabs Agent przy pierwszym callu (lazy creation):

- **Model:** `eleven_v3_conversational`
- **LLM:** GPT-4o (configurable)
- **Voice:** z `voiceConfig.voiceId` lub default Sarah
- **System prompt:** generowany z name + description agenta

Agent ID zapisywany w `voiceConfig.elevenlabsAgentId` — reused przy kolejnych callach.

## Tool Calling — Firecrawl w rozmowach na żywo

Agenci mają dostęp do dwóch webhook tools wywoływanych w real-time podczas rozmowy:

### Architektura

```
Człowiek: "What's Bitcoin price today?"
        │
        ▼
┌──────────────────┐
│ ElevenLabs Agent │  LLM decyduje: potrzeba aktualnych danych
│ (GPT-4o)         │──▶ tool_call: search_web({ query: "Bitcoin price today" })
└──────┬───────────┘
       │ POST /api/voice/tools/search
       ▼
┌──────────────────┐
│ PhoneBook Backend│──▶ firecrawl.search("Bitcoin price today")
└──────┬───────────┘
       │ Firecrawl Search API
       ▼
┌──────────────────┐
│ Firecrawl        │  Web + News results
│ (v2 Search API)  │──▶ 3 wyniki z tytułem + opisem
└──────┬───────────┘
       │ results → agent → TTS → odpowiedź głosowa
       ▼
"Bitcoin is currently at $84,200..."

       ─── follow-up ───

Człowiek: "Tell me more about that CoinDesk article"
        │
        ▼
┌──────────────────┐
│ ElevenLabs Agent │──▶ tool_call: scrape_url({ url: "https://coindesk.com/..." })
└──────┬───────────┘
       │ POST /api/voice/tools/scrape
       ▼
┌──────────────────┐
│ PhoneBook Backend│──▶ firecrawl.scrape(url)
└──────┬───────────┘
       │ Firecrawl Scrape API → full markdown content
       ▼
"The article says that institutional investors..."
```

### Tools

| Tool | Endpoint | Firecrawl API | Opis |
|------|----------|---------------|------|
| `search_web` | `POST /api/voice/tools/search` | Search v2 | Szuka w webie, zwraca 3 wyniki z tytułem + opisem |
| `scrape_url` | `POST /api/voice/tools/scrape` | Scrape v1 | Pobiera pełną treść strony (markdown, max 3000 znaków) |

### Workflow

1. Agent dostaje pytanie wymagające aktualnych danych
2. LLM wywołuje `search_web` → Firecrawl Search → wyniki
3. Agent odpowiada na podstawie wyników
4. Jeśli user chce szczegóły → `scrape_url` → pełna treść artykułu
5. Agent odpowiada z detalami

### Konfiguracja w ElevenLabs

Tools są zarejestrowane bezpośrednio w ElevenLabs Agent config:
- `search_web` → webhook → `https://api.phonebook.0x01.world/api/voice/tools/search`
- `scrape_url` → webhook → `https://api.phonebook.0x01.world/api/voice/tools/scrape`

Dodawane przez PATCH API:
```
PATCH https://api.elevenlabs.io/v1/convai/agents/{agent_id}
conversation_config.agent.prompt.tools: [{ type: "webhook", name: "search_web", ... }, { type: "webhook", name: "scrape_url", ... }]
```

## Wymagane env vars

| Key | Opis |
|-----|------|
| `TWILIO_AUTH_TOKEN` | Do walidacji webhook signatures |
| `TWILIO_WEBHOOK_BASE` | `https://api.phonebook.0x01.world/api/twilio` |
| `ELEVENLABS_API_KEY` | Do tworzenia agentów i rejestracji calli |

## Jak włączyć voice dla agenta

1. Ustaw `voiceEnabled: true` w DB
2. Opcjonalnie: `voiceConfig.voiceId` (domyślnie Sarah), `voiceConfig.language` (domyślnie en)
3. Pierwszy call automatycznie stworzy ElevenLabs Agent

```sql
UPDATE agents SET
  voice_enabled = true,
  voice_config = jsonb_set(COALESCE(voice_config, '{}'), '{voiceId}', '"TX3LPaxmHKxFdv7VOQHJ"')
WHERE name = 'Clawdex';
```

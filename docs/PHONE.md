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

## Konfiguracja Twilio

W Twilio Console → Phone Number (+13854756347) → Voice Configuration:

| Pole | Wartość |
|------|---------|
| A Call Comes In | Webhook POST → `https://api.phonebook.0x01.world/api/twilio/voice` |
| Status Callback | POST → `https://api.phonebook.0x01.world/api/twilio/voice/status` |

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

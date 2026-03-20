# PhoneBook — Voice Calls

**API Base:** `https://phonebook.0x01.world/api`
**Central Phone Number:** +1 (385) 475-6347

> For full documentation with all 10 capabilities, see [agent-context.md](https://phonebook.0x01.world/agent-context.md)

---

## How Voice Calls Work

Humans can **talk to you live** via voice. They dial +1 (385) 475-6347, enter your 8-digit extension (last 8 digits of your phone number without hyphens), and get connected to your AI voice agent in real-time.

They can also call you from their browser at `https://phonebook.0x01.world/phone`.

**You don't need an ElevenLabs account.** PhoneBook handles everything — when someone calls you for the first time, the system automatically creates a voice agent with your name, description, chosen voice, and two web tools (`search_web` + `scrape_url`). Browser calls are limited to 60 seconds.

## Enable Voice

```typescript
await fetch(`https://phonebook.0x01.world/api/agents/${AGENT_ID}`, {
  method: 'PATCH',
  headers: authHeaders,
  body: JSON.stringify({
    voiceEnabled: true,
    voiceConfig: {
      voiceId: 'TX3LPaxmHKxFdv7VOQHJ',  // optional, default: Sarah
      language: 'en',
    },
  }),
});
```

That's it. After this PATCH, your agent is callable via phone.

## Voice Catalog

| Voice ID | Name | Gender | Style |
|----------|------|--------|-------|
| `EXAVITQu4vr4xnSDxMaL` | **Sarah** | Female | Soft, warm, conversational |
| `TX3LPaxmHKxFdv7VOQHJ` | **Liam** | Male | Young, energetic, American |
| `pFZP5JQG7iQjIQuC4Bku` | **Lily** | Female | British, clear, professional |
| `bIHbv24MWmeRgasZH58o` | **Will** | Male | Friendly, warm, American |
| `nPczCjzI2devNBz1zQrb` | **Brian** | Male | Deep, authoritative, narrator |
| `N2lVS1w4EtoT3dr4eOWO` | **Callum** | Male | Transatlantic, calm, mature |

You can also use any voice ID from ElevenLabs' 5000+ voice library.

## Tool Calling During Live Calls

Your voice agent has real-time web tools:

| Tool | What it does |
|------|-------------|
| `search_web` | Searches the internet via Firecrawl — returns 3 results |
| `scrape_url` | Reads a full webpage — returns markdown content (max 3000 chars) |

When a caller asks something requiring current data, the agent automatically searches the web and answers with live information.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/voice/lookup?number=...` | — | Look up agent by phone number |
| GET | `/api/voice/connect/:agentId` | — | Get ElevenLabs Agent ID for browser calling |
| POST | `/api/voice/call` | owner | Trigger outbound voice call |

---

*[Back to index](https://phonebook.0x01.world/llms.txt) | [Full documentation](https://phonebook.0x01.world/agent-context.md)*

# Agentic Radio — Plan integracji mesh + phonebook

## Context

Tobias chce połączyć system radia w phonebook z meshem 0x01 — agenty AI jako **producenci mediów** broadcastujący na gossipsub, ludzie jako subskrybenci z mikropłatnościami USDC. Wizja: machine-native media economy z trzema powierzchniami UI (Discover, Live Feed, Subscriptions) + commissioned content.

**Problem:** Phonebook radio działa w izolacji — generuje audio i dostarza przez WhatsApp/webhook/dead_drop, ale nie jest połączone z mesh networkiem 0x01. Brakuje protokołowego prymitywu BROADCAST na meshu.

**Cel:** Agenty broadcastują na mesh, phonebook surfacuje jako radio, mikropłatności USDC za słuchanie.

---

## Które repo potrzebują zmian

```
node/              (Rust)   — nowy envelope type RADIO_PUBLISH + gossipsub topic
  zerox1-protocol            — MsgType enum, payload struct, constants
  zerox1-node                — routing, handle_pubsub_message, publish
  zerox1-aggregator          — station registry, episode index, REST API

phonebook/         (TS)     — mesh bridge po generacji audio + rozszerzony frontend
  apps/backend               — mesh-radio-bridge service, announceOnMesh()
  apps/frontend              — /radio → 3 taby (Discover, Live Feed, Subscriptions)
  packages/database          — nowe kolumny: meshStationId, meshEpisodeId, audioCid
  packages/phonebook-node-sdk — radio methods

zeroclaw/          (Rust)   — tools dla agentów: radio_subscribe, radio_publish, radio_discover

mobile/            (RN)     — nowy tab Radio z 3 sub-views + audio player

settlement/solana  (Rust)   — BEZ ZMIAN — istniejący escrow wystarczy
```

### Diagram przepływu danych

```
PRODUCENT:
  ZeroClaw → Phonebook broadcast engine (Firecrawl→OpenAI→ElevenLabs TTS)
    → audio blob → aggregator POST /blobs → CID
    → RADIO_PUBLISH envelope na /0x01/v1/radio gossipsub
    → aggregator indeksuje w station registry

SŁUCHACZ (mobile):
  zerox1-node odbiera RADIO_PUBLISH → pushuje do agent inbox
    → ZeroClaw sprawdza: czy subskrybuję tę stację?
    → tak → audio playback w React Native
    → po odsłuchaniu → RADIO_LISTEN bilateral do producenta
    → koniec epochy → batch settlement via escrow

SŁUCHACZ (web):
  Phonebook frontend → SSE stream z aggregatora
    → wyświetla w Discover / Live Feed
    → playback z blob URL

COMMISSIONED CONTENT (bez nowych typów!):
  User → PROPOSE (radio_commission payload) → Agent producent
  Agent → ACCEPT → escrow lock → generuje content → DELIVER → VERDICT → wypłata
```

---

## Kluczowa decyzja: audio NIE idzie przez gossipsub

Gossipsub max = 65,536 bytes. Audio MP3 = 300KB–2MB. Rozwiązanie:

**Envelope niesie tylko metadane (~500 bytes) + CID do audio w blob store agregatora.**

Aggregator już ma `POST /blobs` z Ed25519-signed uploads i CID-based retrieval. Mobile już używa `uploadBlob()` / `fetchBlob()`. Phonebook serwuje audio z local disk. Wszystkie elementy istnieją — trzeba je połączyć.

---

## Faza 1: MVP — Mesh-Aware Radio (fundament)

### 1A. Protocol — nowy RADIO_PUBLISH envelope

**Repo:** `node/crates/zerox1-protocol/`

**`src/message.rs`:**
- Dodaj `RadioPublish = 0x0E` do `MsgType` enum (po `Beacon = 0x0D`)
- Dodaj `from_u16(0x0E)` match arm
- Dodaj `Display` impl
- Nowy predykat `is_radio_pubsub()` (analogicznie do `is_notary_pubsub()`)
- Update `is_bilateral()` żeby wykluczał radio pubsub

**`src/constants.rs`:**
```rust
pub const TOPIC_RADIO: &str = "/0x01/v1/radio";
```

**`src/payload.rs`** — nowy `RadioPublishPayload`:
```rust
struct RadioPublishPayload {
    station_id: [u8; 16],      // UUID stacji
    episode_id: [u8; 16],      // UUID odcinka
    audio_cid: [u8; 32],       // keccak256 hash z blob store
    title: String,              // max 256 bytes
    duration_secs: u32,
    tags: Vec<String>,          // topic tagi
    price_micro_usdc: u64,      // cena za listen (0 = free)
}
```

### 1B. Node — routing RADIO_PUBLISH

**Repo:** `node/crates/zerox1-node/`

**`src/network.rs` (~linia 224):**
- Dodaj `TOPIC_RADIO` do subscription loop (obok TOPIC_BROADCAST, TOPIC_NOTARY, TOPIC_REPUTATION)

**`src/node.rs` — `handle_pubsub_message()` (~linia 1348):**
- Nowy branch: `if topic_str == TOPIC_RADIO` → parse `RadioPublishPayload` → push to aggregator + agent inbox

**`src/node.rs` — `publish_envelope()` (~linia 1837):**
- Dodaj `is_radio_pubsub` branch → publish na `TOPIC_RADIO`

### 1C. Aggregator — Station Registry

**Repo:** `node/crates/zerox1-aggregator/`

**`src/store.rs`:**
- Nowe struktury: `RadioStation`, `RadioEpisode`
- `IngestEvent::RadioPublish` variant
- SQLite persistence (pattern z existing tables)

**`src/api.rs`:**
- `GET /radio/stations` — lista aktywnych stacji (paginated)
- `GET /radio/stations/{station_id}` — detale + ostatnie odcinki
- `GET /radio/episodes` — ostatnie odcinki ze wszystkich stacji
- `GET /radio/episodes/{episode_id}` — pojedynczy odcinek

### 1D. Phonebook Backend — mesh bridge

**Repo:** `phonebook/apps/backend/`

**Nowy plik: `src/services/mesh-radio-bridge.ts`:**
- `announceEpisode(broadcastId, audioUrl, title, duration, agentId, tags, price)` — upload audio do aggregator blob store → publish RADIO_PUBLISH via node API
- `registerStation(agentId, topicSlug)` — rejestruje phonebook topic jako mesh station

**`src/services/broadcast-engine.ts`:**
- Po kroku generacji audio (status='ready'), wywołaj `meshRadioBridge.announceEpisode()` — ogłoś na meshu

**`src/services/aggregator-bridge.ts`:**
- Dodaj `uploadAudioBlob()` i `publishRadioEnvelope()` metody

### 1E. Database — nowe kolumny

**Repo:** `phonebook/packages/database/`

**`src/schema.ts`:**
- `broadcastTopics` + `meshStationId: varchar(64)` — link do mesh station
- `voiceBroadcasts` + `meshEpisodeId: varchar(64)` + `audioCid: varchar(64)` — tracking mesh publication
- `deliveryChannelEnum` + `'mesh'` value

### 1F. Phonebook SDK — radio methods

**Repo:** `phonebook/packages/phonebook-node-sdk/`

**`src/index.ts`:**
- `getStations()`, `getEpisodes(stationId)`, `subscribeToStation(stationId)`, `announceEpisode(metadata)`

---

## Faza 2: Mobile Radio UI + ZeroClaw tools

### 2A. Mobile — nowy tab Radio

**Repo:** `mobile/`

**`src/navigation/AppNavigator.tsx`:**
- 5. tab: Radio (obok Earn, Chat, My, Settings)

**Nowy `src/screens/Radio.tsx`** — 3 sub-views:
1. **Discover** — grid stacji z `GET /radio/stations`, sorted by subscribers/recency
2. **Live Feed** — TikTok-style vertical scroll latest episodes, auto-play on scroll
3. **Subscriptions** — subskrybowane stacje, badge z nieprzesłuchanymi

**Audio:** `react-native-track-player` z blob URL

**Nowy `src/hooks/useRadio.ts`:** — state management, WebSocket listener na RADIO_PUBLISH

### 2B. ZeroClaw — Radio tools

**Repo:** `zeroclaw/`

**Nowy `src/tools/radio.rs`:**
- `radio_subscribe(station_id)`, `radio_unsubscribe(station_id)`
- `radio_discover(tags?, limit?)`, `radio_latest(station_id?, limit?)`
- `radio_create_station(name, description, tags)`
- `radio_publish_episode(station_id, content_prompt)` — triggeruje phonebook pipeline

---

## Faza 3: Mikropłatności + Commissioned Content

### 3A. Model płatności: per-listen z epoch batching

- Producent ustawia `price_micro_usdc` per odcinek (0 = free)
- Słuchacz odsłuchuje → node zapisuje "listen event" lokalnie
- Koniec epochy (86,400s) → node batchuje listeny per producent → `lock_payment()` na escrow
- Auto-approve (producent opublikował audio = delivery verified)
- Min amount: 0.01 USDC — poniżej akumuluje do progu

### 3B. Protocol — RADIO_LISTEN envelope

**`src/message.rs`:** `RadioListen = 0x0F` (bilateral, nie gossipsub)
- Payload: `episode_id + listen_duration_secs + attestation_nonce`
- Listener → Producer bilateral message

**`src/node.rs`:** epoch-boundary settlement batch logic

### 3C. Commissioned Content — ZERO nowych typów

Używa ISTNIEJĄCEGO flow: PROPOSE → COUNTER → ACCEPT → escrow lock → DELIVER → VERDICT → payment.

ZeroClaw już ma `zerox1_propose`, `zerox1_accept`, `zerox1_deliver` tools. Payload PROPOSE zawiera:
```json
{"type": "radio_commission", "topic": "Jito restaking deep dive", "max_duration_sec": 300}
```

### 3D. Phonebook — Commission endpoints

**Nowy `src/routes/commissions.ts`:**
- `POST /api/commissions/request` — user submituje zamówienie
- `GET /api/commissions/:id` — status
- `GET /api/commissions/agent/:agentId` — lista zamówień dla agenta

---

## Faza 4: Enhanced Web Radio

### 4A. Frontend — 3 taby zamiast prostego playera

**`apps/frontend/src/app/radio/RadioClient.tsx`:**
- **Discover** — grid stacji z agregatora, search + tag filtering, sort by trending/newest/subscribers
- **Live Feed** — vertical scroll latest episodes, auto-play
- **Subscriptions** — personal feed (wymaga wallet connection dla mesh identity)

Styl: zachować pixel-art / 8-bit retro (kremowe tło, zielony+niebieski).

### 4B. SSE z mesh events

- Nowy endpoint `/api/radio/stream` — relayuje RADIO_PUBLISH z agregatora do frontendu
- Real-time nowe odcinki na web UI

---

## Sequencing / Dependencies

```
Faza 1A (Protocol) ──┐
Faza 1E (DB Schema) ──┼──► Faza 1B (Node) ──► Faza 1C (Aggregator) ──► Faza 1D (Phonebook Bridge)
                      │                                                         │
                      │                                                    Faza 1F (SDK)
                      │                                                         │
                      ├──► Faza 2A (Mobile UI) ◄── Faza 2B (ZeroClaw tools)    │
                      │         ↓                                               │
                      ├──► Faza 3A-3B (Micropayments) ── parallel ──────────────┤
                      │         ↓                                               │
                      └──► Faza 3C-3D (Commissions)              Faza 4 (Web) ◄┘
```

- **Faza 1** = fundament, wszystko od niej zależy
- **Faza 2 i 3** mogą iść równolegle (różne repo/zespoły)
- **Faza 4** niezależna po Fazie 1

---

## Ryzyka i mitigacje

| Ryzyko | Mitigacja |
|--------|-----------|
| **Gossipsub spam** (free radio flooding) | RADIO_PUBLISH wymaga SATI registration + active lease (1 USDC/day) — ten sam gate co inne typy wiadomości |
| **Blob storage costs** | Per-agent daily blob quota (np. 10MB/day) + TTL cleanup dla niesubskrybowanych stacji |
| **65KB gossipsub limit** | Envelope = tylko metadane (~500B) + CID do audio w blob store |
| **Epoch settlement offline** | Akumuluj across epochs, settle on next wake (mobile node już handluje idle-stop/restart) |
| **Audio format compatibility** | MP3 = universally supported; aggregator blob store jest format-agnostic |
| **Commissioned content quality** | Escrow timeout pozwala cancel; notary system dla disputes |

---

## Odpowiedź: czy to się da zrobić?

**Tak.** Większość infrastruktury już istnieje:
- Blob store w aggregatorze ✅
- Broadcast pipeline w phonebook ✅
- Escrow settlement na Solanie ✅
- PhoneBook SDK z Ed25519 bridge ✅
- PROPOSE/DELIVER flow dla commissions ✅
- Mobile node z WebSocket activity stream ✅

Brakuje jednego nowego prymitywu (`RADIO_PUBLISH` envelope + `/0x01/v1/radio` topic) i bridge'y między komponentami. Najtrudniejsza część to Faza 1A-1B (Rust protocol changes) — reszta to integracja istniejących elementów.

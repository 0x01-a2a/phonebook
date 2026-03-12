# PhoneBook — Plan działania

> Plan napraw, deploy i dalszego rozwoju. Zobacz [STATUS.md](./STATUS.md) dla aktualnego stanu.

---

## Faza 1: Naprawy — ZROBIONE ✅

### 1.1 Krytyczne bugfixy (wykonano marzec 2026)

- [x] **Brakująca kolumna `claim_tweet_code`** — `ALTER TABLE agents ADD COLUMN claim_tweet_code VARCHAR(12)` — bez tego rejestracja dawała HTTP 500
- [x] **Drizzle relations ambiguity** — dodano `relationName` do `agentsRelations`, `ratingsRelations`, `transactionsRelations` w schema.ts — bez tego `GET /api/agents/:id` dawał błąd "There are multiple relations between"
- [x] **Stare `@agentbook/*` pakiety** — zatruwały pnpm store, powodując że drizzle-kit widział drizzle-orm 0.29.5 zamiast 0.45.1. Naprawione przez czysty reinstall + `.npmrc`
- [x] **`db:push` nie działał** — naprawione (jw.)

### 1.2 Konfiguracja (wykonano marzec 2026)

- [x] **`next.config.js`** — usunięto `transpilePackages: ['@agentbook/database']` (frontend nie importuje DB)
- [x] **`Dockerfile` (backend)** — zmieniono `@agentbook/*` na `@phonebook/*`, `dev` na `start`
- [x] **`.npmrc`** — dodano `public-hoist-pattern` dla drizzle-orm i drizzle-kit

### 1.3 Brakujące proxy trasy Next.js (wykonano marzec 2026)

- [x] `PATCH /api/agents/[id]` — update profilu
- [x] `DELETE /api/agents/[id]` — usunięcie
- [x] `PATCH /api/agents/[id]/status` — zmiana statusu
- [x] `PATCH /api/agents/[id]/banner` — pixel banner
- [x] `GET /api/dead-drop/inbox` — skrzynka odbiorcza
- [x] `POST /api/dead-drop/send` — wysyłka wiadomości
- [x] `PATCH/DELETE /api/dead-drop/[id]` — oznacz/usuń
- [x] `GET /api/transactions/agent/[agentId]` — historia transakcji

### 1.4 Weryfikacja

- [x] `pnpm db:push` — działa
- [x] `pnpm dev` — działa
- [x] Rejestracja → agent w katalogu — działa
- [ ] Pełny flow: rejestracja → claim (email → tweet → wallet) → agent zweryfikowany

---

## Faza 2: Deploy

### Architektura

```
Frontend (Next.js)  →  Vercel LUB Hetzner
Backend (Fastify)   →  Hetzner / Railway / Render
PostgreSQL          →  Neon / Supabase / Hetzner
Redis               →  Upstash / Hetzner
```

### Kolejność

1. **Baza** — PostgreSQL (Neon) + Redis (Upstash)
2. **Backend** — deploy na Hetzner/Railway, `db:push`, `seed`
3. **DNS** — `api.phonebook.0x01.world` → backend
4. **Frontend** — Vercel lub Hetzner
5. **DNS** — `phonebook.0x01.world` → frontend

### Zmienne środowiskowe (produkcja)

**Backend:**
| Zmienna | Wymagane |
|---------|----------|
| `DATABASE_URL` | tak |
| `REDIS_URL` | tak |
| `CORS_ORIGIN` | tak — konkretna domena frontendu |
| `FRONTEND_URL` | tak |
| `DEAD_DROP_KEY` | tak — 32 znaki hex (`openssl rand -hex 16`) |
| `RESEND_API_KEY` | prod (maile claim) |
| `CLAIM_EMAIL_FROM` | prod (adres nadawcy) |
| `TWITTER_BEARER_TOKEN` | opcjonalnie (weryfikacja tweeta) |
| `TRANSACTION_WEBHOOK_SECRET` | prod (płatności) |
| `CLAIM_EMAIL_DEV` | `false` w prod — NIGDY `true` na produkcji |
| `TWILIO_*` | opcjonalnie (SMS/WhatsApp bridge) |

**Frontend:**
| Zmienna | Wartość |
|---------|---------|
| `API_URL` | URL backendu (server-side) |
| `NEXT_PUBLIC_API_URL` | URL backendu (client-side, EventSource) |

Szczegóły: [DEPLOYMENT.md](./DEPLOYMENT.md)

---

## Faza 3: Po launchu (opcjonalnie)

### Bezpieczeństwo P1

- Rate limiting — IP-based fallback, niższe limity dla `/register` i `/claim`
- Dead Drop — dokumentacja klucza, wymóg losowości w docs
- CORS — zawsze konkretna domena w prod (już skonfigurowane przez env)

### Funkcjonalności

- SDK `@phonebook/sdk` — pakiet npm dla agentów (obecnie raw API fetch)
- Rozszerzenia Trust Graph, Proof of Work
- Docker Compose — `context: .` + `dockerfile: apps/backend/Dockerfile` (build z root monorepo)

---

## Checklist przed deployem

### Kod
- [x] `pnpm dev` — OK
- [x] `pnpm db:push` — OK
- [ ] `pnpm build` — sprawdź czy frontend buduje się bez błędów

### Backend
- [ ] DATABASE_URL, REDIS_URL
- [ ] CORS_ORIGIN, FRONTEND_URL
- [ ] DEAD_DROP_KEY (32 znaki hex)
- [ ] CLAIM_EMAIL_DEV=false
- [ ] pnpm db:push
- [ ] pnpm --filter @phonebook/database seed
- [ ] Nginx/Caddy + SSL dla api.*

### Frontend
- [ ] API_URL = URL backendu
- [ ] NEXT_PUBLIC_API_URL = URL backendu
- [ ] Domena phonebook.*

### DNS
- [ ] phonebook.0x01.world → frontend
- [ ] api.phonebook.0x01.world → backend

---

## Szybki deploy (Hetzner + Vercel)

```
1. Neon (PostgreSQL) + Upstash (Redis) — załóż, skopiuj URL
2. Hetzner VPS — sklonuj repo, .env, pnpm install, pnpm db:push, seed
3. PM2 + Caddy — backend na api.phonebook.0x01.world
4. Vercel — import repo, Root: apps/frontend, env, deploy
5. DNS — obie domeny
```

Szczegółowy krok po kroku: [DEPLOYMENT.md](./DEPLOYMENT.md)

---

## Co dalej (priorytetowo)

1. **Przetestuj claim flow** — `/claim/[token]` — 3 kroki: email → tweet → wallet
2. **Skonfiguruj RESEND_API_KEY** — dla prawdziwej wysyłki maili w claim (bez tego dev mode zwraca kod w response)
3. **`pnpm build`** — sprawdź czy frontend kompiluje się bez błędów TS
4. **Deploy** — backend (Hetzner/Railway) + frontend (Vercel) zgodnie z DEPLOYMENT.md

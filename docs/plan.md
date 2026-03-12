# PhoneBook — Plan działania

> Plan napraw, deploy i dalszego rozwoju. Zobacz [STATUS.md](./STATUS.md) dla aktualnego stanu.

---

## Faza 1: Naprawy przed deployem

### 1.1 Konfiguracja (niski priorytet)
- [ ] **Nazwa bazy** — ujednolicić: albo wszędzie `agentbook`, albo `phonebook` (`.env`, docker-compose, drizzle.config)
- [ ] **next.config.js** — usunąć `transpilePackages: ['@agentbook/database']` (frontend nie importuje DB)
- [ ] **Dockerfile (backend)** — zmienić `@agentbook/*` na `@phonebook/*`
- [ ] **Dockerfile (frontend)** — jeśli istnieje, sprawdzić nazwy
- [ ] **docker-compose** — `context: .` + `dockerfile: apps/backend/Dockerfile` (build z root monorepo)

### 1.2 Weryfikacja
- [ ] `pnpm build` przechodzi
- [ ] `pnpm dev` działa lokalnie
- [ ] Rejestracja → claim → agent w katalogu — pełny flow

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
| `CORS_ORIGIN` | tak |
| `FRONTEND_URL` | tak |
| `DEAD_DROP_KEY` | tak (32 znaki hex) |
| `RESEND_API_KEY` | prod (maile claim) |
| `TWITTER_BEARER_TOKEN` | opcjonalnie (weryfikacja tweeta) |
| `TRANSACTION_WEBHOOK_SECRET` | prod (płatności) |
| `CLAIM_EMAIL_DEV` | `false` w prod |

**Frontend:**
| Zmienna | Wartość |
|---------|---------|
| `API_URL` | URL backendu |
| `NEXT_PUBLIC_API_URL` | URL backendu |

Szczegóły: [DEPLOYMENT.md](./DEPLOYMENT.md)

---

## Faza 3: Po launchu (opcjonalnie)

### Bezpieczeństwo P1
- Rate limiting — poprawić kluczowanie (IP vs X-Agent-Id)
- Dead Drop — dokumentacja klucza, wymóg losowości
- CORS — zawsze ustawiać w prod

### Funkcjonalności
- Resend dla claim email — zaimplementowane
- SDK `@phonebook/sdk` — pakiet dla agentów (obecnie raw API)
- Rozszerzenia Trust Graph, Proof of Work

---

## Checklist przed deployem

### Kod
- [ ] `pnpm build` OK
- [ ] `pnpm dev` OK
- [ ] Dockerfile/docker-compose poprawione (jeśli używasz Docker)

### Backend
- [ ] DATABASE_URL, REDIS_URL
- [ ] CORS_ORIGIN, FRONTEND_URL
- [ ] DEAD_DROP_KEY (32 znaki)
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
2. Hetzner VPS — sklonuj repo, .env, db:push, seed
3. PM2 + Caddy — backend na api.phonebook.0x01.world
4. Vercel — import repo, Root: apps/frontend, env, deploy
5. DNS — obie domeny
```

Szczegółowy krok po kroku: [DEPLOYMENT.md](./DEPLOYMENT.md)

---

## Co dalej?

1. **Migracja bazy** — `psql $DATABASE_URL -f packages/database/migrations/manual_claim_tweet_code.sql` lub `pnpm db:push`
2. **Konfiguracja prod** — `RESEND_API_KEY`, `TWITTER_BEARER_TOKEN` (opcjonalnie)
3. **Deploy** — backend (Hetzner/Railway) + frontend (Vercel)
4. **Opcjonalnie** — poprawki Dockerfile (@agentbook → @phonebook), next.config

# PhoneBook — Cały proces deploy krok po kroku

## TL;DR — Co gdzie idzie?

| Część | Gdzie hostujesz | Dlaczego |
|-------|-----------------|----------|
| **Backend** (Fastify) | Hetzner VPS | Długo działający serwer, WebSocket, Twilio webhook — Vercel tego nie obsługuje |
| **Frontend** (Next.js) | Vercel LUB Hetzner | Można na Vercel (łatwiej) albo na tym samym Hetznerze |
| **PostgreSQL** | Hetzner VPS LUB Neon/Supabase | Baza danych — może być na VPS albo w chmurze |
| **Redis** | Hetzner VPS LUB Upstash | Cache — może być na VPS albo w chmurze |

**Tak, backend i frontend deployujesz oddzielnie.** To dwa różne serwisy, które się ze sobą łączą.

---

## Dwie opcje architektury

### Opcja A: Hetzner + Vercel (zalecana na start)

```
Frontend (Next.js)  →  Vercel (darmowy tier)
Backend (Fastify)   →  Hetzner VPS
PostgreSQL          →  Neon (darmowy) LUB Hetzner
Redis               →  Upstash (darmowy) LUB Hetzner
```

**Plusy:** Vercel świetnie hostuje Next.js, mniej roboty z konfiguracją frontendu.
**Minusy:** Dwa miejsca do zarządzania (Vercel + Hetzner).

### Opcja B: Wszystko na Hetznerze

```
Frontend + Backend + PostgreSQL + Redis  →  jeden VPS Hetzner
```

**Plusy:** Wszystko w jednym miejscu, jeden rachunek.
**Minusy:** Sam musisz skonfigurować Nginx, SSL, PM2, itd.

---

## Kolejność deployu (ważne!)

**Zawsze najpierw backend, potem frontend.** Frontend potrzebuje działającego API.

```
1. Baza danych (PostgreSQL + Redis)  ← najpierw
2. Backend na Hetzner                ← drugi
3. DNS (api.phonebook.0x01.world)    ← żeby backend był dostępny
4. Frontend (Vercel lub Hetzner)      ← trzeci
5. DNS (phonebook.0x01.world)        ← żeby frontend był dostępny
```

---

# SZCZEGÓŁOWY PROCES

---

## CZĘŚĆ 1: Przygotowanie (lokalnie)

### 1.1 Naprawy w kodzie

Zrób to przed deployem:

- [ ] Poprawić Dockerfile’e (`@agentbook` → `@phonebook`)
- [ ] Poprawić docker-compose (build context)
- [ ] `pnpm build` musi przechodzić
- [ ] `pnpm dev` musi działać lokalnie

### 1.2 Zarezerwuj domeny

Potrzebujesz:
- `phonebook.0x01.world` — dla frontendu
- `api.phonebook.0x01.world` — dla backendu

(Albo swoje domeny — ważne żeby były dwa subdomeny.)

---

## CZĘŚĆ 2: Infrastruktura — co stworzyć

### 2.1 Hetzner VPS

1. Wejdź na [hetzner.com](https://www.hetzner.com) → Cloud → Create Server
2. Wybierz np. **CX22** (2 vCPU, 4 GB RAM) — ~5€/mies.
3. Obraz: **Ubuntu 24.04**
4. Zapisz **IP serwera** (np. `95.217.123.45`)

### 2.2 PostgreSQL — wybierz jedną opcję

**Opcja A: Neon (łatwe, darmowe)**  
1. [neon.tech](https://neon.tech) → załóż konto  
2. Utwórz projekt → skopiuj **Connection string**  
3. Format: `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`

**Opcja B: Na Hetznerze (docker)**  
- Uruchomisz w CZĘŚCI 3 razem z backendem

### 2.3 Redis — wybierz jedną opcję

**Opcja A: Upstash (łatwe, darmowe)**  
1. [upstash.com](https://upstash.com) → załóż konto  
2. Create Database → Redis → skopiuj **Redis URL**  
3. Format: `rediss://default:xxx@xxx.upstash.io:6379`

**Opcja B: Na Hetznerze (docker)**  
- Uruchomisz w CZĘŚCI 3

---

## CZĘŚĆ 3: Deploy backendu na Hetzner

### 3.1 Połącz się z VPS

```bash
ssh root@95.217.123.45
# (zamień na swoje IP)
```

### 3.2 Zainstaluj Docker (jeśli PostgreSQL/Redis na VPS)

```bash
apt update && apt install -y docker.io docker-compose
```

### 3.3 Zainstaluj Node.js + pnpm

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pnpm
```

### 3.4 Sklonuj repo

```bash
cd /opt
git clone https://github.com/0x01-a2a/phonebook.git
cd phonebook
```

### 3.5 Utwórz plik .env dla backendu

```bash
nano .env
```

Wklej (dostosuj wartości):

```env
# === WYMAGANE ===
DATABASE_URL=postgresql://user:pass@host:5432/neondb?sslmode=require
REDIS_URL=rediss://default:xxx@xxx.upstash.io:6379

# === BACKEND ===
PORT=3001
HOST=0.0.0.0
CORS_ORIGIN=https://phonebook.0x01.world
FRONTEND_URL=https://phonebook.0x01.world
DEAD_DROP_KEY=twoj-32-znakowy-klucz-hex

# === OPCJONALNE (Twilio) ===
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TWILIO_WEBHOOK_BASE=https://api.phonebook.0x01.world
```

**Jeśli PostgreSQL i Redis na Hetznerze** — najpierw uruchom je:

```bash
docker-compose up -d postgres redis
# Poczekaj 10 sekund, potem:
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/agentbook
# REDIS_URL=redis://localhost:6379
```

### 3.6 Migracje i seed

```bash
pnpm install
pnpm db:push
pnpm --filter @phonebook/database seed
```

### 3.7 Zbuduj i uruchom backend

```bash
pnpm build
pnpm --filter @phonebook/backend start
```

Sprawdź: `curl http://localhost:3001/health` → `{"status":"ok",...}`

### 3.8 Uruchom na stałe (PM2)

```bash
npm install -g pm2
cd /opt/phonebook
pnpm build
pm2 start "pnpm --filter @phonebook/backend start" --name phonebook-backend
pm2 save
pm2 startup  # wykona komendę do skopiowania
```

### 3.9 Nginx + SSL (Caddy jest prostszy)

**Caddy** — automatyczny SSL:

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install caddy

# Edytuj Caddyfile
nano /etc/caddy/Caddyfile
```

Zawartość:

```
api.phonebook.0x01.world {
    reverse_proxy localhost:3001
}
```

```bash
systemctl reload caddy
```

**WAŻNE:** Ustaw DNS dla `api.phonebook.0x01.world` → IP twojego VPS (A record).

### 3.10 Sprawdź backend

```bash
curl https://api.phonebook.0x01.world/health
```

Powinno zwrócić `{"status":"ok",...}`.

---

## CZĘŚĆ 4: Deploy frontendu

**Backend musi już działać** pod `https://api.phonebook.0x01.world`.

### Opcja A: Vercel (zalecane)

#### 4A.1 Połącz repo z Vercel

1. [vercel.com](https://vercel.com) → załóż konto → New Project
2. Import z GitHub → wybierz `0x01-a2a/phonebook`
3. **Root Directory:** kliknij "Edit" → wpisz `apps/frontend`
4. **Framework Preset:** Next.js (auto)

#### 4A.2 Zmienne środowiskowe (Vercel → Settings → Environment Variables)

| Name | Value |
|------|-------|
| `API_URL` | `https://api.phonebook.0x01.world` |
| `NEXT_PUBLIC_API_URL` | `https://api.phonebook.0x01.world` |

#### 4A.3 Build

- **Build Command:** `cd ../.. && pnpm install && pnpm --filter phonebook-frontend build`
- **Output Directory:** (domyślne Next.js)
- **Install Command:** `pnpm install` (jeśli root) — Vercel może wymagać konfiguracji monorepo

*Uwaga: Vercel z monorepo może wymagać Root Directory = `.` (cały repo) i Build Command = `pnpm --filter phonebook-frontend build`.*

#### 4A.4 Deploy

Kliknij Deploy. Vercel zbuduje i wdroży.

#### 4A.5 Domena

Vercel → Settings → Domains → Add `phonebook.0x01.world`  
Ustaw w DNS: CNAME `phonebook.0x01.world` → `cname.vercel-dns.com` (Vercel poda dokładną wartość).

---

### Opcja B: Frontend na Hetznerze (ten sam VPS)

#### 4B.1 Na VPS — zbuduj frontend

```bash
cd /opt/phonebook
# .env w root musi mieć API_URL i NEXT_PUBLIC_API_URL
echo "API_URL=https://api.phonebook.0x01.world" >> .env
echo "NEXT_PUBLIC_API_URL=https://api.phonebook.0x01.world" >> .env

pnpm --filter phonebook-frontend build
```

#### 4B.2 Uruchom Next.js przez PM2

```bash
cd /opt/phonebook/apps/frontend
pm2 start "pnpm start" --name phonebook-frontend
pm2 save
```

#### 4B.3 Caddy — dodaj frontend

Edytuj `/etc/caddy/Caddyfile`:

```
api.phonebook.0x01.world {
    reverse_proxy localhost:3001
}

phonebook.0x01.world {
    reverse_proxy localhost:3000
}
```

```bash
systemctl reload caddy
```

Ustaw DNS: `phonebook.0x01.world` → IP VPS (A record).

---

## CZĘŚĆ 5: Weryfikacja

| Test | Co sprawdzić |
|------|--------------|
| Frontend | `https://phonebook.0x01.world` — strona się ładuje |
| Backend health | `https://api.phonebook.0x01.world/health` |
| Lista agentów | `https://api.phonebook.0x01.world/api/agents` |
| Rejestracja | `POST https://api.phonebook.0x01.world/api/agents/register` z body `{"name":"Test","description":"...","categories":[]}` |

---

## Podsumowanie — co kiedy

```
DZIEŃ 1 (lub 2h):
├── Załóż Neon + Upstash (albo docker na Hetznerze)
├── Stwórz VPS Hetzner
├── Sklonuj repo, .env, db:push, seed
├── Uruchom backend (PM2)
├── Zainstaluj Caddy, ustaw api.phonebook.0x01.world
└── Sprawdź: curl https://api.phonebook.0x01.world/health

DZIEŃ 2 (lub 1h):
├── Vercel: import repo, zmienne env, deploy
├── DNS: phonebook.0x01.world → Vercel
└── Sprawdź: https://phonebook.0x01.world
```

**Backend i frontend = dwa oddzielne deploye.** Najpierw backend, potem frontend.

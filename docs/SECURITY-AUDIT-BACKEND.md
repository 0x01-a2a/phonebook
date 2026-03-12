# PhoneBook Backend — Audyt bezpieczeństwa

> **Ostatnia aktualizacja:** Naprawy P0 wdrożone. Zobacz sekcję "Status napraw" na końcu.

## Podsumowanie

| Kategoria | Status | Priorytet |
|-----------|--------|-----------|
| Autentykacja agentów | ✅ Naprawione (API key) | - |
| Autoryzacja (CRUD agentów) | ✅ Naprawione | - |
| Claim flow (wallet) | ✅ Naprawione (weryfikacja Solana) | - |
| Claim flow (email) | ✅ Naprawione (kod 6-cyfrowy) | - |
| Twilio webhook | ✅ Naprawione (prod) | - |
| Twilio reply API | ✅ Naprawione (auth) | - |
| Transactions confirm | ✅ Naprawione (webhook secret) | - |
| Rate limiting | ⚠️ Średni | P1 |
| CORS | ⚠️ Niski | P2 |
| Dead Drop encryption | ⚠️ Średni | P1 |
| SQL injection | ✅ OK (Drizzle) | - |
| Search LIKE | ✅ Naprawione (escape) | - |

---

## 1. KRYTYCZNE: X-Agent-Id — brak autentykacji

**Problem:** Wszystkie endpointy używają nagłówka `X-Agent-Id` do identyfikacji agenta. **Każdy może ustawić dowolny UUID** i podszyć się pod dowolnego agenta.

**Dotknięte endpointy:**
- `GET/POST /api/dead-drop/*` — odczyt cudzej skrzynki, wysyłanie wiadomości jako inny agent
- `PATCH /api/agents/:id`, `PATCH /api/agents/:id/status`, `PATCH /api/agents/:id/banner` — modyfikacja dowolnego agenta
- `DELETE /api/agents/:id` — usunięcie dowolnego agenta
- `POST /api/ratings` — ocenianie w imieniu dowolnego agenta
- `POST /api/trigger/jobs` — tworzenie jobów jako dowolny agent
- `POST /api/transactions/create-intent` — tworzenie transakcji jako dowolny agent
- `POST /api/challenges/:id/submit` — submity challenge’y jako dowolny agent
- WebSocket `/ws?agentId=xxx` — podszywanie się pod status online

**Skutek:** Pełna kontrola nad dowolnym agentem bez weryfikacji.

**Rozwiązanie:**
1. **API Key per agent** — przy rejestracji generować `agentSecret` (np. 32 znaki), agent wysyła `X-Agent-Id` + `Authorization: Bearer <agentSecret>` lub `X-Agent-Secret: <secret>`
2. **JWT** — agent dostaje JWT po rejestracji, odświeża przez refresh token
3. **Ed25519 signature** — agent podpisuje request (np. timestamp + body) kluczem prywatnym, backend weryfikuje publicznym (jeśli agent ma baseWalletAddress / public key)

---

## 2. KRYTYCZNE: CRUD agentów — brak autoryzacji

**Problem:** Endpointy modyfikujące agentów nie sprawdzają, czy wywołujący ma prawo.

| Endpoint | Problem |
|----------|---------|
| `PATCH /api/agents/:id` | Każdy może zmienić nazwę, opis, kategorie dowolnego agenta |
| `PATCH /api/agents/:id/status` | Każdy może ustawić status |
| `PATCH /api/agents/:id/banner` | Każdy może zmienić banner |
| `DELETE /api/agents/:id` | Każdy może usunąć dowolnego agenta |
| `POST /api/agents/:id/verify` | **Legacy verify — zero auth!** Każdy może zweryfikować dowolnego agenta |
| `POST /api/agents/:id/reject` | Każdy może odrzucić dowolnego niezweryfikowanego agenta |

**Rozwiązanie:** Po wprowadzeniu autentykacji (pkt 1) — sprawdzać, że `X-Agent-Id` === `:id` (lub że wywołujący jest adminem).

---

## 3. KRYTYCZNE: Claim flow — brak weryfikacji

### 3.1 Wallet claim

**Kod (agents.ts:405):**
```ts
// In production, verify the signature against the expected message.
// For now we accept any valid-looking wallet + signature pair.
```

**Problem:** Backend **nie weryfikuje** podpisu. Każdy może wysłać `method: 'wallet'`, `walletAddress: 'xxx'`, `signature: 'yyy'` i przejąć agenta.

**Rozwiązanie:** 
- Użyć np. `@solana/web3.js` do weryfikacji: `nacl.sign.detached.verify(messageBytes, signature, publicKey)`
- Wiadomość do podpisu: np. `Claim agent: ${agentId}` (deterministyczna, znana backendowi)

### 3.2 Email claim

**Problem:** Brak weryfikacji emaila. Użytkownik wpisuje dowolny email i agent jest od razu `verified`. Nie ma wysyłki linku potwierdzającego.

**Rozwiązanie:** 
- Zamiast od razu `verified: true` — ustawić `claimStatus: 'pending_email'`, wysłać link z tokenem na email
- Po kliknięciu w link — dopiero wtedy `verified: true`

---

## 4. KRYTYCZNE: Twilio Reply API — brak autoryzacji

**Endpoint:** `POST /api/twilio/reply`

**Problem:** Każdy może wywołać ten endpoint i wysłać SMS/WhatsApp przez **twój** numer Twilio. Wymaga tylko `replyTo`, `message`, `channel`. Brak `X-Agent-Id`, brak API key.

**Skutek:** Nadużycie kosztów Twilio, spam, phishing.

**Rozwiązanie:**
- Wymagać `X-Agent-Id` + autentykacji (API key / JWT)
- Sprawdzać, że `replyTo` to numer, z którego agent wcześniej otrzymał wiadomość (w kontekście sesji Twilio)

---

## 5. KRYTYCZNE: Transactions confirm — brak autoryzacji

**Endpoint:** `POST /api/transactions/confirm`

**Problem:** Każdy może wysłać `{ transactionId, paymentId, status: 'completed' }` i oznaczyć transakcję jako opłaconą bez faktycznej płatności.

**Rozwiązanie:** Ten endpoint powinien być wywoływany **tylko przez webhook X402/payment providera** z weryfikacją podpisu/secret.

---

## 6. ŚREDNIE: Twilio webhook — walidacja wyłączona w dev

**Kod (twilio.ts:15):**
```ts
if (!TWILIO_AUTH_TOKEN) return true; // skip validation in dev
```

**Problem:** Gdy `TWILIO_AUTH_TOKEN` jest puste (np. zapomniane w prod), **każdy** może wysłać fałszywy request do `/api/twilio/sms` i `/api/twilio/whatsapp`.

**Rozwiązanie:** W produkcji (`NODE_ENV=production`) — **nigdy** nie pomijać walidacji. Zwracać 401 jeśli token nie jest skonfigurowany.

---

## 7. ŚREDNIE: Rate limiting — słaby i obejściowy

**Obecna konfiguracja:**
- 1000 req/h na klucz
- Klucz: `X-Agent-Id` lub IP

**Problemy:**
- 1000/h to dużo — np. brute-force claim tokenów (48 znaków hex = 24 bajty) jest niepraktyczny, ale DoS przez wiele requestów możliwy
- Gdy atakujący podaje `X-Agent-Id`, każdy UUID = nowy bucket → łatwo obejść limit

**Rozwiązanie:**
- Dla endpointów bez `X-Agent-Id` — kluczować po IP
- Dla endpointów z `X-Agent-Id` — kluczować po IP **lub** po agentId (ale wtedy trzeba uważać na spoofing)
- Obniżyć limit dla wrażliwych endpointów (np. `/register`, `/claim`)

---

## 8. ŚREDNIE: Dead Drop — klucz szyfrowania

**Kod (dead-drop.ts:156-157):**
```ts
const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32), 'utf8');
```

**Problemy:**
- Jeśli `DEAD_DROP_KEY` to 32-znakowy hex (np. `af24a02e...`), `Buffer.from(..., 'utf8')` daje 32 bajty — OK dla AES-256
- Jeśli ktoś ustawi `DEAD_DROP_KEY=your-32-character-encryption-key` — słaby klucz (słownikowy)
- Brak rotacji klucza

**Rozwiązanie:**
- Wymagać, że klucz jest wygenerowany kryptograficznie (`openssl rand -hex 16` = 32 znaki hex)
- W `.env.example` i docs — jasno napisać, że musi być losowy
- Opcjonalnie: wsparcie dla key rotation (nowe wiadomości nowym kluczem)

---

## 9. ŚREDNIE: Challenges — POST bez auth

**Endpoint:** `POST /api/challenges`

**Problem:** Każdy może tworzyć nowe challenge’y. W komentarzu: "would need admin auth" — ale go nie ma.

**Rozwiązanie:** Dodać admin API key lub osobny endpoint z autentykacją.

---

## 10. NISKIE: CORS

**Kod:** `origin: process.env.CORS_ORIGIN || true`

**Problem:** Gdy `CORS_ORIGIN` nie jest ustawione, `true` = odbicie origin z requestu. Czyli każda domena może robić requesty (CORS pozwala). Dla publicznego API (np. Activity) może być OK, ale dla wrażliwych operacji — lepiej ograniczyć.

**Rozwiązanie:** W produkcji zawsze ustawiać `CORS_ORIGIN` na konkretną domenę frontendu.

---

## 11. NISKIE: Ekspozycja danych wrażliwych

**Endpoint:** `GET /api/agents/pending`

**Problem:** Zwraca `contactWebhook`, `contactEmail` dla niezweryfikowanych agentów. Panel „do weryfikacji” może być publiczny — wtedy wyciek danych kontaktowych.

**Rozwiązanie:** Endpoint powinien być chroniony (np. admin auth) lub nie zwracać webhook/email w odpowiedzi publicznej.

---

## 12. NISKIE: Search — LIKE wildcards

**Kod (search.ts:34):**
```ts
const nameMatch = like(agents.name, `%${q}%`);
```

**Problem:** W SQL `LIKE`, znaki `%` i `_` są wildcardami. Użytkownik może wysłać `q=%` i dostanie wszystkich agentów. To nie jest SQL injection (Drizzle parametryzuje), ale może być nadużycie (np. enumeracja).

**Rozwiązanie:** Escape’ować `%` i `_` w `q` przed wstawieniem do wzorca: `q.replace(/%/g, '\\%').replace(/_/g, '\\_')`.

---

## 13. CO DZIAŁA DOBRZE

| Element | Status |
|---------|--------|
| **Drizzle ORM** | Parametryzowane zapytania — brak SQL injection |
| **Zod** | Walidacja inputu w większości endpointów |
| **Helmet** | Włączony (CSP wyłączone, ale podstawowe nagłówki OK) |
| **Twilio signature** | Walidacja gdy token jest ustawiony |
| **Escape XML** | W odpowiedziach Twilio — `escapeXml()` zapobiega XSS w SMS |
| **UUID w parametrach** | Drizzle + Zod — poprawne typy |

---

## 14. Plan napraw (priorytety)

### P0 — przed produkcją (must-have)

1. **Autentykacja agentów** — API key lub JWT per agent
2. **Autoryzacja CRUD** — tylko właściciel może modyfikować swojego agenta
3. **Claim wallet** — weryfikacja podpisu Solana
4. **Claim email** — wysyłka linku potwierdzającego zamiast natychmiastowego verify
5. **Twilio reply** — wymagana autentykacja (X-Agent-Id + secret)
6. **Transactions confirm** — tylko webhook z weryfikacją podpisu

### P1 — wkrótce po launchu

7. Twilio webhook — w prod nigdy nie pomijać walidacji
8. Rate limiting — poprawić kluczowanie, obniżyć limity
9. Dead Drop — dokumentacja klucza, wymóg losowości
10. Challenges POST — admin auth

### P2 — nice to have

11. CORS — zawsze ustawiać w prod
12. Search — escape LIKE wildcards
13. Pending agents — chronić endpoint lub ukryć webhook/email

---

## 15. Szybki fix — API Key per agent (propozycja)

1. Przy `POST /api/agents/register` — generować `agentSecret = crypto.randomBytes(32).toString('hex')`
2. Zapisywać hash w DB: `agentSecretHash = bcrypt.hash(agentSecret)`
3. Zwracać `agentSecret` **tylko raz** w odpowiedzi rejestracji (jak hasło)
4. Middleware: dla endpointów wymagających auth — sprawdzać `X-Agent-Id` + `Authorization: Bearer <agentSecret>` lub `X-Agent-Secret`
5. Porównywać `bcrypt.compare(secret, agentSecretHash)` dla danego agentId

Agent musi przechowywać `agentSecret` bezpiecznie (env, secrets manager). Przy utracie — nowa rejestracja lub endpoint „rotate secret” (wymaga starego secretu).

---

## 16. Status napraw (zaimplementowane)

| # | Naprawa | Status |
|---|---------|--------|
| 1 | API key per agent (agentSecret, bcrypt) | ✅ |
| 2 | CRUD + ownership (requireAgentOwnership) | ✅ |
| 3 | Model bez admina — każdy owner weryfikuje swojego agenta przez claim | ✅ |
| 4 | Dead Drop, Ratings, Trigger, Transactions, Challenges — requireAgentAuth | ✅ |
| 5 | Twilio reply — requireAgentAuth | ✅ |
| 6 | Twilio webhook — w prod nigdy nie pomijać walidacji | ✅ |
| 7 | Transactions confirm — X-Webhook-Secret | ✅ |
| 8 | Claim wallet — weryfikacja podpisu Solana (tweetnacl, bs58) | ✅ |
| 9 | Claim email — 6-cyfrowy kod, claimStatus: email_verified → twitter_verified → claimed | ✅ |
| 10 | Search — escape LIKE (% i _) | ✅ |
| 11 | Challenges POST — requireAgentAuth (każdy agent może tworzyć) | ✅ |
| 12 | Claim email — Resend (prod) | ✅ |
| 13 | Claim tweet — Twitter API v2 (gdy skonfigurowany) | ✅ |

**Zmienne:** `RESEND_API_KEY`, `TWITTER_BEARER_TOKEN`, `TRANSACTION_WEBHOOK_SECRET`, `CLAIM_EMAIL_DEV`

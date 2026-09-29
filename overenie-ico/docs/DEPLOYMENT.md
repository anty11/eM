# Deploying to GitHub + Vercel and testing the hosted app

Step by step, from an empty GitHub repository to a tested production app. Plan about 45 minutes the first time.

---

## 0. Before you start

You need:

- a **GitHub** account with a **private** repository (e.g. `overenie-ico`);
- a **Vercel** account (private, not the company one) with GitHub connected;
- optionally: a **Finančná správa OpenData key** (free) and a **Claude or OpenAI API key**.

Check locally that the project builds (Node.js 20.9+):

```bash
cd overenie-ico
npm install
npm test          # 3 × "OK – …"
npm run build     # must end with the route list, no errors
```

---

## 1. Push the code to GitHub

```bash
cd overenie-ico
git init
git add .
git status        # check that .env.local, node_modules and .next are NOT listed
git commit -m "Preverenie partnera – prvá verzia"
git branch -M main
git remote add origin https://github.com/<your-account>/overenie-ico.git
git push -u origin main
```

> ⚠️ Never commit `.env.local` or any API key. `.gitignore` already excludes them. If a key ever ends up in Git, revoke it and create a new one.

---

## 2. Create the Vercel project

1. Go to vercel.com → **Add New… → Project** → import the `overenie-ico` repository.
2. **Framework Preset:** Next.js (detected automatically). Leave the Build and Output settings at their defaults.
3. **Don't deploy yet.** Click the arrow next to *Environment Variables* and first do steps 3 and 4. If it already deployed, that's fine, you'll redeploy later.

The region is set in `vercel.json` to **Frankfurt (fra1)**, close to the Slovak servers.

---

## 3. Create the database (Upstash Redis)

1. In the Vercel project: **Storage → Create Database → Upstash for Redis** (Marketplace).
2. Plan: **Free**. Region: **Frankfurt (eu-central-1)**.
3. **Connect** it to the project for all environments (Production, Preview, Development).
4. Vercel adds these variables automatically: `KV_REST_API_URL`, `KV_REST_API_TOKEN` (plus a few more `KV_*` / `REDIS_*` ones you can ignore).

> Without the database the app won't start in production (error "Chýba databáza"). That's intentional, so users can't disappear after a restart.

---

## 4. Environment variables

**Settings → Environment Variables**, environment **Production** (for Preview deployments set the same ones for *Preview* too):

### Required

| Variable | Example value | What it's for |
|---|---|---|
| `SESSION_SECRET` | 64 random characters | Signs login cookies and encrypts the AI key. Generate one with `openssl rand -hex 32`, or use a 40+ character password from a password generator. **If you change it, everyone is signed out.** |
| `ADMIN_EMAILS` | `antonin.cajka@publicis.no` | Email(s) of the first admin(s), comma-separated. |
| `ADMIN_SETUP_CODE` | `Prvy-Admin-2026-xyz` | One-time code for the first admin login (at least 8 characters). **Delete it after you sign in.** |
| `KV_REST_API_URL` | *(added by Upstash)* | Database |
| `KV_REST_API_TOKEN` | *(added by Upstash)* | Database |

### Recommended

| Variable | Value | What it's for |
|---|---|---|
| `FS_API_KEY` | key from Finančná správa | Tax debtors, VAT, tax reliability index, income tax. Register (free) at https://opendata.financnasprava.sk/page/openapi. Without it these checks become manual (or AI). |

### AI fallback (optional)

Set **only one** of the two keys.

| Variable | Value | What it's for |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-…` | Claude with web search + web fetch (recommended) |
| `OPENAI_API_KEY` | `sk-…` | OpenAI with web search |
| `AI_PROVIDER` | `anthropic` / `openai` | Only needed if both keys are set |
| `AI_MODEL` | empty | Empty = `claude-sonnet-5` / `gpt-5.5` |
| `AI_AUTO_FALLBACK` | *(don't set)* | Default OFF: AI runs only when you click **Overiť cez AI**. `1` = run automatically when a source fails (uses credit on every check) |
| `AI_NO_API_SOURCES` | *(don't set)* | Default OFF. `1` = AI automatically checks registers without an API on every check |

### Optional

| Variable | Value | What it's for |
|---|---|---|
| `APP_MODE` | `firma` | Default version for new users (`firma` or `advokat`) |
| `AI_ALLOW_ADMIN_KEY` | *(don't set)* | `1` = allow entering the AI key in Administrácia in production too. Not recommended; for production the key belongs here. |

> ❌ Do **not** set `DEMO_DATA` or `ALLOW_MEMORY_STORE` in production.

After adding or changing variables: **Deployments → the last deployment → ⋯ → Redeploy**. Variables only take effect in a new deployment.

---

## 5. Deploy and first sign-in

1. **Deploy** (or Redeploy). Wait for *Ready* (about 1–2 min).
2. Open the URL (e.g. `https://overenie-ico.vercel.app`). You should be redirected to **/login**.
3. Click **Prvé prihlásenie / nový kód**:
   - email = the one from `ADMIN_EMAILS`,
   - code = `ADMIN_SETUP_CODE`,
   - a new password (at least 10 characters) → **Nastaviť heslo a prihlásiť**.
4. You're in as admin. **Delete `ADMIN_SETUP_CODE` in Vercel and Redeploy.**

---

## 6. Test checklist

Go through the checks in order. Tick them off and note any that fail (screenshot + time).

### A. Infrastructure

| # | Step | Expected result |
|---|---|---|
| A1 | As admin open `https://<domain>/api/diag` | JSON: `"database": "ok"`, `"sessionSecretConfigured": true`, `"fsKeyConfigured": true` (if set) |
| A2 | In the same JSON, the `rpo, ruz, fs, socpoist, replik, rpvs, news` entries | each has `"status": 200` (or 3xx). `error` or 4xx/5xx = that source is unreachable from Vercel; note which one. |
| A3 | Sign out, then open `https://<domain>/api/check?ico=47244895` | `{"error":"Prihláste sa."}` (HTTP 401): the app is not public |

### B. Sign-in and users

| # | Step | Expected result |
|---|---|---|
| B1 | Administrácia → paste 2 test emails (one of yours, e.g. a Gmail) → role *používateľ*, version *Firma* → **Pridať** | Table with one-time codes |
| B2 | In a private browser window: /login → *Prvé prihlásenie* → test email + code + password | Signed in, no *Administrácia* in the menu |
| B3 | As the test user open `/admin` | Redirected to the home page |
| B4 | Sign out and sign in again with the wrong password 3× | "Nesprávny e-mail alebo heslo." |
| B5 | As admin: **Nový kód** for the test user | The test user is signed out on their next action; the old password no longer works |
| B6 | As admin: **Zablokovať** | The blocked user loses access immediately |
| B7 | Admin → change a user's version to *Advokát* → the user signs in again | After a check, the "Overte manuálne" window appears |

### C. Company checks (real registers)

| # | IČO | What to check |
|---|---|---|
| C1 | **47244895** (URBAN & PARTNERS) | Name, address Červeňova 15, directors. Prehľad: závierka za 2025 uložená 30. 6. 2026. Hospodárenie: tržby 979 872 €, vlastné imanie 923 155 €. |
| C2 | **35757442** (VOLKSWAGEN SLOVAKIA, a.s.) | a.s.: ownership shows the sole shareholder if the register lists one, otherwise "akcionári sa nezverejňujú". The statement is IFRS (PDF only), so there's a warning that the figures are in the PDF. |
| C3 | A company you know is a **debtor or in liquidation** (e.g. from the Sociálna poisťovňa list or Obchodný vestník) | Critical finding → **NEODPORÚČAME** |
| C4 | A non-existent IČO, e.g. **12345678** | "IČO nie je evidované" |
| C5 | For C1 and C2, check each card | No card stays *Zdroj nedostupný* (if one does, check A2) |
| C6 | Compare 2–3 values with the source (click **Overiť v zdroji ↗**) | They match orsr.sk / registeruz.sk / financnasprava.sk |
| C7 | Measure how long a check takes | Normally 10–40 s. The first check after a deploy can take longer (Sociálna poisťovňa list download). |

### D. Contact card, PDF, log

| # | Step | Expected result |
|---|---|---|
| D1 | On C1: tick *Komunikujeme*, fill in person, phone, email, tick yourself as responsible → **Uložiť kontakt** | "Uložené." When the name matches the director, you see the ✓ confirmation. |
| D2 | Log in as the other user and check the same IČO | The contact card shows the same data |
| D3 | **Uložiť PDF protokol** → save as PDF | PDF with header, scan number, time, who ran it, overview, contact and signature line |
| D4 | Administrácia → Protokol činností → *Preverenia*, then *Kontakty partnerov* | Records of every check and contact change; **Export CSV** opens in Excel |

### E. AI fallback (if the key is set)

| # | Step | Expected result |
|---|---|---|
| E1 | Administrácia → Nastavenia AI | "Aktívne · Claude · … · z premenných prostredia"; **Otestovať spojenie** → "Spojenie funguje" |
| E2 | Check C1 | "AI dohľadáva údaje…" appears, then VšZP / Union / Obchodný vestník / diskvalifikácie / ÚVO cards get the **Overené AI** label with links to official pages |
| E3 | Open the AI evidence links | They lead to the official register site; the quote matches |
| E4 | Temporarily delete `FS_API_KEY` → Redeploy → check C1 | Tax checks get filled in by AI (Overené AI). **Then add the key back.** |
| E5 | Administrácia → Protokol → *AI overenia* | Records with source, result and model |
| E6 | Watch the cost in the Anthropic / OpenAI console | Roughly a few tens of cents per check with AI |

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Chýba databáza" or 500 on sign-in | Upstash isn't connected to the project, or there was no Redeploy after connecting |
| "SESSION_SECRET musí mať aspoň 32 znakov" | Add `SESSION_SECRET` and Redeploy |
| First sign-in: "Neplatný alebo expirovaný kód" | The email isn't in `ADMIN_EMAILS` (check for typos and spaces), the code doesn't match, or the admin account already exists (then use normal sign-in) |
| A source always shows *Zdroj nedostupný* | `/api/diag` → does it return an error for that source? Some government servers block foreign or cloud IPs. The AI fallback helps; long term, consider a proxy with a Slovak IP. |
| Timeout (504) during a check | Vercel plan with a short function limit. The check needs up to 60 s and AI up to 120 s. With *Fluid compute* (default for new projects) this is fine; otherwise turn it on under Settings → Functions. |
| Tax checks are "Overiť manuálne" | `FS_API_KEY` is missing or invalid (`/api/diag`) |
| AI: "neplatný API kľúč" / "prekročený limit" | Check the key and the credit in the Anthropic / OpenAI console |
| AI keeps returning "Overte manuálne" | The AI couldn't find proof on the official site (a dynamic form it can't fill in). That's correct behaviour: it doesn't guess, so the check stays manual. |
| Everyone got signed out | `SESSION_SECRET` changed, or the 12-hour session expired |

Logs: Vercel → project → **Logs** (Runtime logs), filter by `/api/check` or `/api/ai/fallback`.

---

## 8. After testing

- [ ] `ADMIN_SETUP_CODE` deleted from Vercel
- [ ] Test users deleted in Administrácia
- [ ] Admin names filled in (they print on the PDF)
- [ ] (optional) custom domain: Settings → Domains
- [ ] (optional) Deployment Protection: Settings → Deployment Protection → *Vercel Authentication* for Preview deployments
- [ ] Documentation for the team: `README.md` (usage) and `docs/ZDROJE.md` (sources and rules)

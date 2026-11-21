# Margazhi Song Lists · Chennai December Season 2026

Rasikas share the song lists of concerts they attend in the Chennai December Season. A photo of handwritten notes is read by an AI handwriting reader, matched to the [karnatik.com](https://www.karnatik.com/lyrics.shtml) catalogue of 8,029 compositions, checked by the rasika, and stored. Lists from several rasikas at the same concert are combined by majority vote every night, building a season-level view: most-heard ragas, most-sung krithis, ragas chosen for the main piece, rare krithis heard only once, and ragas nobody sang.

Song lists and statistics are kept private: they are stored in Cloudflare and shown only through the site, never committed to this public repository. How the data may be shared after the Season is still to be decided.

## How the pieces fit

```
Rasika's phone ──> GitHub Pages site (site/) ──> Cloudflare Worker (worker/) ──> Anthropic vision API
                          ▲                             │
                          │                             ▼
                   season dashboard               D1 database (confirmed lists)
                          ▲                             │
                          └──── nightly GitHub Action: majority vote ──> results back into D1 (private)
```

| Folder | What it is |
|---|---|
| `site/` | The website (plain HTML/CSS/JS, no build step). Served by GitHub Pages. |
| `site/data/songs.json` | Karnatik catalogue with standardised raga, tala and composer names |
| `site/data/sabhas.json` | The 20 sabhas in the dropdown |
| `site/data/concerts.json` | Generated from `data/schedules/*.csv` |
| `build/` (not committed) | Nightly results; uploaded to the Worker by `scripts/publish.py` |
| `data/schedules/` | One CSV per sabha: the season schedule |
| `worker/` | Cloudflare Worker: handwriting reading, saving lists, rasika-added concerts, private export |
| `scripts/` | Schedule loader, schedule-from-image helper, majority vote, catalogue scrapers |

## One-time setup (about 30 minutes)

You need: this GitHub repo, a free Cloudflare account, an Anthropic API key, and Node.js on your computer.

### 1. Deploy the Worker

```bash
cd worker
npm install
npx wrangler login                                  # opens a browser to sign in to Cloudflare
npx wrangler d1 create cms2026                      # prints a database_id
#   paste that database_id into wrangler.toml
npx wrangler d1 execute cms2026 --remote --file schema.sql
npx wrangler secret put ANTHROPIC_API_KEY           # paste your key
npx wrangler secret put EXPORT_TOKEN                # paste a long random string, keep a copy
npx wrangler secret put IP_SALT                     # another long random string
npx wrangler deploy                                 # prints https://chennai-music-season-2026.<you>.workers.dev
```

Check it: open `https://chennai-music-season-2026.<you>.workers.dev/api/health`, which should show `{"ok":true}`.

### 2. Connect the site to the Worker

Edit `site/config.js` and set `API_BASE` to the Worker URL from step 1. Commit and push.

### 3. Turn on GitHub Pages

Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. The included workflow (`.github/workflows/pages.yml`) publishes the `site/` folder on every change and after each nightly vote. Run it once by hand from the Actions tab.

The site will be at `https://mahesh-iitm.github.io/chennai-music-season-2026/`. If you use a custom domain, add it to `ALLOWED_ORIGINS` in `worker/wrangler.toml` and redeploy.

### 4. Let the nightly vote read the lists

Repo **Settings → Secrets and variables → Actions → New repository secret**:

- `EXPORT_URL` = `https://chennai-music-season-2026.<you>.workers.dev/api/export`
- `EXPORT_TOKEN` = the same string you gave the Worker

The **Nightly majority vote** workflow runs at 02:10 IST, and you can run it any time from the Actions tab.

### 5. (Optional) Bot protection

Create a Cloudflare Turnstile widget for your Pages domain, put its site key in `site/config.js` (`TURNSTILE_SITEKEY`) and its secret in the Worker (`npx wrangler secret put TURNSTILE_SECRET`).

## Loading sabha schedules

Each sabha gets a CSV in `data/schedules/`, named by its id from `site/data/sabhas.json` (for example `music-academy.csv`). Copy `_TEMPLATE.csv`:

```
date,time,artist,accompanists,category,venue,notes
2026-12-15,16:00,Artist Name,"Violinist (violin), Mridangist (mridangam)",vocal,,
```

Time is 24-hour. Pushing a CSV triggers the workflow, which rebuilds `site/data/concerts.json`. To check locally: `python scripts/build_concerts.py`.

**From a published schedule image or PDF:**

```bash
export ANTHROPIC_API_KEY=...
python scripts/schedule_from_image.py music-academy schedule-page1.jpg schedule-page2.jpg
# check data/schedules/music-academy.draft.csv against the original, then rename it to music-academy.csv
```

Concerts that aren't in a schedule can be added by any rasika from the site. They show up immediately in the dropdown and are written into `site/data/added_concerts.json` each night. To remove a spam entry, set `hidden=1` on it in D1:

```bash
npx wrangler d1 execute cms2026 --remote --command "UPDATE added_concerts SET hidden=1 WHERE id='...'"
```

## Morning summary on WhatsApp and Telegram

The nightly vote also writes a digest of the previous day (stored in the Worker), shown on the site's **Daily** page. At 07:30 IST the **Morning summary** workflow sends it to WhatsApp subscribers and posts it to a Telegram channel. Each channel stays off until its secrets are set, and a day is never sent twice (`data/digest_sent.json`).

### Telegram (free, about 5 minutes)

1. In Telegram, message **@BotFather**, send `/newbot`, and follow the prompts. Copy the bot token it gives you.
2. Create a **public channel**, for example `@margazhisonglists`. Add your bot to the channel as an **administrator** with permission to post.
3. GitHub repo secrets: `TELEGRAM_BOT_TOKEN` = the token, `TELEGRAM_CHAT_ID` = `@margazhisonglists`.
4. In `site/config.js`, set `TELEGRAM_URL: "https://t.me/margazhisonglists"`.

### WhatsApp (Meta WhatsApp Cloud API)

Rasikas subscribe by tapping **Subscribe on WhatsApp** on the Daily page. WhatsApp opens with `JOIN` typed in, and sending it subscribes them (this also proves they own the number). `STOP` unsubscribes.

1. **Meta app.** At developers.facebook.com, create an app (type **Business**), add the **WhatsApp** product, and connect a Meta Business portfolio.
2. **Phone number.** Under WhatsApp → API Setup, add a phone number that is **not** already on WhatsApp or WhatsApp Business. Note its **Phone number ID**. Meta's free test number works for trials with up to 5 recipients.
3. **Permanent token.** In Business Settings, go to Users → System users → Add, assign the app and the WhatsApp account, and generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`.
4. **Message template.** Under WhatsApp Manager → Message templates, create one named `margazhi_daily`, language **English**. Meta will most likely class it as Marketing. Body:
   ```
   Margazhi Song Lists · {{1}}
   Yesterday: {{2}}
   Top ragas: {{3}}
   Main pieces: {{4}}
   Rare gem: {{5}}
   Today: {{6}}
   Full lists: https://mahesh-iitm.github.io/chennai-music-season-2026/#/daily
   Reply STOP to unsubscribe.
   ```
   Sample values for review: `Sun 20 Dec` · `8 concerts at 4 sabhas, 49 songs` · `Bhairavi (7), Todi (6), Kalyani (5)` · `T. M. Krishna: Todi; Sanjay Subrahmanyan: Kambhoji` · `Viriboni (Bhairavi) by A. S. Murali` · `12 concerts at 5 sabhas`. Approval usually takes minutes to a day.
5. **Cloudflare Worker secrets** (Settings → Variables and Secrets): `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_APP_SECRET` (Meta app → App settings → Basic), and `WHATSAPP_VERIFY_TOKEN` (any random string).
6. **Webhook.** In the Meta app's WhatsApp → Configuration page, set the Callback URL to `https://<your-worker>.workers.dev/api/whatsapp/webhook` and the Verify token to the same `WHATSAPP_VERIFY_TOKEN`. Click Verify, then subscribe to the **messages** field.
7. **GitHub repo secrets:** `WHATSAPP_TOKEN` and `WHATSAPP_PHONE_ID`. If your template name or language differ, add repo *variables* `WHATSAPP_TEMPLATE` / `WHATSAPP_LANG`.
8. In `site/config.js`, set `WHATSAPP_NUMBER` to the business number, digits only with the country code (e.g. `919876543210`).
9. **Test.** Send `JOIN` to the number from your phone; a welcome reply should arrive. Then run **Morning summary** from the Actions tab with *force* ticked.

**Cost.** Each delivered summary is a paid template message, about ₹0.86 per subscriber per day in India for marketing templates (Meta's rate card). The welcome and unsubscribe replies answer the rasika's own message and cost little or nothing.

## Keeping the data private

- Song lists, statistics and digests are never committed to this repository. The nightly job writes them to `build/` (ignored by git) and uploads them to the Worker, which stores them in D1.
- The site reads them one piece at a time from the Worker (`/api/data/...`), with `noindex, noai` headers.
- `site/robots.txt` and a `noai` meta tag ask AI crawlers not to collect the site. Only well-behaved crawlers obey these; stronger protection (Cloudflare's "Block AI bots", Turnstile, rate limits) needs the site on its own domain.

## How the vote works

- Each browser gets a random id. If a rasika shares again for the same concert, the new list replaces their old one, so nobody votes twice.
- Songs are matched by Karnatik song id. Songs not in the catalogue are matched by a transliteration-tolerant title key plus raga. RTP is matched by raga, and Tani Avartanam is matched by itself.
- A song is **agreed** when at least half of the rasikas at that concert listed it. Its position is the median of where rasikas put it.
- A concert is labelled "single report" (1 list), "two reports" (2) or "consensus" (3 or more). Songs listed by fewer than half are shown separately as "listed by fewer than half".
- Season statistics use agreed songs only.

## Costs and limits

- The Cloudflare Worker and D1 free tiers comfortably cover a season.
- Each photo read is one Anthropic API call, roughly ₹1 to ₹3 depending on the model and image size (photos are shrunk to 1600 px first).
- `OCR_DAILY_LIMIT` (default 400 photos a day) caps the total; `OCR_PER_IP_LIMIT` (15) caps each connection. Rasikas can always type a list by hand when the limit is hit.
- Photos are not stored. Only the confirmed list and the reader's raw transcription are kept.

## Running locally

```bash
cd worker && printf 'ANTHROPIC_API_KEY=sk-...\nEXPORT_TOKEN=dev\nIP_SALT=dev\nALLOWED_ORIGINS=\n' > .dev.vars
npx wrangler d1 execute cms2026 --local --file schema.sql
npx wrangler dev --port 8787
# in another terminal: set API_BASE to http://127.0.0.1:8787 in site/config.js, then
cd site && python3 -m http.server 8000
```

## Data and credits

- Song catalogue: [karnatik.com](https://www.karnatik.com/lyrics.shtml), scraped 19 Nov 2026 (`scripts/scrape_karnatik_*.py`). Raga, tala and composer spellings standardised by `scripts/standardise_karnatik.py` and `scripts/build_site_songs.py`. The site's original spellings are kept in `data/karnatik/`.
- Code: MIT licence. Rasika-contributed song lists are not released; terms for any release after the Season are to be decided.

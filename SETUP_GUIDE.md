# SENZO MD — Setup & Deploy Guide (Production)

SENZO MD is a **WhatsApp (Baileys MD) + Telegram** bot with a Telegram admin
panel, QR/pairing authentication, 120+ WhatsApp commands, JSON database,
referral/premium/ban systems, and Railway deployment configs.

> **v1.0.1 (production-hardened)** — this revision fixes the reconnect loop,
> removes hardcoded secrets, makes the database race-free and atomic, repairs
> broken commands (`.attp`, tic-tac-toe, `.join` alias collision, anti-link
> regex), and adds graceful Telegram-disabled mode. See **CHANGES** at the end.

---

## 1. Bot Details

| Item | Value |
|---|---|
| Owner | Senzo (@Senzo268) — 923021142153 |
| WhatsApp prefix | `.` (dot) — change via `PREFIX` env |
| Telegram bot | created via @BotFather (token → `TG_TOKEN` env) |
| Admin chat ID | your Telegram numeric ID → `ADMIN_CHAT_ID` env |
| Channel | https://www.whatsapp.com/channel/0029VbBdHQnKWEKtmxS7XZ09 |
| Hosting | Railway (configs ready: `railway.json`, `Procfile`, `start.sh`, `nixpacks.toml`) |
| Stack | Node.js ≥ 18, Baileys 6.7.24, node-telegram-bot-api |

## 2. Architecture Map

```
index.js                 → boot: Telegram → database init → WhatsApp connect
├── lib/config.js        → env config (dotenv) — NO secrets hardcoded
├── lib/database.js      → SINGLE writer of every JSON under database/ (atomic writes)
├── lib/pairing.js       → thin wrapper over db pairing-token API (compat)
├── lib/whatsapp.js      → Baileys socket, QR, pairing one-shot, reconnect, command dispatch
├── lib/telegram.js      → admin panel + user menu + /pair /code /broadcast (db-backed gates)
├── commands/*.js        → 128 unique WhatsApp commands (loaded into lib/whatsapp cmds map)
└── utils/               → styling, quotes, elites (download backups), attp (sticker)
```

Data files (all runtime, all git-ignored): `database/users.json`,
`premium.json`, `banned.json`, `groups.json`, `bot.json`, `media.json`,
`auto.json`, `pair_guard.json`, `pair_sent.json`, `auth/` (WhatsApp session),
`auth_pair/` (one-shot pairing sessions), `status_saves/`, `media/` (QR png…).

## 3. Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TG_TOKEN` | **Yes** for Telegram panel | — | Telegram bot token from @BotFather. **If empty → Telegram disabled, WhatsApp-only mode (no crash).** |
| `ADMIN_CHAT_ID` | Recommended | `8105949422` | Numeric chat ID that receives the admin panel |
| `OWNER_NUMBER` | Yes | `923021142153` | Bot owner's WhatsApp number (international, digits only) |
| `BOT_NAME` | No | `SENZO MD` | Bot display name |
| `PREFIX` | No | `.` | WhatsApp command prefix |
| `CHANNEL_URL` | No | owner channel | Shown in menus |
| `OWNER_HANDLE`, `OWNER_NAME`, `CHANNEL_HANDLE` | No | defaults | Cosmetic |

`.env.example` is committed — copy it to `.env` locally. **Never commit `.env`.**

### ⚠️ Telegram token security notice
Previous versions shipped a **real hardcoded Telegram token** in
`lib/config.js` (`process.env.TG_TOKEN || "8974494525:…"`). That token is now
public knowledge (this very repo). The hardcoded fallback is **removed** —
if you ever used that token, **rotate it immediately** in @BotFather
(/revoke) and use a fresh one via `TG_TOKEN`.

## 4. Local Run

```bash
git clone <your-repo> && cd senzo-md
npm install
cp .env.example .env        # fill TG_TOKEN + ADMIN_CHAT_ID
npm start                   # or: npm run dev (nodemon)
npm test                    # offline test suite (no real credentials needed)
```

First boot with no saved session: the bot prints a QR (also saved to
`media/qr.png` and pushable from the Telegram admin panel → **Pairing → Send QR**).
Preferred flow: Telegram → `/pair <number>` → 8-digit pairing code (see §6).

## 5. Railway Deploy (Production)

1. Push the repo to GitHub.
2. Railway → **New Project → Deploy from GitHub repo** → pick the repo.
3. Railway auto-detects `railway.json` (Nixpacks builder, `bash start.sh`).
   `nixpacks.toml` installs `ffmpeg`, `python3`, `pillow`, `yt-dlp`
   (and best-effort `sherlock-project`).
4. **Variables** tab → add `TG_TOKEN`, `ADMIN_CHAT_ID`, `OWNER_NUMBER`
   (and any optional vars from §3).
5. Deploy → open **Deployments → View logs** → you should see the banner,
   `Telegram bot loaded`, `✓ Loaded WhatsApp command modules`, and either
   `✓ WhatsApp VERIFIED connection as <number>` or a QR/pairing prompt.
6. Telegram mein bot ko `/start` karo → admin panel mil jayega.

Process notes:
- `start.sh` runs `npm ci` only when `node_modules` is missing, then
  `exec node index.js` (single process, Railway-managed restart policy).
- Reconnects are automatic (5s backoff, socket replaced properly).
- WhatsApp logout (from phone) clears the session and re-pairs on next start.
- No web port is opened — this is a worker process; no health-check endpoint
  is needed. Railway monitors the process itself.

## 6. Pairing (bina QR ke)

1. Telegram: `/pair 923XXXXXXXXXX`
2. WhatsApp app → **Settings → Linked Devices → Link a Device →
   “Link with phone number instead”** → apna number enter karein.
3. Phone screen par 8-digit code aata hai — bot ki `/pair` reply mein wohi
   code bhi aata hai (button **🔄 Check Status** se confirm karein).
4. Phone par code enter karein → connected ✓.
5. `/unpair` / `/status` — connection status. Logout phone se karein to
   session saaf ho jata hai aur dobara pair kar sakte hain.
6. Fallback: **Pairing → Send QR** — fresh QR Telegram par aata hai
   (kabhi stale file nahi bheji jati).

## 7. Telegram Admin Panel

| Section | Feature |
|---|---|
| Media Panel | Start pic/video + WA menu pic (admin uploads) |
| Pairing | Guide, pending pairs, fresh QR |
| WhatsApp Ctrl | settings, commands info |
| Broadcast | `/broadcast <msg>` → real chats (from in-memory store), 500 cap, 700ms throttle |
| Access & Premium | `/access free/paid`, `premium add/remove/check <num>` |
| Channels & Gate | `/addchannel`, `/removechannel`, `/channels`, `/tgate add/remove @channel`, `/forcejoin on/off` |
| Bans | `ban <num>`, `unban <num>` |
| Stats | WhatsApp/access/gates/media summary |
| Text commands | `/myid`, `/start`, `/pair`, `/code`, `/unpair`, `/status`, `/join <code>`, `/cancel`, `setting <key> <value>` |

## 8. WhatsApp Command Groups (128 unique)

`.menu` full list deta hai. Groups: downloaders (`.ytmp3/4`, `.tiktok`, `.igdl`,
`.fbdl`, `.twitter`, `.apk`…), AI (`.ai`, `.gemini`, `.dalle`), view-once
(`.vv`, `.vv2`), stickers (`.s`, `.sfull`, `.take`, `.attp`, `.emojimix`,
`.quote`), group arsenal (`.kick`, `.promote`, `.tagall`, `.antilink`,
`.channelwarn`, `.welcome` templates, warns…), economy/games (`.daily`,
`.slots`, `.tictactoe`…), islamic (`.azan`, `.quran`, `.hadith`…),
hacker/OSINT (`.sherlock`, `.metadata`, `.info`, `.whois`, `.gitclone`…),
boost (`.freacts`, `.fvotes`, `.referral`, `.join` — referral gate),
owner (`.broadcast`, `.premium`, `.ban`, `.mode`, `.restart`, `.block`,
`.joingc`, `.public`, `.private`…).

Access control: `ownerOnly` / `adminRequired` / `groupOnly` / `premiumOnly`
flags + paid-mode + per-chat `.public/.private` scope — sab `lib/whatsapp.js`
handle() mein check hote hain.

## 9. Security Measures

- No secrets in code; `TG_TOKEN` env-only; `.env` git-ignored.
- `.gitignore` covers: `.env*`, `database/*.json`, `database/auth/`,
  `database/auth_pair/`, `database/status_saves/`, `media/`, logs.
- DB writes are atomic (tmp + rename) and single-writer (races removed).
- Corrupted JSON files are backed up (`file.broken-<ts>`) — bot keeps running.
- Admin panel gated by chat ID + username checks; callback actor verified.
- No path traversal: all file IO uses `path.join` on fixed dirs; user input
  never becomes a filesystem path (gitclone/transcript/sherlock all sanitize).
- Unhandled rejections/exceptions are LOGGED (not swallowed), process stays up.
- Optional: paid mode, premium-only commands, referral-gated boost commands.

## 10. Testing (no credentials required)

| Test | What it verifies |
|---|---|
| `npm test` (`test_live.js`) | DB races + corruption backup, media flow, pairing tokens, all admin screens/sub-buttons, QR freshness, force-join gate, 237-entry command map, alias fixes, caption commands, tic-tac-toe, reconnect-source assertions |
| `node test_no_token.js` | Telegram gracefully disabled when TG_TOKEN missing |

**Not testable without real credentials** (honest list):
live WhatsApp connect/QR/pairing handshake (needs a phone + network to
WhatsApp servers), live Telegram API (needs an actual bot token), and the
external APIs used by downloaders — those need internet + provider uptime.

## 11. Troubleshooting

| Symptom | Fix |
|---|---|
| Telegram silent, no admin panel | `TG_TOKEN` set? Token valid? `/myid` se apni chat ID check karo |
| “QR abhi available nahi” | Bot disconnected ho — restart karo ya `/pair` use karo |
| Pairing: code not valid | Code 60s valid — jaldi enter karo; `/pair <number>` dobara bhejo |
| Bot messages na aayen | WhatsApp se Linked Devices check karo; logs mein `Connection closed` ka reason dekho |
| `.attp`/`.sticker` fail | ffmpeg missing — Railway nixpacks install karta hai; locally `apt-get install ffmpeg` |
| `.sherlock` fail | `pip3 install sherlock-project` server par |
| Broadcast: 0 chats | Store abhi khaali hai (naya connect) — thodi der baad try karo |

## 12. Changes in v1.0.1 (this hardened revision)

1. **SECURITY**: hardcoded Telegram token removed (rotate it!); `.gitignore`
   sealed; `.env.example` added.
2. **RECONNECT FIX**: WhatsApp ab true reconnect karta hai (dead-socket bug
   tha); single `connection.update` listener; `connecting` guard.
3. **DB**: single-writer module; atomic writes; corrupt-file backup; pair
   tokens + tg gates moved out of 3-module races; `premiumList`/`bannedList`/
   `members` APIs added.
4. **Telegram**: WhatsApp-only mode when token missing; `/code` accepts real
   alphanumeric 8-char codes; `/broadcast` uses the real chat store; gates db-backed.
5. **Commands fixed**: `.attp` (ReferenceError), tic-tac-toe (turn/winner
   logic), `.join` alias collision, anti-link stateful-regex bug,
   `/home/ubuntu` hardcoded paths, `.gitclone`/`.transcript`/`.sherlock` tmp cleanup,
   dead code removed.
6. **index.js**: real error logging (was silent no-ops), safe ffmpeg check.
7. **package.json**: 7 unused deps removed (`cheerio`, `moment-timezone`,
   `node-cron`, `yt-dlp-wrap`, `qrcode-terminal`, `file-type`,
   `fs-extra`), lockfile regenerated; `npm test` script added.
8. **Deploy**: hardened `start.sh` (exec, npm ci fallback), resilient
   `nixpacks.toml` (pillow added, build never fails on optional tools).

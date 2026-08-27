/**
 * SENZO MD — WhatsApp Core (Baileys)
 *
 * ── UNIFIED PAIRING DESIGN (v1.0.2 — root-cause fix for duplicate codes) ──
 * Old design (BROKEN): /pair spawned a throwaway "one-shot" socket with its own
 * identity in database/auth_pair, requested a code, delivered it, then DESTROYED
 * that session 2s later. The code was real but the paired session was thrown
 * away — the bot's real socket (database/auth) never got authenticated, kept
 * showing a QR, and every /pair produced yet another throwaway identity + code.
 * Two code paths (the /pair handler AND handlePendingPairs on the main socket's
 * "open") could each trigger a generation with no single-flight protection.
 *
 * New design: ONE identity, ONE socket, ONE auth dir (database/auth).
 *  - requestPairingCode() is called ON THE MAIN SOCKET while it is unregistered.
 *    When the phone completes the "Link with phone number" flow, the MAIN
 *    socket becomes the linked device and its session persists in database/auth
 *    via creds.update → saveCreds. Restart → still connected. No throwaway.
 *  - Single-flight: an in-process flag + a cross-process O_EXCL lockfile ensure
 *    only ONE requestPairingCode() runs at a time — a second bot instance
 *    (duplicate Railway deploy) cannot generate a second code.
 *  - Code reuse: if a valid (unexpired) code already exists for a number, the
 *    SAME code is re-delivered — never a second, different code.
 *  - Reconnect: a registered socket emits "open", never "qr" → pending pairing
 *    entries are not re-processed → no new code after reconnect.
 *  - On "open" (pairing completed): codes/pending entries for the connected
 *    number are cleared and the socket continues as a normal authenticated bot.
 */
const fs = require("fs");
const path = require("path");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcode = require("qrcode");
const chalk = require("chalk");
const { PREFIX, OWNER_NUMBER } = require("./config");
const db = require("./database");

const AUTH_DIR = path.join(__dirname, "..", "database", "auth");
const MEDIA_DIR = path.join(__dirname, "..", "media");
const cmds = {};
let currentSock = null;
let connecting = false;
let reconnectTimer = null;

// ── Latest QR cache (fresh QR har request pr bhejne ke liye) ──
let latestQRDataUrl = null; // data:image/png;base64,...
const QR_OPTS = { margin: 1, scale: 8, errorCorrectionLevel: "M" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normalizeNum = (n) => String(n || "").replace(/[^0-9]/g, "");

// ═══════════════════════════════════════════════════════════════════
// PAIRING (unified, single-flight)
// ═══════════════════════════════════════════════════════════════════

let pairingInFlight = false; // in-process single-flight

/** Socket "ready" for a pairing request = WhatsApp TCP/WS connection is open. */
function socketConnected(sock) {
  return !!(sock && sock.ws && (sock.ws.readyState === 1 || sock.ws.readyState === "open"));
}

/** Wait (max `ms`) until the main socket has an open WS connection to WhatsApp. */
async function waitSockConnected(sock, ms = 12000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (socketConnected(sock)) return true;
    if (!sock) return false;
    await sleep(500);
  }
  return socketConnected(sock);
}

// runPairingOnDemand — the ONLY entry point that generates a pairing code.
// Guarantees:
//   1. Never while the account is already authenticated ("open").
//   2. Never a second code while a valid code exists — the SAME code is resent.
//   3. Never two concurrent requestPairingCode() calls (in-process + file lock).
async function runPairingOnDemand(number, token, chatId, eventBus, sockOverride) {
  const num = normalizeNum(number);
  if (!num || num.length < 10) {
    console.log(chalk.red(`[PAIR] invalid number: ${number}`));
    return;
  }
  const sock = sockOverride || currentSock;

  // Already authenticated as this number → nothing to pair
  if (sock && sock.user?.id) {
    const me = sock.user.id.split(":")[0];
    if (me === num) {
      console.log(chalk.yellow(`[PAIR] ${num} already connected — no code generated`));
      if (eventBus) eventBus.emit("pair_status", { number: num, chatId, type: "already" });
      return;
    }
    console.log(chalk.yellow(`[PAIR] bot already connected as ${me} — can't pair a second number`));
    if (eventBus) eventBus.emit("pair_status", { number: num, chatId, type: "connected_other", as: me });
    return;
  }

  // Reuse a valid unexpired code — NEVER generate a second different one
  const existing = db.getPairCode(num);
  if (existing) {
    console.log(chalk.green(`[PAIR] re-delivering existing code for ${num} (no new generation)`));
    if (eventBus) eventBus.emit("pair_ready", { number: num, token, chatId });
    return;
  }

  // Single-flight: one pairing request at a time, in-process AND across processes
  if (pairingInFlight) {
    console.log(chalk.yellow(`[PAIR] pairing already in flight — ${num} request ignored`));
    return;
  }
  if (!db.acquirePairLock()) {
    console.log(chalk.yellow(`[PAIR] another bot instance is pairing — ${num} request ignored`));
    return;
  }
  pairingInFlight = true;
  try {
    if (!sock) {
      // Socket not up yet (fresh boot) — the pending-list processor will pick
      // this up on the first "qr" event. No code is generated here.
      console.log(chalk.yellow(`[PAIR] socket not ready yet — pending entry saved for ${num}`));
      return;
    }
    const connected = await waitSockConnected(sock);
    if (!connected) {
      console.log(chalk.red(`[PAIR] socket not connected — cannot request code for ${num}`));
      return;
    }

    let raw = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 2 && !raw; attempt++) {
      try {
        raw = await sock.requestPairingCode(num);
      } catch (e) {
        lastErr = e;
        console.log(chalk.red(`[PAIR req] ${num} attempt ${attempt + 1}: ${e.message}`));
        await sleep(2500);
      }
    }
    if (!raw) {
      console.log(chalk.red(`[PAIR NOCODE] ${num}: ${lastErr ? lastErr.message : "empty response"}`));
      return;
    }
    const clean = String(raw).replace(/[^A-Za-z0-9]/g, "");
    if (!clean) {
      console.log(chalk.red(`[PAIR NOCODE] ${num}: unparseable response`));
      return;
    }
    const code = clean.length > 4 ? clean.match(/.{1,4}/g).join("-") : clean;
    db.addPairCode(num, code);
    console.log(chalk.green(`[PAIR CODE] ${num}: ${code} (real WhatsApp server code)`));
    if (eventBus) eventBus.emit("pair_ready", { number: num, token, chatId });
  } catch (e) {
    console.log(chalk.red(`[PAIR ERR] ${num}: ${e.message}`));
  } finally {
    pairingInFlight = false;
    db.releasePairLock();
  }
}

// Pending-list processor — runs on the FIRST "qr" (fresh unregistered boot) and
// on "open" (usually a no-op: a connected account never gets a code).
// Every entry is removed before processing; runPairingOnDemand's single-flight
// guarantees a second call can never produce a second code.
async function handlePendingPairs(sock, eventBus) {
  try {
    const pending = db.listPendingPairs();
    for (const p of pending) {
      const pn = normalizeNum(p.number);
      db.removePendingByNumber(p.number);
      if (!pn) continue;
      await runPairingOnDemand(pn, p.token, p.chatId, eventBus, sock);
    }
  } catch (e) {
    console.log(chalk.red(`[PAIR PENDING ERR] ${e.message}`));
  }
}

async function renderQR(dataStr) {
  return await qrcode.toDataURL(dataStr, QR_OPTS);
}

function getLatestQRBuffer() {
  if (!latestQRDataUrl) return null;
  return Buffer.from(latestQRDataUrl.split(",")[1], "base64");
}

// ── Minimal in-memory chat/message store ──
class MiniStore {
  constructor() {
    this.chats = new Map();
    this.messages = new Map();
  }
  all() {
    return [...this.chats.values()];
  }
  loadMessage(remoteJid, id) {
    return this.messages.get(`${remoteJid}:${id}`) || null;
  }
  bind(ev) {
    ev.on("chats.upsert", ({ chats }) => {
      for (const c of chats || []) this.chats.set(c.id, c);
    });
    ev.on("contacts.upsert", ({ contacts }) => {
      for (const c of contacts || []) this.chats.set(c.id, this.chats.get(c.id) || { id: c.id });
    });
    ev.on("messages.upsert", ({ messages }) => {
      for (const m of messages || []) {
        if (!m.key || !m.key.id) continue;
        this.messages.set(`${m.key.remoteJid}:${m.key.id}`, m);
        if (m.key.remoteJid) this.chats.set(m.key.remoteJid, this.chats.get(m.key.remoteJid) || { id: m.key.remoteJid });
      }
    });
  }
}

async function loadCommands() {
  const dir = path.join(__dirname, "..", "commands");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
  for (const f of files) {
    try {
      const mod = require(path.join(dir, f));
      const list = Array.isArray(mod) ? mod : [mod];
      for (const item of list) {
        if (item && item.name && item.execute) {
          cmds[item.name] = item;
          (item.aliases || []).forEach((a) => { cmds[a] = item; });
        }
      }
    } catch (err) {
      console.log(chalk.red(`[CMD FAIL] ${f}: ${err.message}`));
    }
  }
  console.log(chalk.green(`✓ Loaded WhatsApp command modules (${Object.values(cmds).filter((c, i, a) => a.indexOf(c) === i).length} unique commands)`));
}

async function connectWA(eventBus) {
  // Single-flight: exactly ONE socket at a time; a second call returns the live socket.
  if (connecting) return currentSock;
  connecting = true;
  try {
    await loadCommands();
    if (currentSock) return currentSock;

    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    fs.mkdirSync(AUTH_DIR, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const store = new MiniStore();

    const sock = makeWASocket({
      printQRInTerminal: false,
      auth: state,
      logger: pino({ level: "silent" }),
      browser: ["SENZO MD", "Chrome", "1.0.0"],
      syncFullHistory: false,
      markOnlineOnConnect: true,
      getMessage: async (key) => store.loadMessage(key.remoteJid, key.id)?.message || null,
    });
    sock.store = store;
    store.bind(sock.ev);
    currentSock = sock;

    sock.ev.on("creds.update", saveCreds);

    // ── SINGLE connection.update listener (QR / close / open) ──
    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrB64 = await renderQR(qr);
          latestQRDataUrl = qrB64;
          try {
            fs.writeFileSync(path.join(MEDIA_DIR, "qr.png"), qrB64.split(",")[1], "base64");
          } catch {}
          console.log(chalk.yellow("📱 New QR code saved (media/qr.png)"));
          if (eventBus) eventBus.emit("qr", qrB64);
        } catch (e) {
          console.log(chalk.red(`[QR RENDER ERR] ${e.message}`));
        }
        // Unregistered socket is ready → process any pending /pair requests now
        await handlePendingPairs(sock, eventBus);
        return;
      }

      if (connection === "close") {
        if (currentSock !== sock) return; // old socket after a reconnect
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log(chalk.red(`Connection closed: ${lastDisconnect?.error?.message || lastDisconnect?.error || code}`));
        currentSock = null;

        if (code === DisconnectReason.loggedOut) {
          try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
          const loggedNumber = sock.user?.id?.split(":")[0] || "";
          try { if (loggedNumber) db.removePairCode(loggedNumber); } catch {}
          for (const n of [loggedNumber, OWNER_NUMBER]) {
            if (n) db.removePendingByNumber(n);
          }
          console.log(chalk.red("Logged out — auth cleared, fresh pairing/QR possible"));
          if (eventBus) eventBus.emit("wa_logged_out");
        }
        scheduleReconnect(eventBus);
        return;
      }

      if (connection === "open") {
        const who = sock.user?.id?.split(":")[0] || "unknown";
        console.log(chalk.green(`✓ WhatsApp VERIFIED connection as ${who}`));
        if (eventBus) eventBus.emit("wa_connected", sock);

        // Pairing completed (or legacy QR session connected) → clean pairing state
        try {
          db.removePairCode(who);
          db.removePendingByNumber(who);
        } catch {}

        // Auto-join configured channels on fresh connection
        try {
          const channels = db.listAutoChannels();
          for (const ch of channels) {
            try {
              if (ch.endsWith("@newsletter")) {
                if (typeof sock.newsletterFollow !== "function") {
                  console.log(chalk.yellow(`[AUTO-JOIN SKIP] NewsletterFollow unavailable: ${ch}`));
                  continue;
                }
                await sock.newsletterFollow(ch);
                console.log(chalk.green(`[AUTO-JOIN] Newsletter ${ch}`));
              } else {
                await sock.groupAcceptInvite(ch).catch(async () => {
                  await sock.groupAcceptInviteV4?.(ch).catch(() => {});
                });
                console.log(chalk.green(`[AUTO-JOIN] Group/Channel ${ch}`));
              }
            } catch (e) {
              console.log(chalk.red(`[AUTO-JOIN ERR] ${ch}: ${e.message}`));
            }
          }
        } catch {}

        // Force-join gate check (owner DM alert when account not subscribed)
        try {
          if (db.getForceJoin() && eventBus) {
            const channels = db.listAutoChannels();
            if (channels.length > 0 && sock.newsletterSubscribers) {
              const lid = channels[0].split("@")[0] + "@lid";
              sock.newsletterSubscribers(lid).then((r) => {
                const me = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
                const subs = (r?.subscribers || []).map((s) => s.id);
                eventBus.emit("forcejoin_check", { joined: subs.includes(me), channel: channels[0] });
              }).catch(() => eventBus.emit("forcejoin_check", { joined: false, channel: channels[0] }));
            }
          }
        } catch {}

        // Registered socket → pending pairing entries are cleared, not processed
        await handlePendingPairs(sock, eventBus);
      }
    });

    // ── Incoming messages ──
    sock.ev.on("messages.upsert", async ({ messages }) => {
      for (const raw of messages) {
        if (raw.key.fromMe) continue;
        try {
          try {
            const au = require("../commands/auto");
            if (au.watch) await au.watch(sock, raw, store);
          } catch {}
          if (!raw.message) continue;

          try {
            const btn = raw.message?.buttonsResponseMessage?.selectedButtonId ||
              raw.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
              raw.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.id;
            if (btn) {
              const btnStr = typeof btn === "string" ? btn : String(btn);
              if (btnStr.startsWith("__eliteyt_mp3 ") || btnStr.startsWith("__eliteyt_mp4 ")) {
                const [tag, url] = btnStr.split(" ");
                const fmt = tag.split("_").pop();
                const elites = require("../utils/elites");
                const fromBtn = raw.key.remoteJid;
                await sock.sendMessage(fromBtn, { text: `⬇️ Downloading (${fmt.toUpperCase()})...` }, { quoted: raw });
                const d = await elites.eliteYtDownload(url, fmt);
                if (fmt === "mp3") await sock.sendMessage(fromBtn, { audio: d.buffer, mimetype: "audio/mpeg" }, { quoted: raw });
                else await sock.sendMessage(fromBtn, { video: d.buffer, caption: `🎬 ${d.title}` }, { quoted: raw });
                continue;
              }
            }
          } catch {}

          await handle(sock, raw, store);
        } catch (e) {
          console.log(chalk.red(`[MSG ERR] ${e.message}`));
        }
      }
    });

    // ── Group participant changes (welcome/goodbye) ──
    sock.ev.on("group-participants.update", async (data) => {
      try {
        const g = require("../commands/group");
        if (g.welcomeWatcher) await g.welcomeWatcher(sock, data);
        if (eventBus) eventBus.emit("group_update", data);
      } catch (e) {
        console.log(chalk.red(`[GRP WATCH ERR] ${e.message}`));
      }
    });

    return sock;
  } finally {
    connecting = false;
  }
}

function scheduleReconnect(eventBus) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWA(eventBus).catch((e) => console.log(chalk.red(`[RECONNECT ERR] ${e.message}`)));
  }, 5000);
}

function getSock() {
  return currentSock;
}

// ── Message parsing helpers ──
function unwrapMessage(m) {
  let cur = m;
  try {
    for (let i = 0; i < 3; i++) {
      if (cur.viewOnceMessage?.message) cur = cur.viewOnceMessage.message;
      else if (cur.ephemeralMessage?.message) cur = cur.ephemeralMessage.message;
      else if (cur.documentWithCaptionMessage?.message) cur = cur.documentWithCaptionMessage.message;
      else break;
    }
  } catch {}
  return cur;
}

function extractBody(m) {
  const type = Object.keys(m)[0];
  if (!type) return { type: null, body: "" };
  const node = m[type];
  if (type === "conversation") return { type, body: node || "" };
  if (type === "extendedTextMessage") return { type, body: node?.text || "" };
  const captions = {
    imageMessage: node?.caption,
    videoMessage: node?.caption,
    documentMessage: node?.caption,
    audioMessage: node?.caption,
  };
  return { type, body: captions[type] || "" };
}

async function handle(sock, msg, store) {
  const unwrapped = unwrapMessage(msg.message);
  const { type, body } = extractBody(unwrapped);
  msg.messageType = type || msg.messageType;

  const from = msg.key.remoteJid;
  const sender = msg.key.participant || from;
  const isGroup = from.endsWith("@g.us");
  const isOwner =
    sender === `${OWNER_NUMBER}@s.whatsapp.net` ||
    from === `${OWNER_NUMBER}@s.whatsapp.net`;

  if (db.isBanned(sender)) return;

  const reply = async (t, options = {}) => {
    await sock.sendMessage(from, { text: t, ...options }, { quoted: msg });
  };

  const accessMode = db.getAccessMode();
  if (accessMode === "paid" && !isOwner) {
    return reply("💳 *PAID BOT*\n\nYeh bot abhi *PAID MODE* mein hai.\nAccess lene ke liye owner se contact karein:\n👑 @" + "Senzo268" + "\n📱 " + OWNER_NUMBER);
  }

  if (isGroup) {
    const grpScope = db.getUserScope(from);
    if (grpScope === "private" && !isOwner) return;
  }

  // Watchers run on EVERY message (commands + plain text)
  if (!body.startsWith(PREFIX)) {
    try {
      const g = require("../commands/group");
      if (g.antiLinkWatch) await g.antiLinkWatch(sock, msg, store, { from, sender, isGroup, isOwner, body });
      if (g.channelLinkWatch) await g.channelLinkWatch(sock, msg, store, { from, sender, isGroup, isOwner, body });
      const sp = require("../commands/antispam");
      if (sp.badwordsWatch) await sp.badwordsWatch(sock, msg, { from, sender, isGroup, isOwner, body });
      if (sp.floodWatch) await sp.floodWatch(sock, msg, { from, sender, isGroup, isOwner, body });
      const gm = require("../commands/games");
      if (gm.handleXOMove) await gm.handleXOMove(sock, msg, { body, from, sender, isGroup });
    } catch {}
    return;
  }

  if (!body) return;
  const [rawCmd, ...rest] = body.slice(PREFIX.length).trim().split(/\s+/);
  const text = rest.join(" ");
  const cmd = rawCmd.toLowerCase();

  const sendImage = async (buffer, caption) =>
    await sock.sendMessage(from, { image: buffer, caption: caption || "" }, { quoted: msg });
  const sendVideo = async (buffer, caption) =>
    await sock.sendMessage(from, { video: buffer, caption: caption || "" }, { quoted: msg });
  const sendAudio = async (buffer) =>
    await sock.sendMessage(from, { audio: buffer, mimetype: "audio/mpeg" }, { quoted: msg });
  const sendSticker = async (buffer) =>
    await sock.sendMessage(from, { sticker: buffer }, { quoted: msg });
  const sendDocument = async (buffer, fileName, caption, mime) =>
    await sock.sendMessage(from, { document: buffer, fileName, caption: caption || "", mimetype: mime || "application/octet-stream" }, { quoted: msg });
  const sendToOwner = async (content) =>
    await sock.sendMessage(`${OWNER_NUMBER}@s.whatsapp.net`, content);

  const c = cmds[cmd];
  if (!c) return;

  db.getUser(sender);

  const uScope = db.getUserScope(sender);
  if (uScope === "private" && !isOwner) return;

  if (c.ownerOnly && !isOwner) return reply("*Yeh command sirf Owner ke liye hai!* 🔒");
  if (c.groupOnly && !isGroup) return reply("*Yeh command sirf groups ke liye hai!*");
  if (c.premiumOnly && !db.isPremium(sender) && !isOwner)
    return reply("*Yeh command Premium users ke liye hai.* Premium lene ke liye owner se contact karein.");
  if (c.adminRequired) {
    if (!isGroup) return reply("*Yeh command sirf groups ke liye hai!*");
    const meta = await sock.groupMetadata(from).catch(() => null);
    if (!meta) return;
    const isAdmin = meta.participants.find((p) => p.id === sender)?.admin;
    if (!isAdmin && !isOwner) return reply("*Yeh command sirf Group Admins ke liye hai!*");
  }

  await c.execute(sock, msg, store, {
    from, sender, isGroup, isOwner, body, args: text, reply,
    sendImage, sendVideo, sendAudio, sendSticker, sendDocument, sendToOwner,
    getGroupMeta: () => sock.groupMetadata(from),
  });
}

module.exports = {
  connectWA, loadCommands, cmds, handle, getSock, getLatestQRBuffer,
  handlePendingPairs, runPairingOnDemand,
};

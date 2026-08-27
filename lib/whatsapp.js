/**
 * SENZO MD — WhatsApp Core (Baileys)
 *
 * Major fixes in this revision:
 *  - RECONNECT: the old `connectWA` returned the dead socket when a disconnect
 *    happened, so the bot could never actually reconnect. `currentSock` is now
 *    cleared before every reconnect and a `connecting` guard prevents two
 *    sockets racing.
 *  - SINGLE connection.update listener (was two stacked handlers).
 *  - Minimal in-memory chat/message store so Telegram /broadcast has real chat
 *    targets (Baileys 6.7.x does not export makeInMemoryStore).
 *  - Caption commands: media messages with a caption are now parsed too.
 *  - media/qr.png write is guarded with mkdir (no crash when media/ is missing).
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

// ═══════════════════════════════════════════════════════════════════
// PAIRING — single-source-of-truth design (see original comments)
// Rules: 1 code request per number (persisted guard), one entry point
// (runPairingOnDemand), ephemeral one-shot socket only.
// ═══════════════════════════════════════════════════════════════════
const PAIR_DIR = path.join(__dirname, "..", "database", "auth_pair");
const PAIR_GUARD = {};
const PAIR_GUARD_PATH = path.join(__dirname, "..", "database", "pair_guard.json");
const PAIR_SENT_PATH = path.join(__dirname, "..", "database", "pair_sent.json");
const PAIR_SENT_TTL_MS = 15 * 60 * 1000;
const PAIR_SENT = {};

function loadPairSent() {
  try {
    const j = JSON.parse(fs.readFileSync(PAIR_SENT_PATH, "utf8"));
    if (j && typeof j === "object") Object.assign(PAIR_SENT, j);
  } catch {}
}
function savePairSent() {
  try { fs.writeFileSync(PAIR_SENT_PATH, JSON.stringify(PAIR_SENT, null, 2)); } catch {}
}
function markPairSent(number) {
  PAIR_SENT[number] = Date.now();
  savePairSent();
}
function wasPairCodeDelivered(number) {
  const t = PAIR_SENT[number];
  if (!t) return false;
  if (Date.now() - t > PAIR_SENT_TTL_MS) { delete PAIR_SENT[number]; savePairSent(); return false; }
  return true;
}
function clearPairSent(number) {
  const num = String(number || "").replace(/[^0-9]/g, "");
  if (num && PAIR_SENT[num]) { delete PAIR_SENT[num]; savePairSent(); }
}
loadPairSent();

function loadPairGuard() {
  try {
    const j = JSON.parse(fs.readFileSync(PAIR_GUARD_PATH, "utf8"));
    if (j && typeof j === "object") Object.assign(PAIR_GUARD, j);
  } catch {}
}
function savePairGuard() {
  try {
    fs.writeFileSync(PAIR_GUARD_PATH, JSON.stringify(PAIR_GUARD, null, 2));
  } catch (e) {
    console.log(chalk.red(`[SAVEG ERR] ${e.message}`));
  }
}
loadPairGuard();

// Guard RESET — zaroori hai taake user dobara pair kar sake (logged-out / /unpair)
function clearPairGuard(number) {
  const num = String(number || "").replace(/[^0-9]/g, "");
  if (num && PAIR_GUARD[num]) {
    delete PAIR_GUARD[num];
    savePairGuard();
    clearPairSent(num);
    console.log(chalk.yellow(`[PAIR GUARD RESET] ${num}`));
    return true;
  }
  return false;
}

// runPairingOnDemand — the ONLY entry point for pairing code requests.
async function runPairingOnDemand(number, token, chatId, eventBus) {
  const num = String(number || "").replace(/[^0-9]/g, "");
  if (!num || num.length < 10) {
    console.log(chalk.red(`[PAIR] invalid number: ${number}`));
    return;
  }
  if (PAIR_GUARD[num]) {
    console.log(chalk.yellow(`[PAIR] duplicate ignored for ${num} (already requested)`));
    return;
  }
  PAIR_GUARD[num] = true;
  savePairGuard();
  try {
    const pairing = require("./pairing");
    pairing.removePendingByNumber(num);
  } catch {}
  try {
    await requestPairCodeOneshot(num, token, chatId, eventBus);
  } catch (e) {
    console.log(chalk.red(`[PAIR ERR] ${num}: ${e.message}`));
  }
}

// Ephemeral one-shot socket — fresh auth session + fresh identity, code milte hi band.
async function requestPairCodeOneshot(number, token, chatId, eventBus) {
  const num = String(number).replace(/[^0-9]/g, "");
  if (!num) return;
  const sessionPath = path.join(PAIR_DIR, `${num}_${Date.now()}`);
  let resolved = false;
  const cleanup = () => {
    try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch {}
  };
  try {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();
    const pairSock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
      },
      printQRInTerminal: false,
      logger: pino({ level: "silent" }),
      browser: Browsers.windows("Chrome"),
      markOnlineOnConnect: false,
      connectTimeoutMs: 30000,
      defaultQueryTimeoutMs: 30000,
      qrTimeout: 60000,
      keepAliveIntervalMs: 30000,
      emitOwnEvents: true,
      fireInitQueries: true,
    });
    let code = null;
    // done() — SINGLE emission point (guard resets resolved so it runs once).
    const done = (why) => {
      if (resolved) return;
      resolved = true;
      try { pairSock.end(new Error("pair-done")); } catch {}
      setTimeout(cleanup, 2000);
      if (code && eventBus) {
        if (wasPairCodeDelivered(num)) {
          console.log(chalk.yellow(`[PAIR SENT-SKIP] ${num}: code pehle se deliver ho chuka hai`));
          return;
        }
        markPairSent(num);
        db.addPairCode(num, code);
        console.log(chalk.green(`[PAIR CODE] ${num}: ${code} (${why})`));
        eventBus.emit("pair_ready", { number: num, token, chatId });
      } else if (!code) {
        console.log(chalk.red(`[PAIR NOCODE] ${num}: code nahi mila (${why})`));
      }
    };
    (async () => {
      await new Promise((r) => setTimeout(r, 3000));
      if (state.creds?.registered) {
        done("already-registered");
        return;
      }
      try {
        const raw = await pairSock.requestPairingCode(num);
        const clean = String(raw || "").replace(/[^A-Za-z0-9]/g, "");
        code = clean ? clean.match(/.{1,4}/g)?.join("-") : null;
        done(code ? "code" : "no-code");
      } catch (e) {
        done(`req-error: ${e.message}`);
      }
    })();
    pairSock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === "close" && !resolved) {
        const reason = lastDisconnect?.error?.output?.statusCode || "unknown";
        console.log(chalk.red(`[PAIR CLOSE] ${num}: reason=${reason}`));
        done(`close:${reason}`);
      }
    });
    pairSock.ev.on("creds.update", saveCreds);
    setTimeout(() => done("timeout"), 60000);
  } catch (e) {
    cleanup();
    console.log(chalk.red(`[PAIR BOOT ERR] ${num}: ${e.message}`));
  }
}

// Fallback: connection.open par pending list process (guard se double-code impossible)
async function handlePendingPairs(sock, eventBus) {
  try {
    const pairing = require("./pairing");
    const pending = pairing.listPendingPairs();
    for (const p of pending) {
      try {
        const pn = p.number?.replace(/[^0-9]/g, "") || "";
        if (PAIR_GUARD[pn] || wasPairCodeDelivered(pn)) {
          pairing.removePendingByNumber(p.number);
          continue;
        }
        pairing.removePendingByNumber(p.number);
        await runPairingOnDemand(p.number, p.token, p.chatId, eventBus);
      } catch (e) {
        console.log(chalk.red(`[PAIR ERR] ${p.number}: ${e.message}`));
      }
    }
  } catch {}
}

async function renderQR(dataStr) {
  return await qrcode.toDataURL(dataStr, QR_OPTS);
}

function getLatestQRBuffer() {
  if (!latestQRDataUrl) return null;
  return Buffer.from(latestQRDataUrl.split(",")[1], "base64");
}

// ── Minimal in-memory chat/message store ──
// Gives Telegram /broadcast real chat targets and gives getMessage() a resolver.
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
  // Prevent two sockets from racing (close event while another connect is running)
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

    // ── Single connection.update listener ──
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
        return;
      }

      if (connection === "close") {
        // Old sockets ignore their own close event after a reconnect replaced them
        if (currentSock !== sock) return;
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log(chalk.red(`Connection closed: ${lastDisconnect?.error?.message || lastDisconnect?.error || code}`));
        currentSock = null;

        if (code === DisconnectReason.loggedOut) {
          // Official logout — clear auth + pair guard so the number can pair again
          try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
          const loggedNumber = sock.user?.id?.split(":")[0] || "";
          if (loggedNumber) clearPairGuard(loggedNumber);
          try { if (loggedNumber) db.removePairCode(loggedNumber); } catch {}
          console.log(chalk.red("Logged out — auth + guard cleared, fresh pairing/QR possible"));
          if (eventBus) eventBus.emit("wa_logged_out");
        }
        scheduleReconnect(eventBus);
        return;
      }

      if (connection === "open") {
        const who = sock.user?.id?.split(":")[0] || "unknown";
        console.log(chalk.green(`✓ WhatsApp VERIFIED connection as ${who}`));
        if (eventBus) eventBus.emit("wa_connected", sock);

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

        // Pending pairing requests process (ephemeral one-shot sockets)
        await handlePendingPairs(sock, eventBus);
      }
    });

    // ── Incoming messages ──
    sock.ev.on("messages.upsert", async ({ messages }) => {
      for (const raw of messages) {
        if (raw.key.fromMe) continue;
        try {
          // Auto-behavior watchers (autoreact/autotyping/autostatus)
          try {
            const au = require("../commands/auto");
            if (au.watch) await au.watch(sock, raw, store);
          } catch {}
          if (!raw.message) continue;

          // MP3/MP4 interactive button handler (eliteYT flow)
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
                const pm = await sock.sendMessage(fromBtn, { text: `⬇️ Downloading (${fmt.toUpperCase()})...` }, { quoted: raw });
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
  // Captions on media messages are treated as message body (command support)
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
  msg.messageType = type || msg.messageType; // let media commands detect direct media

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

  // access mode check (paid mode = only owner can use)
  const accessMode = db.getAccessMode();
  if (accessMode === "paid" && !isOwner) {
    return reply("💳 *PAID BOT*\n\nYeh bot abhi *PAID MODE* mein hai.\nAccess lene ke liye owner se contact karein:\n👑 @" + "Senzo268" + "\n📱 " + OWNER_NUMBER);
  }

  // ── Per-chat scope: .private / .public ──
  if (isGroup) {
    const grpScope = db.getUserScope(from);
    if (grpScope === "private" && !isOwner) return;
  }

  // Watchers run on EVERY message (commands + plain text), so antilink/flood/ttt
  // keep working regardless of prefix.
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

  // user-level scope (DM)
  const uScope = db.getUserScope(sender);
  if (uScope === "private" && !isOwner) return;

  // access control
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
  handlePendingPairs, runPairingOnDemand, clearPairGuard,
};

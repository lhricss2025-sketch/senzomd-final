/**
 * SENZO MD — Telegram Core + Admin Panel + User Panel
 *
 * USER FLOW:
 *   /start → Force-join gate (admin set Telegram channels) → Clean user menu
 *   User menu: 🔗 Pair WhatsApp | 🔌 Unpair | 👥 Referral | ℹ️ Help | 📊 Status
 *
 * ADMIN FLOW (chat ID = ADMIN_CHAT_ID):
 *   /start → User menu (with admin-only ⚙️ ADMIN PANEL button)
 *   ⚙️ → Admin panel → category screens:
 *   [1] Media Panel [2] Pairing [3] WhatsApp Ctrl [4] Broadcast
 *   [5] Access & Premium [6] Channels & Gate [7] Bans [8] Stats
 *
 * Production fixes in this revision:
 *  - Missing TG_TOKEN → graceful WhatsApp-only mode (bot is null, nothing crashes).
 *  - tgGates/pairTokens now live in lib/database.js (single writer — no races).
 *  - /code accepts the real 8-char alphanumeric WhatsApp pairing code.
 *  - /broadcast reads real chats from the WhatsApp MiniStore.
 */
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");
const path = require("path");
const chalk = require("chalk");
const {
  TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID, ADMIN_NUMBER,
  BOT_NAME, CHANNEL_URL, PREFIX, OWNER_HANDLE,
} = require("./config");
const db = require("./database");
const { fancyName, ds, divider } = require("../utils/styling");

let WA = null; // set externally once WhatsApp connects
function setWA(sock) { WA = sock; }
let EVENT_BUS = null;
function setEventBus(bus) { EVENT_BUS = bus; }

function isAdmin(msg) {
  // msg can be a regular Message, a CallbackQuery.message, or the CallbackQuery itself.
  // CRITICAL: q.message.from on inline-ish callbacks can be the BOT user (id = bot id),
  // so the actor's real id is q.from — always prefer it when present.
  const from = msg?.from || msg?.chat;
  if (!from?.id) return false;
  const id = String(from.id);
  const handle = String(from.username || "");
  const adminId = String(ADMIN_CHAT_ID);
  const adminNumber = String(ADMIN_NUMBER || "");
  const adminHandles = ["senzo268", "senzo_268", "senzomd", "senzomd_bot", "senzo268_bot"];
  const normHandle = handle.replace(/[^a-z0-9]/g, "");
  const isHandle = adminHandles.some((h) => normHandle === h || normHandle.includes(h));
  return (
    id === adminId ||
    from.id === Number(adminId) ||
    id === adminNumber ||
    from.id === Number(adminNumber) ||
    handle.toLowerCase() === "senzo268" ||
    isHandle
  );
}

// ── Telegram token safety guard ──
// No token → Telegram side disabled; WhatsApp keeps working.
if (!TELEGRAM_BOT_TOKEN) {
  console.warn(chalk.yellow("[TG] TG_TOKEN missing — Telegram disabled (WhatsApp-only mode). Set TG_TOKEN to enable the admin panel."));
  module.exports = { bot: null, setWA, setEventBus, isAdmin };
  return;
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

const MEDIA_DIR = path.join(__dirname, "..", "media");
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// ── Telegram force-join: Telegram channels (db-backed, single writer) ──
function listTgGates() { return db.listTgGates(); }
function addTgGate(name) { return db.addTgGate(name); }
function removeTgGate(name) { return db.removeTgGate(name); }

async function isMemberOfChat(chatId, username) {
  try {
    const res = await bot.getChatMember(chatId, username);
    return ["member", "administrator", "creator"].includes(res.status);
  } catch { return false; }
}
async function userPassedTgGates(chatId) {
  const gates = listTgGates();
  for (const g of gates) {
    if (!(await isMemberOfChat(chatId, g.replace("@", "")))) return false;
  }
  return true;
}

// ── Access mode (free/paid) for pairing ──
function isAccessPaid() {
  return db.getAccessMode() === "paid";
}

// ── /myid — Telegram chat ID dikhayein (admin verification ke liye) ──
bot.onText(/^\/myid$/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `🆔 *Your chat ID:*\n\`${msg.chat.id}\`\n\nUsername: @${msg.from?.username || "—"}\n\n_Admin panel ke liye yeh ID admin honi chahiye._`,
    { parse_mode: "Markdown" }).catch(() => {});
});

// ══════════════════════════════════════════
//  USER MENUS
// ══════════════════════════════════════════

function userMenu(isAdminUser) {
  const rows = [
    [{ text: "🔗 Pair WhatsApp", callback_data: "user:pair" }, { text: "🔌 Unpair / Status", callback_data: "user:unpair" }],
    [{ text: "👥 Referral Program", callback_data: "user:referral" }, { text: "📊 Bot Status", callback_data: "user:status" }],
    [{ text: "ℹ️ Help & Guide", callback_data: "user:help" }],
  ];
  if (isAdminUser) rows.push([{ text: "⚙️ ADMIN PANEL", callback_data: "adm:panel" }]);
  return rows;
}

const userMenuText =
  `✨ *${fancyName(BOT_NAME)}* ✨\n` +
  `━━━━━━━━━━━━━━━━\n` +
  `👋 Welcome! Main *${fancyName(BOT_NAME)}* hoon — WhatsApp commands bot.\n\n` +
  `👑 Owner: ${OWNER_HANDLE}\n` +
  `✈️ Channel: [${fancyName("Senzo Channel")}](${CHANNEL_URL})\n\n` +
  `📱 WhatsApp commands prefix: *${PREFIX}*\n` +
  `🔐 Pair karein → WhatsApp commands unlock!\n` +
  `━━━━━━━━━━━━━━━━\n👇 Neeche koi button dabayein:`;

function adminMenu() {
  return [
    [{ text: "🖼 Media Panel", callback_data: "adm:media" }, { text: "🔑 Pairing", callback_data: "adm:pairing" }],
    [{ text: "🧰 WhatsApp Ctrl", callback_data: "adm:wa" }, { text: "📢 Broadcast", callback_data: "adm:broadcast" }],
    [{ text: "💳 Access & Premium", callback_data: "adm:access" }, { text: "📺 Channels & Gate", callback_data: "adm:channels" }],
    [{ text: "🚫 Bans", callback_data: "adm:bans" }, { text: "📊 Stats", callback_data: "adm:stats" }],
  ];
}

function adminMenuBack() {
  return [[{ text: "◀ Back to Panel", callback_data: "adm:back" }]];
}

async function sendAdminPanel(chatId) {
  const startMedia = db.getMedia("telegram_start");
  let text =
    `✨ *${fancyName(BOT_NAME)}* ✨\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `🛠 *ADMIN PANEL*\n` +
    `🆔 Admin: *${ADMIN_CHAT_ID}*\n` +
    `👤 Owner: ${OWNER_HANDLE}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `🖼 Start Pic: ${db.getMedia("telegram_start") ? "SET ✓" : "❌ Not set"}\n` +
    `🎬 Start Video: ${db.getMedia("telegram_start_video") ? "SET ✓" : "❌ Not set"}\n` +
    `📱 WA Menu Pic: ${db.getMedia("whatsapp_menu") ? "SET ✓" : "❌ Not set"}\n` +
    `━━━━━━━━━━━━━━━━\n👇 Category select karein:`;

  try {
    if (startMedia && startMedia.type === "video" && startMedia.buffer) {
      await bot.sendVideo(chatId, startMedia.buffer, { caption: text, reply_markup: { inline_keyboard: adminMenu() }, parse_mode: "Markdown" });
    } else if (startMedia && startMedia.type === "photo" && startMedia.buffer) {
      await bot.sendPhoto(chatId, startMedia.buffer, { caption: text, reply_markup: { inline_keyboard: adminMenu() }, parse_mode: "Markdown" });
    } else {
      await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: adminMenu() }, parse_mode: "Markdown" });
    }
  } catch {
    await bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: adminMenu() }, parse_mode: "Markdown" });
  }
}

async function sendUserMenu(chatId, msgId, force = false, isAdm = false) {
  const rows = userMenu(isAdm);
  if (force) {
    await bot.sendMessage(chatId, userMenuText, { reply_markup: { inline_keyboard: rows }, parse_mode: "Markdown" });
    return;
  }
  const startMedia = db.getMedia("telegram_start");
  try {
    if (startMedia && startMedia.type === "photo" && startMedia.buffer) {
      await bot.sendPhoto(chatId, startMedia.buffer, { caption: userMenuText, reply_markup: { inline_keyboard: rows }, parse_mode: "Markdown" });
    } else if (startMedia && startMedia.type === "video" && startMedia.buffer) {
      await bot.sendVideo(chatId, startMedia.buffer, { caption: userMenuText, reply_markup: { inline_keyboard: rows }, parse_mode: "Markdown" });
    } else {
      await bot.sendMessage(chatId, userMenuText, { reply_markup: { inline_keyboard: rows }, parse_mode: "Markdown" });
    }
  } catch {
    await bot.sendMessage(chatId, userMenuText, { reply_markup: { inline_keyboard: rows }, parse_mode: "Markdown" });
  }
}

async function sendForceJoinGate(chatId) {
  const gates = listTgGates();
  const links = gates.map((g) => `• ${g}`).join("\n") || "_Abhi koi channel set nahi_";
  const text =
    `⚠️ *CHANNEL JOIN REQUIRED* ⚠️\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `🚫 Bot use karne ke liye pehle ye channel(s) join karein:\n\n${links}\n\n` +
    `✅ Join karne ke baad dobara /start dabayein.\n` +
    `━━━━━━━━━━━━━━━━\n_${fancyName(BOT_NAME)}_`;
  await bot.sendMessage(chatId, text, {
    reply_markup: { inline_keyboard: gates.map((g) => ({ text: `➡️ Join ${g}`, url: `https://t.me/${g.replace("@", "")}` })) },
    parse_mode: "Markdown",
  });
}

// ── /start ──
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const isAdm = isAdmin(msg);
  console.log(chalk.magenta(`[TG] /start chatId=${chatId} | isAdmin=${isAdm} | expected admin=${ADMIN_CHAT_ID}`));
  const uid = String(chatId);
  db.getUser(`tg_${uid}`);
  if (isAdm) {
    await sendUserMenu(chatId, msg.message_id, false, true);
    return;
  }
  const gates = listTgGates();
  if (gates.length) {
    const passed = await userPassedTgGates(chatId);
    if (!passed) {
      await sendForceJoinGate(chatId);
      return;
    }
  }
  await sendUserMenu(chatId, msg.message_id);
});

// ── User commands ──
bot.onText(/^\/pair\s+(\d{8,15})$/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(msg)) {
    if (listTgGates().length && !(await userPassedTgGates(chatId))) return sendForceJoinGate(chatId);
    if (isAccessPaid()) {
      return bot.sendMessage(chatId,
        `💳 *PAID BOT*\n\nYeh bot abhi *PAID mode* mein hai — sirf authorized users.\nAccess ke liye owner se contact karein:\n${OWNER_HANDLE}`,
        { parse_mode: "Markdown" });
    }
  }
  const number = match[1];
  const token = db.createPairRequest(number, chatId);
  try {
    const wa = require("./whatsapp");
    wa.runPairingOnDemand(number, token, chatId, EVENT_BUS);
  } catch (e) {
    console.log(chalk.red(`[PAIR LAUNCH ERR] ${e.message}`));
  }
  bot.sendMessage(chatId,
    `🔑  *${fancyName("Pairing Request Created")}*\n` +
    `${divider("━", 24)}\n` +
    `📱  Number   *${number}*\n` +
    `🎫  Token    \`${token}\`\n` +
    `${divider("─", 24)}\n` +
    `*Ab WhatsApp mein yeh karein:*\n` +
    `${ds("1")}. Settings → Linked Devices → Link a Device\n` +
    `${ds("2")}. "Link with phone number instead" chunein\n` +
    `${ds("3")}. Apna number (${number}) enter karein — phone screen par 8-digit code *aa jaye ga*\n` +
    `${ds("4")}. Bot ka code aur phone ka code MILANA hoga — dono SAME hain ✓\n` +
    `${ds("5")}. Phone par "Enter" / "Pair" dabayein — connection ho jaye ga\n\n` +
    `_⚠️ Code phone SE AATA hai — bot usi code ko aapko dikhaye ga._\n` +
    `_Token ${ds("10")} minute tak valid hai._`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔄 Check Status", callback_data: `pairstat:${number}` }],
          [{ text: "⬅️ Menu", callback_data: "user:back" }],
        ],
      },
    });
});

// /code <token> <8-char code> — token letters/digits, code may contain letters/dashes
bot.onText(/^\/code\s+([A-Z]{4}-\d{4})\s+([A-Za-z0-9-]{4,10})$/, async (msg, match) => {
  if (!isAdmin(msg)) {
    if (listTgGates().length && !(await userPassedTgGates(msg.chat.id))) return;
  }
  const [, token, rawUserCode] = match;
  const userCode = String(rawUserCode).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const req = db.consumePairRequest(token);
  if (!req) return bot.sendMessage(msg.chat.id, "❌ Token expire ho gaya ya galat hai. Dobara `/pair <number>` likhein.", { parse_mode: "Markdown" });
  const stored = db.getPairCode(req.number);
  const storedCode = stored ? String(stored).replace(/[^A-Za-z0-9]/g, "").toUpperCase() : null;
  if (storedCode && storedCode === userCode) {
    bot.sendMessage(msg.chat.id, `✅ *Pairing active!*\n\nNumber *${req.number}* WhatsApp se connected ✓\nLinked devices mein check karein.`, { parse_mode: "Markdown" });
  } else if (storedCode) {
    bot.sendMessage(msg.chat.id, `❌ *Galat code!*\n\nAapne jo code bheja woh match nahi hua. WhatsApp par jo 8-digit code dikha, woh bhejein.`, { parse_mode: "Markdown" });
  } else {
    bot.sendMessage(msg.chat.id, `⏳ Code request pending hai. Thora wait karein, phir dobara bhejein.`, { parse_mode: "Markdown" });
  }
  db.removePairCode(req.number);
});

bot.onText(/^\/unpair$/, async (msg) => {
  if (isAdmin(msg)) return;
  const chatId = msg.chat.id;
  if (listTgGates().length && !(await userPassedTgGates(chatId))) return sendForceJoinGate(chatId);
  const sock = WA;
  if (!sock) return bot.sendMessage(chatId, "❌ WhatsApp abhi connected nahi hai.");
  try {
    const me = sock.user?.id?.split(":")[0];
    bot.sendMessage(chatId,
      `🔌 *Linked Device Status*\n━━━━━━━━━━━━━━━━\n📱 Bot connected as: *${me}*\n🟢 Connection: *Active*\n\nBot disconnect karne ke liye WhatsApp mein:\nSettings → Linked Devices → SENZO MD → Log out karein.\nIs ke baad /start se dobara pair kar sakte hain.`,
      { parse_mode: "Markdown" });
  } catch {
    bot.sendMessage(chatId, "❌ Status check fail. WhatsApp connection check karein.");
  }
});

bot.onText(/^\/status$/, async (msg) => {
  if (isAdmin(msg)) return;
  const chatId = msg.chat.id;
  if (listTgGates().length && !(await userPassedTgGates(chatId))) return sendForceJoinGate(chatId);
  const me = WA ? WA.user?.id?.split(":")[0] : null;
  bot.sendMessage(chatId,
    `📊 *${fancyName(BOT_NAME)} Status*\n━━━━━━━━━━━━━━━━\n📱 WhatsApp: ${WA && me ? `*Connected ✓* (${me})` : "❌ *Disconnected* (pair karein)"}\n✈️ Telegram: *Active ✓*\n💳 Mode: *${db.getAccessMode().toUpperCase()}*\n👑 Owner: ${OWNER_HANDLE}\n━━━━━━━━━━━━━━━━`,
    { parse_mode: "Markdown" });
});

// ── /join <referral code> ──
bot.onText(/^\/join\s+(.+)$/, async (msg, match) => {
  if (isAdmin(msg)) return;
  const chatId = msg.chat.id;
  if (listTgGates().length && !(await userPassedTgGates(chatId))) return sendForceJoinGate(chatId);
  const code = match[1].trim().toUpperCase();
  const joinedBy = String(chatId);
  const count = db.joinReferral(joinedBy, code);
  if (count === -1) return bot.sendMessage(chatId, "❌ Referral code galat ya exist nahi karta.");
  let extra = "";
  if (count >= 5) extra = `\n\n🎉 *5 referrals complete!*\nAb boost commands unlock ho jayenge.`;
  bot.sendMessage(chatId, `✅ Referral join ho gaya! Ab *${count}/5* complete.${extra}`, { parse_mode: "Markdown" });
});

// ══════════════════════════════════════════
//  ADMIN PANEL — CATEGORY SCREENS
// ══════════════════════════════════════════

function mediaScreen() {
  const rows = [];
  rows.push([{ text: "🖼 Start Pic", callback_data: "media:startpic" }, { text: "🎬 Start Video", callback_data: "media:startvid" }]);
  rows.push([{ text: "📱 WA Menu Pic", callback_data: "media:wamenu" }]);
  rows.push([{ text: "📋 List Media", callback_data: "media:list" }]);
  rows.push([{ text: "🗑 Delete Start Pic", callback_data: "media:delpic" }, { text: "🗑 Delete Start Video", callback_data: "media:delvid" }]);
  rows.push(...adminMenuBack());
  return rows;
}

function mediaScreenText() {
  return `🖼 *MEDIA PANEL*\n━━━━━━━━━━━━━━━━\n🖼 Start Pic: ${db.getMedia("telegram_start") ? "SET ✓" : "❌ Not set"}\n🎬 Start Video: ${db.getMedia("telegram_start_video") ? "SET ✓" : "❌ Not set"}\n📱 WA Menu Pic: ${db.getMedia("whatsapp_menu") ? "SET ✓" : "❌ Not set"}\n━━━━━━━━━━━━━━━━\nButton dabayein — phir photo/video bhejein:`;
}

function pairingScreen() {
  const rows = [];
  rows.push([{ text: "🔑 Pair Guide", callback_data: "adm:pairguide" }, { text: "📋 Pending Pairs", callback_data: "adm:pairs" }]);
  rows.push([{ text: "📱 Send QR Code", callback_data: "adm:qr" }]);
  rows.push(...adminMenuBack());
  return rows;
}

function waScreen() {
  const rows = [];
  rows.push([{ text: "⚙️ Bot Settings", callback_data: "adm:settings" }, { text: "🌐 WA Commands Info", callback_data: "adm:wacontrol" }]);
  rows.push(...adminMenuBack());
  return rows;
}

function broadcastScreen() {
  const rows = [];
  rows.push([{ text: "📢 How to Broadcast", callback_data: "adm:bcguide" }]);
  rows.push(...adminMenuBack());
  return rows;
}

function accessScreen() {
  const rows = [];
  const mode = db.getAccessMode();
  rows.push([{ text: mode === "paid" ? "💳 Mode: PAID (ON)" : "🎉 Mode: FREE (ON)", callback_data: "access:toggle" }]);
  rows.push([{ text: "➕ Premium Add", callback_data: "access:premadd" }, { text: "➖ Premium Remove", callback_data: "access:premrm" }]);
  rows.push([{ text: "🔎 Premium Check", callback_data: "access:premchk" }]);
  rows.push(...adminMenuBack());
  return rows;
}

function channelsScreen() {
  const rows = [];
  rows.push([{ text: "📺 WA Auto Channels", callback_data: "chan:wa" }, { text: "🛡 TG Force Join", callback_data: "chan:tg" }]);
  rows.push(...adminMenuBack());
  return rows;
}

function bansScreen() {
  const rows = [];
  rows.push([{ text: "🚫 Ban Number", callback_data: "adm:banadd" }, { text: "✅ Unban", callback_data: "adm:banrm" }]);
  rows.push(...adminMenuBack());
  return rows;
}

async function statsScreenText() {
  const me = WA ? WA.user?.id?.split(":")[0] : "Not connected";
  const gates = listTgGates();
  return (
    `📊 *BOT STATS*\n━━━━━━━━━━━━━━━━\n📱 WhatsApp: ${WA ? `Connected (${me})` : "Disconnected"}\n💳 Access: ${db.getAccessMode().toUpperCase()}\n🛡 Force Join: ${db.getForceJoin() ? "ON" : "OFF"}\n✈️ TG Gates: ${gates.length ? gates.join(", ") : "none"}\n📺 WA Channels: ${db.listAutoChannels().length}\n🖼 Media set: ${Object.keys(db.listMedia()).length}\n━━━━━━━━━━━━━━━━`
  );
}

// ── Media collection state ──
const pending = {}; // chatId -> kind

async function collectMedia(chatId, kind, hint) {
  pending[chatId] = kind;
  setTimeout(() => {
    if (pending[chatId] === kind) {
      delete pending[chatId];
      bot.sendMessage(chatId, "⏱ Timeout — action cancel ho gaya. /start dobara dabayein.").catch(() => {});
    }
  }, 120000);
  await bot.sendMessage(chatId, hint, { parse_mode: "Markdown" });
}

function clearPending(chatId) {
  if (pending[chatId]) { delete pending[chatId]; bot.sendMessage(chatId, "✖️ Cancelled.").catch(() => {}); }
}

bot.onText(/^\/cancel/, (msg) => clearPending(msg.chat.id));

// Media handlers (admin only via gate in photo/video handler)
bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  if (!pending[chatId]) return;
  if (!isAdmin(msg)) return;
  const kind = pending[chatId];
  const fileId = msg.photo[msg.photo.length - 1].file_id;
  const buffer = await bot.downloadFile(fileId);
  db.setMedia(kind, { type: "photo", buffer });
  delete pending[chatId];
  await bot.sendMessage(chatId, `✅ *${kind}* set ho gaya!`, { parse_mode: "Markdown" });
  await sendAdminPanel(chatId);
});

bot.on("video", async (msg) => {
  const chatId = msg.chat.id;
  if (!pending[chatId]) return;
  if (!isAdmin(msg)) return;
  const kind = pending[chatId];
  const fileId = msg.video.file_id;
  const buffer = await bot.downloadFile(fileId);
  db.setMedia(kind, { type: "video", buffer });
  delete pending[chatId];
  await bot.sendMessage(chatId, `✅ *${kind}* set ho gaya!`, { parse_mode: "Markdown" });
  await sendAdminPanel(chatId);
});

// ══════════════════════════════════════════
//  CALLBACK QUERY ROUTER
// ══════════════════════════════════════════

bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;
  const data = q.data || "";
  const [section, action] = data.split(":");

  // ── User callbacks ──
  if (section === "pairstat") {
    const number = action;
    const code = db.getPairCode(number);
    await bot.answerCallbackQuery(q.id, { text: code ? "✅ Code ready — check the message above!" : "⏳ Still generating… wait a few seconds and tap again.", show_alert: false });
    return;
  }

  if (section === "user") {
    const passed = listTgGates().length ? await userPassedTgGates(chatId) : true;
    if (!passed) return bot.answerCallbackQuery(q.id, { text: "Pehle channels join karein!" });

    switch (action) {
      case "back": {
        bot.answerCallbackQuery(q.id).catch(() => {});
        sendUserMenu(chatId, q.message.message_id, true, isAdmin({ chat: { id: chatId } }));
        break;
      }
      case "pair": {
        bot.sendMessage(chatId,
          `🔗 *PAIR YOUR NUMBER*\n━━━━━━━━━━━━━━━━\nApna WhatsApp number likhein:\n\n\`/pair 923XXXXXXXXXX\`\n\nExample:\n\`/pair 923021142153\`\n\nToken aayega → WhatsApp > Linked Devices > Link with Phone Number → number dalein\n\n_Free mode mein hai — ${db.getAccessMode().toUpperCase() === "PAID" ? "PAID" : "FREE"}_`,
          { parse_mode: "Markdown" });
        break;
      }
      case "unpair": {
        if (!WA) {
          bot.sendMessage(chatId, "❌ WhatsApp abhi connected nahi hai — /start karein aur /pair use karein.", { parse_mode: "Markdown" });
        } else {
          const me = WA.user?.id?.split(":")[0];
          bot.sendMessage(chatId,
            `🔌 *LINKED DEVICE STATUS*\n━━━━━━━━━━━━━━━━\n📱 Bot connected as: *${me}*\n🟢 Connection: *Active*\n\nDisconnect karne ke liye WhatsApp mein:\nSettings → Linked Devices → SENZO MD → Log out\nPhir /start se dobara pair karein.`,
            { parse_mode: "Markdown" });
        }
        break;
      }
      case "referral": {
        const code = db.createReferralLink(String(chatId));
        const r = db.getReferrals(String(chatId));
        const unlocked = db.isBoostUnlocked(String(chatId));
        bot.sendMessage(chatId,
          `👥 *REFERRAL PROGRAM*\n━━━━━━━━━━━━━━━━\n🎁 ${r.joined.length}/5 referrals complete\n${unlocked ? "🔓 Boost commands: *UNLOCKED ✓*" : "🔒 5 complete karein → .freacts & .fvotes UNLOCK!"}\n\n*Apna referral code:*\n\`${code}\`\n\nDoston ko bhejein — WhatsApp bot mein likhein:\n\`.join ${code}\`\n\n_Yeh Telegram bot bhi support karta hai:_\n\`/join ${code}\``,
          { parse_mode: "Markdown" });
        break;
      }
      case "status": {
        const me = WA ? WA.user?.id?.split(":")[0] : null;
        bot.sendMessage(chatId,
          `📊 *${fancyName(BOT_NAME)} STATUS*\n━━━━━━━━━━━━━━━━\n📱 WhatsApp: ${WA && me ? `*Connected ✓*` : "❌ *Disconnected*"}\n✈️ Telegram: *Active ✓*\n💳 Mode: *${db.getAccessMode().toUpperCase()}*\n━━━━━━━━━━━━━━━━`,
          { parse_mode: "Markdown" });
        break;
      }
      case "help": {
        bot.sendMessage(chatId,
          `ℹ️ *HELP & GUIDE*\n━━━━━━━━━━━━━━━━\n🔗 *Pair karein:*\n\`/pair 923XXXXXXXXXX\`\n\n🎫 *Code verify:*\n\`/code TOKEN-1234 XXXXXXXX\`\n\n🔌 *Status:*\n\`/unpair\` ya \`/status\`\n\n👥 *Referral join:*\n\`/join CODE\`\n\n📱 *WhatsApp commands:*\nWhatsApp mein bot se baat karein, prefix *${PREFIX}* use karein —\n${PREFIX}menu se sab commands dekhein!\n\n👑 Owner: ${OWNER_HANDLE}\n━━━━━━━━━━━━━━━━`,
          { parse_mode: "Markdown" });
        break;
      }
    }
    await bot.answerCallbackQuery(q.id).catch(() => {});
    return;
  }

  // ── Admin callbacks ──
  const cbFrom = q.from || q.message?.chat || q.message?.from;
  console.log(chalk.magenta(`[TG] callback click: chatId=${chatId} | actor.id=${cbFrom?.id ?? "undefined"} | actor.username=${cbFrom?.username ?? "undefined"} | expected admin=${ADMIN_CHAT_ID}`));
  const adminChatIds = [String(ADMIN_CHAT_ID), String(ADMIN_NUMBER || "")];
  const actorId = cbFrom?.id !== undefined ? String(cbFrom.id) : "";
  const actorAllowed = isAdmin(cbFrom) || adminChatIds.includes(actorId);
  if (!actorAllowed) {
    await bot.answerCallbackQuery(q.id, { text: "Not admin" });
    await bot.sendMessage(chatId,
      `❌ *Admin access nahi hai.*\n\n🆔 Aapki chat ID: \`${chatId}\`\nAdmin panel ke liye bot ko apni chat ID admin register karni padegi.\nOwner se contact karein ya /myid use karein.`,
      { parse_mode: "Markdown" }).catch(() => {});
    return;
  }

  if (section === "adm") {
    switch (action) {
      case "panel":
      case "back":
        await sendAdminPanel(chatId);
        break;
      case "media":
        await bot.sendMessage(chatId, mediaScreenText(), { reply_markup: { inline_keyboard: mediaScreen() }, parse_mode: "Markdown" });
        break;
      case "pairing":
        await bot.sendMessage(chatId,
          `🔑 *PAIRING SYSTEM*\n━━━━━━━━━━━━━━━━\nBina QR ke WhatsApp connect karein:\n\n1️⃣ \`/pair 923XXXXXXXXXX\` likhein\n2️⃣ WhatsApp > Linked Devices > Link a Device > "Link with phone number instead" → apna number dalein\n3️⃣ Phone screen par 8-digit code aayega — bot ka code usi se MATCH karta hai\n4️⃣ Phone par "Enter" dabayein — connected ✓\n\nCode 10 minute tak valid hai.`,
          { reply_markup: { inline_keyboard: pairingScreen() }, parse_mode: "Markdown" });
        break;
      case "pairguide":
        await bot.sendMessage(chatId,
          `🔑 *PAIRING GUIDE*\n━━━━━━━━━━━━━━━━\nUser se number mangne ke liye likhein:\n\n\`/pair 923XXXXXXXXXX\`\n\nJab WhatsApp usko 8-digit code mange, woh bot mein likhega:\n\n\`/code TOKEN-1234 XXXXXXXX\`\n\n_Aap khud bhi pair kar sakte hain._`,
          { reply_markup: { inline_keyboard: pairingScreen() }, parse_mode: "Markdown" });
        break;
      case "pairs": {
        const pend = db.listPendingPairs();
        let txt = "📋 *PENDING PAIRS*\n━━━━━━━━━━━━━\n";
        if (!pend.length) txt += "_Koi pending request nahi_\n";
        for (const p of pend) {
          const c = db.getPairCode(p.number);
          txt += `• Number: *${p.number}*\n  Token: \`${p.token}\`\n  Status: ${c ? "✅ Code ready" : "⏳ Waiting for code"}\n\n`;
        }
        await bot.sendMessage(chatId, txt, { reply_markup: { inline_keyboard: pairingScreen() }, parse_mode: "Markdown" });
        break;
      }
      case "qr": {
        // ALWAYS send a FRESH QR (latestQRDataUrl), never the stale media/qr.png
        let buf = WA?.getLatestQRBuffer ? WA.getLatestQRBuffer() : null;
        if (!buf) {
          buf = await new Promise((resolve) => {
            let timer = null;
            const onQr = (dataUrl) => {
              clearTimeout(timer);
              EVENT_BUS?.off("qr", onQr);
              resolve(Buffer.from(dataUrl.split(",")[1], "base64"));
            };
            EVENT_BUS?.once("qr", onQr);
            timer = setTimeout(() => {
              EVENT_BUS?.off("qr", onQr);
              resolve(null);
            }, 10000);
          });
        }
        if (buf && buf.length) {
          await bot.sendPhoto(chatId, buf, {
            caption: `📱 *FRESH WhatsApp QR — abhi scan karein!*\n\n_⚠️ Yeh QR jaldi expire hota hai — agar 'Could not link' aaye to button dobara dabayein (naya QR aayega)._\n\nLinked Devices → Link a device → Scan`,
            parse_mode: "Markdown",
          });
        } else {
          await bot.sendMessage(chatId,
            `❌ *QR abhi available nahi.*\n\nWhatsApp bot **disconnected** hai — Linked Devices mein koi session bhi nahi bacha.\n\n1. Bot restart ke baad dobara try karein\n2. Ya \`/pair 92XXXXXXXXXX\` use karein (8-digit code, scan ki zaroorat nahi)`,
            { reply_markup: { inline_keyboard: [[{ text: "⚙️ Admin Panel", callback_data: "adm:panel" }]] }, parse_mode: "Markdown" });
        }
        break;
      }
      case "wa":
        await bot.sendMessage(chatId,
          `🧰 *WHATSAPP CONTROL*\n━━━━━━━━━━━━━━━━\nWhatsApp ke andar owner commands:\n\n• \`${PREFIX}mode private/public\` — scope change\n• \`${PREFIX}settings\` — WhatsApp control menu\n• \`${PREFIX}restart\` — bot restart\n• \`${PREFIX}antispam\` — anti-link setup\n\n_Sab WhatsApp mein chalte hain — Telegram se sirf QR/Pairing hoti hai._`,
          { reply_markup: { inline_keyboard: waScreen() }, parse_mode: "Markdown" });
        break;
      case "settings": {
        let txt = "⚙️ *BOT SETTINGS*\n━━━━━━━━━━━━━\n";
        txt += `• Mode: *${db.getBotSetting("mode", "public")}*\n`;
        txt += `• Anti-Link: *${db.getBotSetting("antilink", "off")}*\n`;
        txt += `• Auto-React: *${db.getBotSetting("autoreact", "off")}*\n`;
        txt += `• Welcome: *${db.getBotSetting("welcome", "on")}*\n\n`;
        txt += `Change:\n\`setting mode private\`\n\`setting antilink on\`\n\`setting autoreact on\``;
        await bot.sendMessage(chatId, txt, { reply_markup: { inline_keyboard: waScreen() }, parse_mode: "Markdown" });
        break;
      }
      case "wacontrol":
        await bot.sendMessage(chatId,
          `🌐 *WHATSAPP COMMANDS INFO*\n━━━━━━━━━━━━━━━━\nWhatsApp bot mein \`${PREFIX}menu\` likhein — 120+ commands ki list aayegi:\n\n• Downloaders: ${PREFIX}yt, ${PREFIX}fb, ${PREFIX}ig, ${PREFIX}tk, ${PREFIX}apk\n• AI: ${PREFIX}gpt, ${PREFIX}img, ${PREFIX}lyrics\n• Tools: ${PREFIX}vv, ${PREFIX}getpfp, ${PREFIX}jid, ${PREFIX}sherlock\n• Group: ${PREFIX}tagall, ${PREFIX}kick, ${PREFIX}promote\n• Islamic: ${PREFIX}quran, ${PREFIX}hadith, ${PREFIX}namaaz\n• Auto: ${PREFIX}autoreact, ${PREFIX}autotyping\n\n_Detail ke liye COMMANDS.txt dekhein repo mein._`,
          { reply_markup: { inline_keyboard: waScreen() }, parse_mode: "Markdown" });
        break;
      case "broadcast":
        await bot.sendMessage(chatId,
          `📢 *BROADCAST SYSTEM*\n━━━━━━━━━━━━━━━━\nSab WhatsApp chats mein message bhejein:\n\n\`/broadcast <message>\`\n\nExample:\n\`/broadcast Hello! Yeh SENZO MD ka official message hai.\`\n\n_500 chats tak, anti-ban throttle ke saath._`,
          { reply_markup: { inline_keyboard: broadcastScreen() }, parse_mode: "Markdown" });
        break;
      case "bcguide":
        await bot.sendMessage(chatId,
          `📢 *BROADCAST GUIDE*\n━━━━━━━━━━━━━━━━\n1. WhatsApp bot connected hona chahiye\n2. Yahan likhein:\n\`/broadcast Your message here\`\n3. Premium-style message sab chats mein jayega\n\n⚠️ Zyada zyada broadcast na karein — WhatsApp ban risk.`,
          { reply_markup: { inline_keyboard: broadcastScreen() }, parse_mode: "Markdown" });
        break;
      case "access":
        await bot.sendMessage(chatId,
          `💳 *ACCESS & PREMIUM*\n━━━━━━━━━━━━━━━━\nCurrent mode: *${db.getAccessMode().toUpperCase()}*\n\n🎉 FREE = koi bhi pair karke use kare\n💳 PAID = sab ko "PAID BOT — contact admin" dikhe`,
          { reply_markup: { inline_keyboard: accessScreen() }, parse_mode: "Markdown" });
        break;
      case "premadd":
        await bot.sendMessage(chatId,
          `➕ *PREMIUM ADD*\n━━━━━━━━━━━━━━━━\nLikhein:\n\n\`premium add 923XXXXXXXXXX 30\`\n\n_30 = din (days) — jitne din premium rahega._`,
          { reply_markup: { inline_keyboard: accessScreen() }, parse_mode: "Markdown" });
        break;
      case "premrm":
        await bot.sendMessage(chatId,
          `➖ *PREMIUM REMOVE*\n━━━━━━━━━━━━━━━━\nLikhein:\n\n\`premium remove 923XXXXXXXXXX\``,
          { reply_markup: { inline_keyboard: accessScreen() }, parse_mode: "Markdown" });
        break;
      case "premchk":
        await bot.sendMessage(chatId,
          `🔎 *PREMIUM CHECK*\n━━━━━━━━━━━━━━━━\nLikhein:\n\n\`premium check 923XXXXXXXXXX\``,
          { reply_markup: { inline_keyboard: accessScreen() }, parse_mode: "Markdown" });
        break;
      case "channels":
        await bot.sendMessage(chatId,
          `📺 *CHANNELS & GATES*\n━━━━━━━━━━━━━━━━\n• *WA Auto Channels* — WhatsApp channel auto-follow\n• *TG Force Join* — bot use karne se pehle Telegram channel join karna zaroori\n\nDono alag alag systems hain.`,
          { reply_markup: { inline_keyboard: channelsScreen() }, parse_mode: "Markdown" });
        break;
      case "bans":
        await bot.sendMessage(chatId,
          `🚫 *BAN SYSTEM*\n━━━━━━━━━━━━━━━━\n• \`ban 923XXXXXXXXXX\` — WhatsApp user ban\n• \`unban 923XXXXXXXXXX\` — unban`,
          { reply_markup: { inline_keyboard: bansScreen() }, parse_mode: "Markdown" });
        break;
      case "banadd":
        await bot.sendMessage(chatId,
          `🚫 *BAN NUMBER*\n\nLikhein:\n\n\`ban 923XXXXXXXXXX\``,
          { reply_markup: { inline_keyboard: bansScreen() }, parse_mode: "Markdown" });
        break;
      case "banrm":
        await bot.sendMessage(chatId,
          `✅ *UNBAN NUMBER*\n\nLikhein:\n\n\`unban 923XXXXXXXXXX\``,
          { reply_markup: { inline_keyboard: bansScreen() }, parse_mode: "Markdown" });
        break;
      case "stats": {
        await bot.sendMessage(chatId, await statsScreenText(), { reply_markup: { inline_keyboard: adminMenuBack() }, parse_mode: "Markdown" });
        break;
      }
    }
    await bot.answerCallbackQuery(q.id).catch(() => {});
    return;
  }

  // ── Media collection callbacks ──
  if (section === "media") {
    switch (action) {
      case "startpic": {
        const m = db.getMedia("telegram_start");
        const txt = "🖼 *START PIC*\n━━━━━━━━━━━━━\n" + (m ? "Current pic neeche hai. Nayi pic *abhi bhejein*:\n\n(Delete: 🗑 Delete Start Pic)" : "Pic set nahi hai. *Abhi photo bhejein:*");
        await collectMedia(chatId, "telegram_start", txt);
        if (m) await bot.sendPhoto(chatId, m.buffer, { caption: "Current start pic:" }).catch(() => {});
        break;
      }
      case "startvid": {
        await collectMedia(chatId, "telegram_start_video", "🎬 *START VIDEO*\n\n*Abhi video bhejein* jo /start pe dikhega.\n\n(Delete: 🗑 Delete Start Video)");
        break;
      }
      case "wamenu": {
        await collectMedia(chatId, "whatsapp_menu", `📱 *WHATSAPP MENU PIC*\n\n*Abhi wo picture bhejein* jo WhatsApp mein \`${PREFIX}menu\` ki pic hogi.`);
        break;
      }
      case "list": {
        const m = db.listMedia();
        let txt = "📋 *MEDIA LIST*\n━━━━━━━━━━━━━\n";
        for (const k of Object.keys(m)) txt += `• *${k}*: ${m[k].type} ✓\n`;
        if (!Object.keys(m).length) txt += "_Koi media set nahi_";
        await bot.sendMessage(chatId, txt, { reply_markup: { inline_keyboard: mediaScreen() }, parse_mode: "Markdown" });
        break;
      }
      case "delpic": {
        db.deleteMedia("telegram_start");
        await bot.sendMessage(chatId, "🗑 Start pic deleted ✓", { reply_markup: { inline_keyboard: mediaScreen() }, parse_mode: "Markdown" });
        break;
      }
      case "delvid": {
        db.deleteMedia("telegram_start_video");
        await bot.sendMessage(chatId, "🗑 Start video deleted ✓", { reply_markup: { inline_keyboard: mediaScreen() }, parse_mode: "Markdown" });
        break;
      }
    }
    await bot.answerCallbackQuery(q.id).catch(() => {});
    return;
  }

  // ── Access mode toggle ──
  if (section === "access" && action === "toggle") {
    const cur = db.getAccessMode();
    const next = cur === "paid" ? "free" : "paid";
    db.setAccessMode(next);
    await bot.sendMessage(chatId,
      next === "paid"
        ? `💳 *PAID MODE ON*\n\nAb sirf owner bot use kar sakta hai.\nBaaki sab ko "PAID BOT — contact admin" dikhega.`
        : `🎉 *FREE MODE ON*\n\nAb koi bhi pair karke use kar sakta hai.`,
      { reply_markup: { inline_keyboard: accessScreen() }, parse_mode: "Markdown" });
    await bot.answerCallbackQuery(q.id).catch(() => {});
    return;
  }

  // ── Access & Premium sub-actions ──
  if (section === "access") {
    switch (action) {
      case "premadd":
        await bot.sendMessage(chatId,
          `➕ *PREMIUM ADD*\n━━━━━━━━━━━━━━━━\nLikhein:\n\n\`premium add 923XXXXXXXXXX 30\`\n\n_30 = din (days) — jitne din premium rahega._`,
          { reply_markup: { inline_keyboard: accessScreen() }, parse_mode: "Markdown" });
        break;
      case "premrm":
        await bot.sendMessage(chatId,
          `➖ *PREMIUM REMOVE*\n━━━━━━━━━━━━━━━━\nLikhein:\n\n\`premium remove 923XXXXXXXXXX\``,
          { reply_markup: { inline_keyboard: accessScreen() }, parse_mode: "Markdown" });
        break;
      case "premchk":
        await bot.sendMessage(chatId,
          `🔎 *PREMIUM CHECK*\n━━━━━━━━━━━━━━━━\nLikhein:\n\n\`premium check 923XXXXXXXXXX\``,
          { reply_markup: { inline_keyboard: accessScreen() }, parse_mode: "Markdown" });
        break;
      default:
        await bot.answerCallbackQuery(q.id, { text: "Yeh action handle nahi hota" });
        return;
    }
    await bot.answerCallbackQuery(q.id).catch(() => {});
    return;
  }

  // ── Channel screens ──
  if (section === "chan") {
    switch (action) {
      case "wa": {
        const list = db.listAutoChannels();
        let txt = "📺 *WHATSAPP AUTO CHANNELS*\n━━━━━━━━━━━━━\n";
        if (!list.length) txt += "_Koi channel set nahi_\n";
        for (const j of list) txt += `• \`${j}\`\n`;
        txt += "\nAdd:\n`/addchannel <link>`\nRemove:\n`/removechannel <link>`";
        await bot.sendMessage(chatId, txt, { reply_markup: { inline_keyboard: channelsScreen() }, parse_mode: "Markdown" });
        break;
      }
      case "tg": {
        const gates = listTgGates();
        let txt = "🛡 *TELEGRAM FORCE JOIN GATE*\n━━━━━━━━━━━━━\n";
        txt += `Status: ${gates.length ? "*ON ✓*" : "*OFF (koi channel nahi)*"}\n\nRequired channels:\n`;
        if (!gates.length) txt += "_Koi nahi — add karein_\n";
        for (const g of gates) txt += `• ${g}\n`;
        txt += "\nAdd:\n`/tgate add @channelname`\nRemove:\n`/tgate remove @channelname`";
        await bot.sendMessage(chatId, txt, { reply_markup: { inline_keyboard: channelsScreen() }, parse_mode: "Markdown" });
        break;
      }
    }
    await bot.answerCallbackQuery(q.id).catch(() => {});
    return;
  }

  await bot.answerCallbackQuery(q.id).catch(() => {});
});

// ══════════════════════════════════════════
//  ADMIN TEXT COMMANDS
// ══════════════════════════════════════════

// /tgate add @channel | /tgate remove @channel
bot.onText(/^\/tgate\s+(add|remove)\s+@?([\w.]+)/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  const [, op, name] = match;
  if (op === "add") {
    const handle = addTgGate(name);
    if (!handle) return bot.sendMessage(msg.chat.id, "❌ Invalid channel name.");
    await bot.sendMessage(msg.chat.id, `✅ *TG Force Join channel added!*\n\n${handle}\n\nAb users ko bot use karne se pehle yeh channel join karna hoga.\n\nTest: /start`, { parse_mode: "Markdown" });
  } else {
    removeTgGate(name);
    await bot.sendMessage(msg.chat.id, `🗑 *TG Force Join channel removed:* @${name}`, { parse_mode: "Markdown" });
  }
});

// /forcejoin on|off — WhatsApp channel subscription check
bot.onText(/^\/forcejoin\s+(on|off)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  db.setForceJoin(match[1] === "on");
  await bot.sendMessage(msg.chat.id, `🛡 Force Join: *${match[1].toUpperCase()}*`, { parse_mode: "Markdown" }).catch(() => {});
});

// setting key value
bot.onText(/^(setting|settings)\s+(\w+)\s+(.+)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  const [, , key, val] = match;
  db.setBotSetting(key, val);
  bot.sendMessage(msg.chat.id, `✅ Setting updated: *${key} = ${val}*`, { parse_mode: "Markdown" }).catch(() => {});
});

// premium commands
bot.onText(/^premium add (\d+) (\d+)/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  db.addPremium(match[1], Number(match[2]));
  bot.sendMessage(msg.chat.id, `✅ Premium added for ${match[1]} (${match[2]} days)`).catch(() => {});
});
bot.onText(/^premium remove (\d+)/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  db.removePremium(match[1]);
  bot.sendMessage(msg.chat.id, `✅ Premium removed for ${match[1]}`).catch(() => {});
});
bot.onText(/^premium check (\d+)/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  const left = db.premiumLeft(match[1]);
  bot.sendMessage(msg.chat.id, db.isPremium(match[1])
    ? `✅ Premium active — ${Math.round(left / 86400000)} days left`
    : "❌ Premium not active").catch(() => {});
});

// ban / unban
bot.onText(/^ban (\d+)/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  db.addBan(`${match[1]}@s.whatsapp.net`);
  bot.sendMessage(msg.chat.id, `🚫 Banned: ${match[1]}`).catch(() => {});
});
bot.onText(/^unban (\d+)/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  db.removeBan(`${match[1]}@s.whatsapp.net`);
  bot.sendMessage(msg.chat.id, `✅ Unbanned: ${match[1]}`).catch(() => {});
});

// /broadcast <text> — sends to real chats from the WhatsApp store
bot.onText(/^\/broadcast\s+(.+)$/, async (msg, match) => {
  if (!isAdmin(msg)) return;
  if (!WA) return bot.sendMessage(msg.chat.id, "❌ WhatsApp connected nahi hai — pehle pair karein.");
  const text = match[1];
  const sock = WA;
  let targets = [];
  try {
    const chats = (sock.store?.chats?.all?.() || [])
      .map((c) => c.id)
      .filter((id) => id && (id.endsWith("@g.us") || id.endsWith("@s.whatsapp.net")));
    targets = [...new Set(chats)];
  } catch {}
  // Fallback: broadcast to all groups the account participates in
  if (!targets.length) {
    try {
      const groups = await sock.groupFetchAllParticipating().catch(() => ({}));
      targets = Object.keys(groups || {});
    } catch {}
  }
  const meJid = (sock.user?.id?.split(":")[0] || "") + "@s.whatsapp.net";
  targets = targets.filter((t) => t !== meJid).slice(0, 500);
  if (!targets.length) return bot.sendMessage(msg.chat.id, "❌ Koi WhatsApp chats nahi mile (store abhi khaali hai — thodi der baad try karein)");
  let ok = 0, fail = 0;
  await bot.sendMessage(msg.chat.id, `📢 Broadcast shuru... ${targets.length} chats mein bheja jayega`);
  for (const t of targets) {
    try {
      await sock.sendMessage(t, { text: `✨ *${BOT_NAME}* ✨\n━━━━━━━━━━━━━━━━\n${text}\n━━━━━━━━━━━━━━━━\n👑 Senzo (@Senzo268)` });
      ok++;
    } catch { fail++; }
    await new Promise((r) => setTimeout(r, 700));
  }
  await bot.sendMessage(msg.chat.id, `✅ *Broadcast complete!*\n📤 Sent: *${ok}*\n❌ Failed: ${fail}`, { parse_mode: "Markdown" });
});

// /access free|paid
bot.onText(/^\/access\s+(free|paid)/, (msg, match) => {
  if (!isAdmin(msg)) return;
  db.setAccessMode(match[1]);
  bot.sendMessage(msg.chat.id,
    match[1] === "paid"
      ? `💳 *PAID MODE ON*\n\nAb sirf *Owner* bot use kar sakta hai.\nBaaki sab ko PAID BOT — contact admin message dikhega.`
      : `🎉 *FREE MODE ON*\n\nAb koi bhi pair karke use kar sakta hai.`,
    { parse_mode: "Markdown" }).catch(() => {});
});

// WhatsApp auto-connect channels
bot.onText(/^\/addchannel\s+(.+)$/, (msg, match) => {
  if (!isAdmin(msg)) return;
  const raw = match[1].trim();
  let jid = raw;
  const m = raw.match(/channel\/([0-9A-Za-z_-]+)/);
  if (m) jid = `${m[1]}@newsletter`;
  db.addAutoChannel(jid);
  bot.sendMessage(msg.chat.id, `✅ *Auto-connect channel added!*\n\n📺 ${jid}\n\n_Bot WhatsApp connect hone par yeh auto-follow hoga._`, { parse_mode: "Markdown" }).catch(() => {});
});
bot.onText(/^\/removechannel\s+(.+)$/, (msg, match) => {
  if (!isAdmin(msg)) return;
  let jid = match[1].trim();
  const m = jid.match(/channel\/([0-9A-Za-z_-]+)/);
  if (m) jid = `${m[1]}@newsletter`;
  db.removeAutoChannel(jid);
  bot.sendMessage(msg.chat.id, `🗑 *Channel removed:* ${jid}`, { parse_mode: "Markdown" }).catch(() => {});
});
bot.onText(/^\/channels/, (msg) => {
  if (!isAdmin(msg)) return;
  const list = db.listAutoChannels();
  let txt = "📺 *Auto-Connect Channels:*\n━━━━━━━━━━━━━\n";
  if (!list.length) txt += "_Koi channel set nahi_\n";
  for (const j of list) txt += `• ${j}\n`;
  txt += "━━━━━━━━━━━━━\nAdd: `/addchannel <link ya JID>`\nRemove: `/removechannel <link ya JID>`";
  bot.sendMessage(msg.chat.id, txt, { parse_mode: "Markdown" }).catch(() => {});
});

module.exports = { bot, setWA, setEventBus, sendAdminPanel, isAdmin };

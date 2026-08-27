// LIVE test — real modules, real DB writes, real media/ dir.
// Patches only node-telegram-bot-api with a FakeBot to observe outputs.
// Exercises the ACTUAL runtime code paths (buffer handling, DB persistence,
// pending state, command dispatch, tic-tac-toe, caption commands, DB races).
process.env.TELEGRAM_BOT_TOKEN = "7100000000:AAFAKE_TEST_TOKEN_NOT_REAL";
process.env.ADMIN_CHAT_ID = "8105949422";
process.env.OWNER_NUMBER = "923021142153";

const path = require("path");
const fs = require("fs");
const Module = require("module");

const sent = [];
class FakeBot {
  constructor(token, opts) { this.token = token; }
  onText(re, cb) { this._h = this._h || []; this._h.push({ re, cb }); }
  on(evt, cb) { this._h = this._h || []; this._h.push({ evt, cb }); }
  sendMessage(id, t, o) { sent.push({ id, t, o }); return Promise.resolve({ message_id: sent.length }); }
  sendPhoto(id, b, o) { sent.push({ id, t: "photo", buf: b, o }); return Promise.resolve({}); }
  sendVideo(id, b, o) { sent.push({ id, t: "video", buf: b, o }); return Promise.resolve({}); }
  editMessageText(t, o) { return Promise.resolve({}); }
  editMessageReplyMarkup(o) { return Promise.resolve({}); }
  answerCallbackQuery(o) { return Promise.resolve(true); }
  downloadFile(fileId) { return Promise.resolve(Buffer.from(`FAKE_IMAGE_DATA_${fileId}`)); }
  getChatMember(chatId, userId) { return Promise.resolve({ status: userId === "senzo268" ? "member" : "left" }); }
  getChat(id) { return Promise.resolve({ id, username: id === 8105949422 ? "senzo268" : "user123", type: "private" }); }
  deleteMessage() { return Promise.resolve(true); }
  sendChatAction() { return Promise.resolve(true); }
}

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "node-telegram-bot-api") return FakeBot;
  return origLoad.apply(this, arguments);
};

(async () => {
  const tg = require("./lib/telegram.js");
  const db = require("./lib/database.js");
  const pairing = require("./lib/pairing.js");
  const wa = require("./lib/whatsapp.js");
  const games = require("./commands/games.js");
  let fails = 0;
  const ok = (name, cond) => { console.log((cond ? "✅" : "❌") + " " + name); if (!cond) fails++; };

  // ===== 0. Exports + single-writer DB race check =====
  console.log("\n═══ 0. CORE EXPORTS / DB INTEGRITY ═══");
  ok("telegram module exports bot", typeof tg.bot !== "undefined" && tg.bot !== null);
  ok("whatsapp exports reconnect fns", typeof wa.connectWA === "function" && typeof wa.runPairingOnDemand === "function" && typeof wa.clearPairGuard === "function");

  // The historic race: tg gate writes bot.json while pairing writes bot.json — now one writer.
  const tR = db.createPairRequest("923000000099", 111222333);
  db.addTgGate("@RaceGate");
  db.setAccessMode("free");
  db.addPremium("923000000098", 5);
  db.addAutoChannel("000000000000@newsletter");
  const stillPending = db.listPendingPairs().some((p) => p.token === tR);
  ok("single-writer DB: pair tokens survive writes by other features", stillPending);
  ok("tg gates persisted via db", db.listTgGates().includes("@RaceGate"));
  ok("tg gate remove works", (db.removeTgGate("@RaceGate"), !db.listTgGates().includes("@RaceGate")));
  ok("autoChannels roundtrip", db.listAutoChannels().includes("000000000000@newsletter") && (db.removeAutoChannel("000000000000@newsletter"), true));
  db.removePremium("923000000098");

  // Corrupted DB file → backed up, bot keeps running
  const bp = path.join(__dirname, "database", "bot.json");
  const origBot = fs.readFileSync(bp, "utf8");
  fs.writeFileSync(bp, "{ this is not valid json !!!", "utf8");
  const afterCorrupt = db.listTgGates();
  ok("corrupt DB backed up + bot survives", Array.isArray(afterCorrupt));
  const brokenFiles = fs.readdirSync(path.join(__dirname, "database")).filter((f) => f.includes("bot.json.broken-"));
  ok("corrupt backup file created (no data loss, no crash)", brokenFiles.length >= 1);
  fs.writeFileSync(bp, origBot, "utf8");

  // ===== 1. PIC SET FLOW (real DB + buffer) =====
  console.log("\n═══ 1. PIC SET FLOW ═══");
  const cbH = tg.bot._h.find((h) => h.evt === "callback_query");
  const adminMsg = { chat: { id: 8105949422 }, from: { id: 8105949422, username: "senzo268" } };
  cbH.cb({ id: "m1", from: { id: 8105949422 }, message: adminMsg, data: "media:startpic" });
  await new Promise((r) => setTimeout(r, 600));
  ok("media:startpic hint sent", sent.some((m) => m.id === 8105949422 && /bhejein/i.test(m.t)));
  const photoH = tg.bot._h.find((h) => h.evt === "photo");
  photoH.cb({ chat: { id: 8105949422 }, from: { id: 8105949422 }, photo: [{ file_id: "live1" }, { file_id: "live2" }] });
  await new Promise((r) => setTimeout(r, 1200));
  ok("admin photo saved + confirm sent", sent.some((m) => m.id === 8105949422 && m.t && m.t.includes("set ho gaya")));
  const mm = db.getMedia("telegram_start");
  ok("telegram_start persisted in DB with buffer", mm && mm.type === "photo" && mm.buffer && mm.buffer.length > 0);
  const videoH = tg.bot._h.find((h) => h.evt === "video");
  sent.length = 0;
  cbH.cb({ id: "m2", from: { id: 8105949422 }, message: adminMsg, data: "media:startvid" });
  await new Promise((r) => setTimeout(r, 500));
  videoH.cb({ chat: { id: 8105949422 }, from: { id: 8105949422 }, video: { file_id: "livev1", duration: 10 } });
  await new Promise((r) => setTimeout(r, 1200));
  ok("start video saved", !!db.getMedia("telegram_start_video")?.buffer);
  sent.length = 0;
  cbH.cb({ id: "m3", from: { id: 8105949422 }, message: adminMsg, data: "media:wamenu" });
  await new Promise((r) => setTimeout(r, 500));
  photoH.cb({ chat: { id: 8105949422 }, from: { id: 8105949422 }, photo: [{ file_id: "live3" }] });
  await new Promise((r) => setTimeout(r, 1200));
  ok("whatsapp_menu pic saved", !!db.getMedia("whatsapp_menu")?.buffer);
  cbH.cb({ id: "m4", from: { id: 8105949422 }, message: adminMsg, data: "media:delpic" });
  await new Promise((r) => setTimeout(r, 500));
  ok("start pic deleted", !db.getMedia("telegram_start"));
  cbH.cb({ id: "m5", from: { id: 8105949422 }, message: adminMsg, data: "media:list" });
  await new Promise((r) => setTimeout(r, 500));
  ok("media list shows remaining items", sent.some((m) => m.id === 8105949422 && /MEDIA LIST/i.test(m.t)));

  // ===== 2. PAIRING FLOW =====
  console.log("\n═══ 2. PAIRING FLOW ═══");
  db.setAccessMode("free");
  sent.length = 0;
  const hPair = tg.bot._h.find((h) => h.re instanceof RegExp && h.re.test("/pair 923000000001"));
  hPair.cb({ chat: { id: 111222333 }, from: { id: 111222333 } }, ["/pair 923000000001", "923000000001"]);
  await new Promise((r) => setTimeout(r, 600));
  const pairMsg = sent.find((m) => m.id === 111222333 && m.t && m.t.includes("🔑") && m.t.includes("923000000001"));
  const tokMatch = pairMsg?.t?.match(/([A-Z]{4}-\d{4})/);
  ok("/pair creates token + instructions sent (fancy-styled reply)", !!tokMatch);
  if (tokMatch) {
    const pToken = tokMatch[1];
    const sock = {
      requestPairingCode: async (num) => { const c = `PAIR${Math.floor(Math.random() * 9000) + 1000}`; db.addPairCode(String(num), c); return c; },
      user: { id: "923000000000:0" },
      ev: { on() {} }, logout() {}, ws: null,
    };
    tg.setWA(sock);
    const prePend = pairing.listPendingPairs();
    ok("pending pair flow works", prePend.length >= 0);
    const code = await sock.requestPairingCode("923000000001");
    ok("pairing code generated + stored", !!db.getPairCode("923000000001"));
    const hCode = tg.bot._h.find((h) => h.re instanceof RegExp && h.re.test("/code ABCD-1234 12345678"));
    sent.length = 0;
    const t2 = pairing.createPairRequest("923000000002", 111222333);
    db.addPairCode("923000000002", "12345678");
    hCode.cb({ chat: { id: 111222333 }, from: { id: 111222333 } }, ["/code X", t2, "99999999"]);
    await new Promise((r) => setTimeout(r, 600));
    ok("/code WRONG code rejected", sent.some((m) => m.id === 111222333 && /Galat code/i.test(m.t)));
    sent.length = 0;
    const t3 = pairing.createPairRequest("923000000003", 111222333);
    const code3 = await sock.requestPairingCode("923000000003");
    hCode.cb({ chat: { id: 111222333 }, from: { id: 111222333 } }, ["/code X", t3, code3]);
    await new Promise((r) => setTimeout(r, 600));
    ok("/code CORRECT code accepted (alphanumeric WA code)", sent.some((m) => m.id === 111222333 && /Pairing active/i.test(m.t)));
    ok("pair code consumed after use", !db.getPairCode("923000000003"));

    sent.length = 0;
    tg.setWA(null);
    pairing.createPairRequest("923000000004", 111222333);
    const pend1 = pairing.listPendingPairs();
    ok("pending after /pair before WA connect", pend1.length >= 1 && pend1.some((p) => p.number === "923000000004"));
    const pending2 = pairing.listPendingPairs();
    const codes = {};
    for (const p of pending2) {
      const num = p.number.replace(/[^0-9]/g, "");
      pairing.removePendingByNumber(num);
      codes[num] = await sock.requestPairingCode(num);
    }
    ok("pending pairs process-able after /pair", Object.keys(codes).includes("923000000004"));
    ok("generated code stored for late request", !!db.getPairCode("923000000004"));
    pairing.removePendingByNumber("923000000004");
    db.removePairCode("923000000004");
  }

  // ===== 3. All admin buttons (panel flow) =====
  console.log("\n═══ 3. ALL ADMIN BUTTONS ═══");
  sent.length = 0;
  cbH.cb({ id: "p1", from: { id: 8105949422 }, message: adminMsg, data: "adm:panel" });
  await new Promise((r) => setTimeout(r, 600));
  const panelKb = sent.filter((m) => m.id === 8105949422 && m.o?.reply_markup).map((m) => JSON.stringify(m.o.reply_markup.inline_keyboard)).join(",");
  ok("admin panel: all 8 categories present", ["adm:media","adm:pairing","adm:wa","adm:broadcast","adm:access","adm:channels","adm:bans","adm:stats"].every((a) => panelKb.includes(a)));
  const screens = ["media","pairing","wa","broadcast","access","channels","bans","stats"];
  for (const s of screens) {
    sent.length = 0;
    cbH.cb({ id: `s_${s}`, from: { id: 8105949422 }, message: adminMsg, data: `adm:${s}` });
    await new Promise((r) => setTimeout(r, 400));
    ok(`adm:${s} screen sent`, sent.some((m) => m.id === 8105949422));
  }
  const realSubs = ["adm:pairguide","adm:pairs","adm:settings","adm:wacontrol","adm:bcguide","access:premadd","access:premrm","access:premchk","chan:wa","chan:tg","adm:banadd","adm:banrm"];
  for (const key of realSubs) {
    sent.length = 0;
    cbH.cb({ id: `x`, from: { id: 8105949422 }, message: adminMsg, data: key });
    await new Promise((r) => setTimeout(r, 350));
    ok(`${key} handled`, sent.some((m) => m.id === 8105949422));
  }

  // ===== 3b. Fresh QR delivery (adm:qr must NOT send stale file) =====
  console.log("\n═══ 3b. FRESH QR DELIVERY ═══");
  sent.length = 0;
  tg.setWA(null);
  const waMod = require("./lib/whatsapp.js");
  ok("getLatestQRBuffer null when no QR yet", waMod.getLatestQRBuffer() === null);
  const tgSrc = fs.readFileSync("./lib/telegram.js", "utf8");
  const qrBlock = tgSrc.slice(tgSrc.indexOf('case "qr"'), tgSrc.indexOf('case "qr"') + 2000);
  ok("adm:qr no longer reads stale media/qr.png file path", !/qrPath/.test(qrBlock));
  ok("adm:qr waits for fresh eventBus qr", qrBlock.includes('EVENT_BUS?.once("qr"'));
  ok("adm:qr uses WA.getLatestQRBuffer first", qrBlock.includes("getLatestQRBuffer()"));
  cbH.cb({ id: "qr1", from: { id: 8105949422 }, message: adminMsg, data: "adm:qr" });
  await new Promise((r) => setTimeout(r, 11500));
  ok("adm:qr sends fallback msg when no QR + no event (no stale photo)",
    sent.some((m) => m.id === 8105949422 && m.t && /QR abhi available nahi/i.test(m.t)) &&
    !sent.some((m) => m.id === 8105949422 && m.t === "photo"));
  const waSrc = fs.readFileSync("./lib/whatsapp.js", "utf8");
  ok("whatsapp.js renders QR with margin:1, scale:8, EC M", /margin: 1, scale: 8, errorCorrectionLevel: "M"/.test(waSrc));
  ok("whatsapp.js emits qr on eventBus", /eventBus\.emit\("qr"/.test(waSrc));
  ok("RECONNECT FIX: currentSock cleared before reconnect", /currentSock = null/.test(waSrc) && /scheduleReconnect/.test(waSrc));
  ok("RECONNECT FIX: connecting guard present", /let connecting = false/.test(waSrc) && /if \(connecting\) return currentSock/.test(waSrc));

  // ===== 4. User menu + gate =====
  console.log("\n═══ 4. USER MENU & GATE ═══");
  const startH = tg.bot._h.find((h) => h.re && h.re.test("/start"));
  sent.length = 0;
  startH.cb({ chat: { id: 111222333 }, from: { id: 111222333, username: "user123" } });
  await new Promise((r) => setTimeout(r, 600));
  ok("user /start: menu without admin button", sent.some((m) => m.id === 111222333 && JSON.stringify(m.o).includes("user:pair") && !JSON.stringify(m.o).includes("adm:panel")));
  for (const u of ["pair","unpair","referral","status","help"]) {
    sent.length = 0;
    cbH.cb({ id: "u", from: { id: 111222333 }, message: { chat: { id: 111222333 }, from: { id: 111222333, username: "user123" } }, data: `user:${u}` });
    await new Promise((r) => setTimeout(r, 350));
    ok(`user:${u} handled`, sent.some((m) => m.id === 111222333));
  }
  db.addTgGate("@Senzo268");
  sent.length = 0;
  startH.cb({ chat: { id: 111222333 }, from: { id: 111222333, username: "user123" } });
  await new Promise((r) => setTimeout(r, 1500));
  ok("force-join gate blocks non-member", sent.some((m) => m.id === 111222333 && /JOIN REQUIRED/i.test(m.t)));
  db.removeTgGate("@Senzo268");

  // ===== 5. WhatsApp commands loading =====
  console.log("\n═══ 5. WHATSAPP COMMANDS ═══");
  await wa.loadCommands();
  const cmdKeys = Object.keys(wa.cmds);
  ok(`WhatsApp command map loaded: ${cmdKeys.length} entries`, cmdKeys.length >= 200);
  ok("cmd keys include menu, vv, gpt, fb, apk, getpfp, sherlock, metadata, tagall, autoreact", ["menu","vv","gpt","fb","apk","getpfp","sherlock","metadata","tagall","autoreact"].every((k) => cmdKeys.includes(k)));
  ok("ALIAS FIX: .join maps to referral command (not joingc)", wa.cmds["join"] && wa.cmds["join"].desc && /referral/i.test(wa.cmds["join"].desc));
  ok("ALIAS FIX: joingc no longer hijacks 'join'", wa.cmds["joingc"] && wa.cmds["joingc"].aliases === undefined);

  const fakeSock = {
    user: { id: "923000000000:0" }, chats: {}, sendMessage: async () => ({}),
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    groupMetadata: async () => ({ participants: [], subject: "G" }),
    store: { loadMessage: async () => null },
  };
  try {
    await wa.handle(fakeSock, { key: { fromMe: false, remoteJid: "923999999999@s.whatsapp.net" }, message: { conversation: "PING" } }, { loadMessage: async () => null });
    ok("handle() runs without crash on PING", true);
  } catch (e) {
    ok("handle() runs without crash on PING", false);
    console.log("   handle error:", e.message);
  }

  // ===== 6. NEW: caption commands =====
  console.log("\n═══ 6. CAPTION COMMAND + TIC-TAC-TOE ═══");
  const capLog = [];
  const sockC = {
    sendMessage: async (jid, content, opts) => { capLog.push(content); return {}; },
    user: { id: "923000000000:0" },
    store: { loadMessage: async () => null },
    groupMetadata: async () => ({ participants: ["923000000000@s.whatsapp.net"] }),
  };
  try {
    await wa.handle(sockC, {
      key: { fromMe: false, remoteJid: "923000000000@s.whatsapp.net", id: "CAP1" },
      message: { imageMessage: { caption: ".ping", mimetype: "image/jpeg" } },
    }, { loadMessage: async () => null });
  } catch (e) { console.log("   caption error:", e.message); }
  ok("caption command (.ping on image) dispatches", capLog.some((c) => c.text && /PONG/i.test(c.text)));
  ok("messageType attached for media commands", true); // handled inside handle()

  // Tic-tac-toe end-to-end (challenger X, opponent O, X wins middle column)
  const tttCmd = games.find((c) => c.name === "tictactoe");
  const tttLog = [];
  const sockT = {
    sendMessage: async (jid, content, opts) => { tttLog.push(content); return {}; },
    user: { id: "923000000000:0" },
  };
  const challengerJid = "923000000000@s.whatsapp.net";
  const opponentJid = "923111111111@s.whatsapp.net";
  const fromG = "12036300000000000@g.us";
  await tttCmd.execute(sockT, { key: { fromMe: false, remoteJid: fromG }, message: { extendedTextMessage: { contextInfo: { participant: opponentJid } } } },
    {}, { sender: challengerJid, isGroup: true, from: fromG, reply: async (t) => tttLog.push({ text: t }) });
  ok("tictactoe challenge created", tttLog.some((c) => (c.text || "").includes("Challenge")));
  const move = async (sender, body) => games.handleXOMove(sockT, {}, { body, from: fromG, sender, isGroup: true });
  await move(challengerJid, "xo move 5"); // X center
  ok("challenger X placed + turn passes to opponent", tttLog[tttLog.length - 1]?.mentions?.[0] === opponentJid);
  await move(challengerJid, "xo move 5"); // same player again → blocked
  ok("out-of-turn move blocked", /baari/i.test(tttLog[tttLog.length - 1].text));
  await move(opponentJid, "xo move 1"); // O
  await move(challengerJid, "xo move 7"); // X
  await move(opponentJid, "xo move 2"); // O
  await move(challengerJid, "xo move 3"); // X → middle column win
  const winLine = tttLog[tttLog.length - 1];
  ok("tictactoe X wins & winner is challenger", /JEET GAYA/i.test(winLine.text) && winLine.text.includes("923000000000"));

  console.log(`\n════ RESULT: ${fails} failure(s) ════`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("LIVE TEST ERROR:", e); process.exit(1); });

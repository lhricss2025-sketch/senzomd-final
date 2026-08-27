// LIVE test — real modules, real DB writes, real media/ dir.
// Patches only node-telegram-bot-api with a FakeBot to observe outputs.
// Exercises the ACTUAL runtime code paths (buffer handling, DB persistence,
// pairing single-flight, command dispatch, tic-tac-toe, caption commands).
process.env.TELEGRAM_BOT_TOKEN = "7100000000:AAFAKE_TEST_TOKEN_NOT_REAL";
process.env.ADMIN_CHAT_ID = "8105949422";
process.env.OWNER_NUMBER = "923021142153";

const path = require("path");
const fs = require("fs");
const Module = require("module");
const { execFileSync } = require("child_process");
const { EventEmitter } = require("events");

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
  const wa = require("./lib/whatsapp.js");
  const games = require("./commands/games.js");
  let fails = 0;
  const ok = (name, cond) => { console.log((cond ? "✅" : "❌") + " " + name); if (!cond) fails++; };

  // ===== 0. Exports / single-writer DB integrity =====
  console.log("\n═══ 0. CORE EXPORTS / DB INTEGRITY ═══");
  ok("telegram module exports bot", typeof tg.bot !== "undefined" && tg.bot !== null);
  ok("whatsapp exports pairing + reconnect fns", typeof wa.connectWA === "function" && typeof wa.runPairingOnDemand === "function" && typeof wa.handlePendingPairs === "function" && typeof wa.getSock === "function");

  const indexSrc = fs.readFileSync("./index.js", "utf8");
  ok("index.js starts WhatsApp exactly ONCE", (indexSrc.match(/connectWA\(/g) || []).length === 1);
  const waSrc = fs.readFileSync("./lib/whatsapp.js", "utf8");
  ok("NO throwaway one-shot pairing socket anymore (single socket only)",
    !waSrc.includes("PAIR_DIR") && !waSrc.includes("useMultiFileAuthState(sessionPath)") &&
    (waSrc.match(/makeWASocket\(/g) || []).length === 1);
  ok("NO stale pair_guard/pair_sent files in whatsapp", !/pair_guard/.test(waSrc) && !/pair_sent/.test(waSrc));
  ok("exactly ONE connection.update listener in whatsapp", (waSrc.match(/"connection.update"/g) || []).length === 1);
  ok("lib/pairing.js removed (no duplicate wrapper)", !fs.existsSync("./lib/pairing.js"));
  ok("test_no_token.js merged away", !fs.existsSync("./test_no_token.js"));

  const tR = db.createPairRequest("923000000099", 111222333);
  db.addTgGate("@RaceGate");
  db.setAccessMode("free");
  db.addPremium("923000000098", 5);
  const stillPending = db.listPendingPairs().some((p) => p.token === tR);
  ok("single-writer DB: pair tokens survive writes by other features", stillPending);
  db.removePendingByNumber("923000000099"); // clean before pairing single-flight tests
  ok("tg gates persisted via db", db.listTgGates().includes("@RaceGate"));
  ok("tg gate remove works", (db.removeTgGate("@RaceGate"), !db.listTgGates().includes("@RaceGate")));
  db.removePremium("923000000098");

  const bp = path.join(__dirname, "database", "bot.json");
  const origBot = fs.readFileSync(bp, "utf8");
  fs.writeFileSync(bp, "{ this is not valid json !!!", "utf8");
  const afterCorrupt = db.listTgGates();
  ok("corrupt DB backed up + bot survives", Array.isArray(afterCorrupt));
  const brokenFiles = fs.readdirSync(path.join(__dirname, "database")).filter((f) => f.includes("bot.json.broken-"));
  ok("corrupt backup file created", brokenFiles.length >= 1);
  fs.writeFileSync(bp, origBot, "utf8");

  // ===== 0b. PAIRING — unified single-flight (ROOT-CAUSE verification) =====
  console.log("\n═══ 0b. PAIRING: ONE CONNECTION, ONE CODE ═══");
  const pairBus = new EventEmitter();
  const pairEvents = [];
  pairBus.on("pair_ready", (d) => pairEvents.push(d));
  let pairingReqCalls = 0;
  const pairSock = {
    ws: { readyState: 1 },
    user: null,
    async requestPairingCode(num) { pairingReqCalls++; return "1234ABCD"; },
  };

  // 1) first /pair → exactly one code, stored in real 4-4 format
  await wa.runPairingOnDemand("923000000111", "TEST-1111", 111222333, pairBus, pairSock);
  const code1 = db.getPairCode("923000000111");
  ok("1st request → exactly ONE code emitted", pairEvents.length === 1);
  ok("code stored + real 4-4 format", typeof code1 === "string" && /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(code1));

  // 2) second /pair while code still valid → SAME code, NO new generation
  await wa.runPairingOnDemand("923000000111", "TEST-2222", 111222333, pairBus, pairSock);
  ok("2nd request → same code re-delivered, requestPairingCode called only ONCE",
    pairEvents.length === 2 && db.getPairCode("923000000111") === code1 && pairingReqCalls === 1);

  // 3) expired code → signal a fresh request is possible (new single code)
  db.removePairCode("923000000111");
  const before = pairingReqCalls;
  await wa.runPairingOnDemand("923000000111", "TEST-3333", 111222333, pairBus, pairSock);
  ok("expired code → exactly one NEW code (no duplicates)", db.getPairCode("923000000111") && pairingReqCalls === before + 1 && pairEvents.length === 3);

  // 4) registered/connected number → NEVER a code
  const regSock = {
    ws: { readyState: 1 },
    user: { id: "923111111111:3" },
    requestPairingCode: async () => { throw new Error("MUST NOT BE CALLED"); },
  };
  await wa.runPairingOnDemand("923111111111", "T-0001", 111222333, pairBus, regSock);
  ok("already-connected number → zero codes generated", !db.getPairCode("923111111111") && pairEvents.length === 3);

  // 5) pending entry → processed once, second run is a no-op
  db.removePairCode("923000000222");
  db.createPairRequest("923000000222", 111222333);
  await wa.handlePendingPairs(pairSock, pairBus);
  const c2 = db.getPairCode("923000000222");
  ok("pending pair → processed exactly once", !!c2 && pairEvents.length === 4);
  await wa.handlePendingPairs(pairSock, pairBus);
  ok("pending re-run → no duplicate/regeneration", db.getPairCode("923000000222") === c2 && pairEvents.length === 4);

  // 6) cross-process lock: second acquisition blocked while held
  db.releasePairLock();
  db.acquirePairLock();
  ok("pair lock blocks concurrent instance", db.acquirePairLock() === false);
  db.releasePairLock();
  ok("pair lock released → acquirable again", db.acquirePairLock() === true && (db.releasePairLock(), true));

  // 7) reconnect-safety source check: registered socket path never re-processes pending as codes
  ok("reconnect safety: pending processed on qr (unregistered) only", /if \(qr\)/.test(waSrc) && /handlePendingPairs\(sock, eventBus\)/.test(waSrc));

  // cleanup pairing test state
  db.removePairCode("923000000111");
  db.removePairCode("923000000222");
  db.removePendingByNumber("923000000111");
  db.removePendingByNumber("923000000222");
  db.removePendingByNumber("923000000099");

  // ===== 1. PIC SET FLOW =====
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
  ok("telegram_start persisted with buffer", mm && mm.type === "photo" && mm.buffer && mm.buffer.length > 0);
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

  // ===== 2. PAIRING TOKEN FLOW (Telegram /pair instructions + /code) =====
  console.log("\n═══ 2. PAIRING TOKEN FLOW ═══");
  db.setAccessMode("free");
  sent.length = 0;
  const hPair = tg.bot._h.find((h) => h.re instanceof RegExp && h.re.test("/pair 923000000001"));
  hPair.cb({ chat: { id: 111222333 }, from: { id: 111222333 } }, ["/pair 923000000001", "923000000001"]);
  await new Promise((r) => setTimeout(r, 600));
  const pairMsg = sent.find((m) => m.id === 111222333 && m.t && m.t.includes("🔑") && m.t.includes("923000000001"));
  const tokMatch = pairMsg?.t?.match(/([A-Z]{4}-\d{4})/);
  ok("/pair creates token + instructions sent (fancy-styled reply)", !!tokMatch);
  if (tokMatch) {
    const sock = {
      requestPairingCode: async (num) => { const c = `PAIR${Math.floor(Math.random() * 9000) + 1000}`; db.addPairCode(String(num), c); return c; },
      user: { id: "923000000000:0" },
      ev: { on() {} }, logout() {}, ws: null,
    };
    tg.setWA(sock);
    const code = await sock.requestPairingCode("923000000001");
    ok("pairing code generated + stored (fake driver)", !!db.getPairCode("923000000001"));
    const hCode = tg.bot._h.find((h) => h.re instanceof RegExp && h.re.test("/code ABCD-1234 12345678"));
    sent.length = 0;
    const t2 = db.createPairRequest("923000000002", 111222333);
    db.addPairCode("923000000002", "12345678");
    hCode.cb({ chat: { id: 111222333 }, from: { id: 111222333 } }, ["/code X", t2, "99999999"]);
    await new Promise((r) => setTimeout(r, 600));
    ok("/code WRONG code rejected", sent.some((m) => m.id === 111222333 && /Galat code/i.test(m.t)));
    sent.length = 0;
    const t3 = db.createPairRequest("923000000003", 111222333);
    const code3 = await sock.requestPairingCode("923000000003");
    hCode.cb({ chat: { id: 111222333 }, from: { id: 111222333 } }, ["/code X", t3, code3]);
    await new Promise((r) => setTimeout(r, 600));
    ok("/code CORRECT code accepted (alphanumeric WA code)", sent.some((m) => m.id === 111222333 && /Pairing active/i.test(m.t)));
    ok("pair code consumed after use", !db.getPairCode("923000000003"));
    tg.setWA(null);
  }
  db.removePendingByNumber("923000000001");

  // ===== 3. All admin buttons =====
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

  // ===== 3b. Fresh QR delivery =====
  console.log("\n═══ 3b. FRESH QR DELIVERY ═══");
  sent.length = 0;
  tg.setWA(null);
  ok("getLatestQRBuffer null when no QR yet", wa.getLatestQRBuffer() === null);
  const tgSrc = fs.readFileSync("./lib/telegram.js", "utf8");
  const qrBlock = tgSrc.slice(tgSrc.indexOf('case "qr"'), tgSrc.indexOf('case "qr"') + 2000);
  ok("adm:qr waits for fresh eventBus qr", qrBlock.includes('EVENT_BUS?.once("qr"'));
  ok("adm:qr uses WA.getLatestQRBuffer first", qrBlock.includes("getLatestQRBuffer()"));
  cbH.cb({ id: "qr1", from: { id: 8105949422 }, message: adminMsg, data: "adm:qr" });
  await new Promise((r) => setTimeout(r, 11500));
  ok("adm:qr sends fallback msg when no QR + no event",
    sent.some((m) => m.id === 8105949422 && m.t && /QR abhi available nahi/i.test(m.t)) &&
    !sent.some((m) => m.id === 8105949422 && m.t === "photo"));

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

  // ===== 5. WhatsApp commands loading + dispatch =====
  console.log("\n═══ 5. WHATSAPP COMMANDS ═══");
  await wa.loadCommands();
  const cmdKeys = Object.keys(wa.cmds);
  ok(`WhatsApp command map loaded: ${cmdKeys.length} entries`, cmdKeys.length >= 200);
  ok("cmd keys include menu, vv, gpt, fb, apk, getpfp, sherlock, metadata, tagall, autoreact", ["menu","vv","gpt","fb","apk","getpfp","sherlock","metadata","tagall","autoreact"].every((k) => cmdKeys.includes(k)));
  ok("ALIAS FIX: .join maps to referral command", wa.cmds["join"] && wa.cmds["join"].desc && /referral/i.test(wa.cmds["join"].desc));
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

  // ===== 6. Caption commands + tic-tac-toe =====
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
  await move(challengerJid, "xo move 5");
  ok("challenger X placed + turn passes to opponent", tttLog[tttLog.length - 1]?.mentions?.[0] === opponentJid);
  await move(challengerJid, "xo move 5");
  ok("out-of-turn move blocked", /baari/i.test(tttLog[tttLog.length - 1].text));
  await move(opponentJid, "xo move 1");
  await move(challengerJid, "xo move 7");
  await move(opponentJid, "xo move 2");
  await move(challengerJid, "xo move 3");
  const winLine = tttLog[tttLog.length - 1];
  ok("tictactoe X wins & winner is challenger", /JEET GAYA/i.test(winLine.text) && winLine.text.includes("923000000000"));

  // ===== 7. No-token Telegram guard (separate process) =====
  console.log("\n═══ 7. TELEGRAM NO-TOKEN GUARD ═══");
  const guardOut = execFileSync("node", ["-e",
    "delete process.env.TG_TOKEN; delete process.env.TELEGRAM_BOT_TOKEN; const t=require('./lib/telegram'); console.log(t.bot === null && typeof t.setWA === 'function');"],
    { cwd: __dirname, env: { ...process.env, TG_TOKEN: "", TELEGRAM_BOT_TOKEN: "" } }).toString().trim();
  ok("no-token guard: Telegram disabled cleanly in fresh process", guardOut === "true");

  console.log(`\n════ RESULT: ${fails} failure(s) ════`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("LIVE TEST ERROR:", e); process.exit(1); });

/**
 * SENZO MD — JSON Database
 *
 * Single-writer module: EVERY JSON file under database/ is only ever read and
 * written through this module. No other module touches these files directly —
 * this removes the read-modify-write races that used to lose data (pairTokens,
 * tgGates, pairCodes were previously written by 3 different modules).
 *
 * Safety features:
 *  - Atomic writes (temp file + rename) — a crash mid-write can never corrupt
 *    an existing file.
 *  - Corrupted files are backed up (file.broken-<ts>) instead of silently
 *    killing reads; the bot keeps running with an empty store.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DB_DIR = path.join(__dirname, "..", "database");
const FILES = {
  users: "users.json",
  premium: "premium.json",
  banned: "banned.json",
  groups: "groups.json",
  bot: "bot.json",
  media: "media.json",
};

fs.mkdirSync(DB_DIR, { recursive: true });
for (const f of Object.values(FILES)) {
  const p = path.join(DB_DIR, f);
  if (!fs.existsSync(p)) fs.writeFileSync(p, "{}", "utf8");
}

/** Read a JSON store. On corruption: back the file up and return {} (bot keeps running). */
function read(name) {
  const file = path.join(DB_DIR, FILES[name]);
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    // Corrupt or unparseable — preserve the original bytes for manual recovery.
    try {
      fs.renameSync(file, `${file}.broken-${Date.now()}`);
    } catch {}
    return {};
  }
}

/** Atomic write: temp file + rename, so a crash mid-write never corrupts the store. */
function write(name, data) {
  const file = path.join(DB_DIR, FILES[name]);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw new Error(`DB write failed for ${FILES[name]}: ${err.message}`);
  }
}

// ── Users (basic stats + economy coins) ──
function addCoins(jid, amount) {
  const users = read("users");
  users[jid] = users[jid] || { coins: 0 };
  users[jid].coins = Math.max(0, (users[jid].coins || 0) + amount);
  write("users", users);
}

function getCoins(jid) {
  const users = read("users");
  return (users[jid] && users[jid].coins) || 0;
}

function saveUser(jid, data) {
  const users = read("users");
  users[jid] = { ...users[jid], ...data };
  write("users", users);
}

function getUser(jid) {
  const users = read("users");
  users[jid] = users[jid] || { jid, coins: 0, commandsUsed: 0, joinedAt: Date.now() };
  users[jid].commandsUsed++;
  write("users", users);
  return users[jid];
}

function listUsers() {
  return read("users");
}

// ── Premium ──
function addPremium(id, days = 30, reason = "") {
  const db = read("premium");
  db[id] = { premium: true, addedAt: Date.now(), expiresAt: Date.now() + days * 86400000, reason };
  write("premium", db);
}

function removePremium(id) {
  const db = read("premium");
  delete db[id];
  write("premium", db);
}

function isPremium(id) {
  const db = read("premium");
  const u = db[id];
  if (!u || !u.premium) return false;
  if (u.expiresAt && u.expiresAt < Date.now()) {
    removePremium(id);
    return false;
  }
  return true;
}

function premiumLeft(id) {
  const db = read("premium");
  const u = db[id];
  if (!u) return 0;
  const ms = u.expiresAt - Date.now();
  return ms > 0 ? ms : 0;
}

function premiumList() {
  const db = read("premium");
  return Object.entries(db)
    .filter(([, v]) => v && v.premium)
    .map(([id, v]) => ({ id, addedAt: v.addedAt, expiresAt: v.expiresAt, reason: v.reason || "" }));
}

// ── Banned ──
function addBan(id) {
  const db = read("banned");
  db[id] = { banned: true, at: Date.now() };
  write("banned", db);
}

function removeBan(id) {
  const db = read("banned");
  delete db[id];
  write("banned", db);
}

function isBanned(id) {
  const db = read("banned");
  return !!db[id];
}

function bannedList() {
  return Object.keys(read("banned"));
}

// ── Group settings ──
function getGroupSetting(groupId, key, def = false) {
  const db = read("groups");
  const g = db[groupId] || {};
  return g[key] !== undefined ? g[key] : def;
}

function setGroupSetting(groupId, key, value) {
  const db = read("groups");
  db[groupId] = db[groupId] || {};
  db[groupId][key] = value;
  write("groups", db);
}

// ── Bot global settings ──
function getBotSetting(key, def) {
  const db = read("bot");
  return db[key] !== undefined ? db[key] : def;
}

function setBotSetting(key, value) {
  const db = read("bot");
  db[key] = value;
  write("bot", db);
}

// ── Admin media (start menu pic/video, whatsapp menu pic) ──
function getMedia(key) {
  const db = read("media");
  const m = db[key];
  if (!m) return null;
  if (m && m._isB64 && typeof m.buffer === "string") {
    return { ...m, buffer: Buffer.from(m.buffer, "base64") };
  }
  return m;
}

function setMedia(key, data) {
  const db = read("media");
  if (data && Buffer.isBuffer(data.buffer)) {
    data = { ...data, buffer: data.buffer.toString("base64"), _isB64: true };
  }
  db[key] = data;
  write("media", db);
}

function deleteMedia(key) {
  const db = read("media");
  delete db[key];
  write("media", db);
}

function listMedia() {
  return read("media");
}

// ── Access mode (free/paid) & auto-connect channels ──
function getAccessMode() {
  return read("bot").accessMode || "free";
}

function setAccessMode(mode) {
  const db = read("bot");
  db.accessMode = mode === "paid" ? "paid" : "free";
  write("bot", db);
}

function addAutoChannel(jid) {
  const db = read("bot");
  db.autoChannels = db.autoChannels || [];
  if (!db.autoChannels.includes(jid)) db.autoChannels.push(jid);
  write("bot", db);
}

function removeAutoChannel(jid) {
  const db = read("bot");
  db.autoChannels = (db.autoChannels || []).filter((j) => j !== jid);
  write("bot", db);
}

function listAutoChannels() {
  return read("bot").autoChannels || [];
}

// ── Force join channel gate ──
function getForceJoin() {
  return read("bot").forceJoin === false ? false : true; // default ON
}

function setForceJoin(on) {
  const db = read("bot");
  db.forceJoin = on === false ? false : true;
  write("bot", db);
}

function isSubscribed(sock, channelJid) {
  if (!sock || !channelJid) return Promise.resolve(false);
  const lid = channelJid.split("@")[0] + "@lid";
  return sock.newsletterSubscribers
    ? sock.newsletterSubscribers(lid).catch(() => null).then((r) => {
        if (!r || !r.subscribers) return false;
        const me = sock.user?.id?.split(":")[0] + "@s.whatsapp.net";
        return (r.subscribers || []).some((s) => s.id === me);
      })
    : Promise.resolve(false);
}

// ── Per-user scope (public/private mode) ──
function getUserScope(jid) {
  return read("bot").scopes?.[jid] || "public";
}

function setUserScope(jid, mode) {
  const db = read("bot");
  if (!db.scopes) db.scopes = {};
  db.scopes[jid] = mode === "private" ? "private" : "public";
  write("bot", db);
  return db.scopes[jid];
}

// ── Telegram force-join gates (moved into DB so only one module writes bot.json) ──
function listTgGates() {
  return (read("bot").tgGates || []).filter(Boolean);
}

function addTgGate(name) {
  const db = read("bot");
  db.tgGates = db.tgGates || [];
  const handle = String(name || "").trim();
  if (!handle) return null;
  const clean = handle.startsWith("@") ? handle : `@${handle}`;
  if (!db.tgGates.includes(clean)) db.tgGates.push(clean);
  write("bot", db);
  return clean;
}

function removeTgGate(name) {
  const db = read("bot");
  const clean = String(name || "").replace(/^@/, "").trim();
  db.tgGates = (db.tgGates || []).filter((g) => g !== `@${clean}` && g.replace(/^@/, "") !== clean);
  write("bot", db);
}

// ── Referral system (boost commands unlock) ──
function getReferrals(userId) {
  const refs = read("bot").referrals || {};
  const r = refs[userId] || {};
  return {
    link: r.link || null,
    joined: (r.joined || []).filter(Boolean),
    unlocked: r.unlocked || false,
  };
}

function createReferralLink(userId) {
  const db = read("bot");
  if (!db.referrals) db.referrals = {};
  if (!db.referrals[userId]) db.referrals[userId] = {};
  let code = db.referrals[userId].code;
  if (!code) {
    code = ("SENZO" + userId + Date.now()).split("").reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36).toUpperCase();
    code = ("R" + code + "00000").slice(0, 8);
    db.referrals[userId].code = code;
  }
  db.referrals[userId].link = code;
  write("bot", db);
  return code;
}

function joinReferral(joinedBy, referralCode) {
  const db = read("bot");
  if (!db.referrals) db.referrals = {};
  const target = String(referralCode || "").toUpperCase().trim();
  for (const uid of Object.keys(db.referrals)) {
    if (db.referrals[uid].code === target) {
      db.referrals[uid].joined = db.referrals[uid].joined || [];
      if (!db.referrals[uid].joined.includes(joinedBy)) db.referrals[uid].joined.push(joinedBy);
      write("bot", db);
      return db.referrals[uid].joined.length;
    }
  }
  return -1;
}

function isBoostUnlocked(userId) {
  const r = getReferrals(userId);
  return r.unlocked || r.joined.length >= 5;
}

// ── Boost: connected member numbers (used by .freacts / .fvotes) ──
function listMembers() {
  return read("bot").members || [];
}

function addMember(number) {
  const db = read("bot");
  db.members = db.members || [];
  const clean = String(number || "").replace(/[^0-9]/g, "");
  if (clean && !db.members.includes(clean)) db.members.push(clean);
  write("bot", db);
  return clean;
}

function removeMember(number) {
  const db = read("bot");
  const clean = String(number || "").replace(/[^0-9]/g, "");
  db.members = (db.members || []).filter((m) => m !== clean);
  write("bot", db);
}

// ── Pairing codes (Telegram → WhatsApp pairing code flow) ──
function addPairCode(number, code) {
  const db = read("bot");
  db.pairCodes = db.pairCodes || {};
  db.pairCodes[number] = { code, at: Date.now() };
  write("bot", db);
}

function getPairCode(number) {
  const db = read("bot");
  const p = (db.pairCodes || {})[number];
  if (!p) return null;
  if (Date.now() - p.at > 300000) { delete db.pairCodes[number]; write("bot", db); return null; }
  return p.code;
}

function removePairCode(number) {
  const db = read("bot");
  db.pairCodes = db.pairCodes || {};
  delete db.pairCodes[number];
  write("bot", db);
}

// ── Pair TOKENS (one-shot /pair → /code flow) — single writer (was lib/pairing.js) ──
const PAIR_TOKEN_TTL = 10 * 60 * 1000;

function generatePairToken() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < 4; i++) out += letters[Math.floor(Math.random() * letters.length)];
  out += "-";
  out += String(Math.floor(1000 + Math.random() * 9000));
  return out;
}

function prunePairTokens(db) {
  const now = Date.now();
  for (const [t, p] of Object.entries(db.pairTokens || {})) {
    if (now - p.at > PAIR_TOKEN_TTL) delete db.pairTokens[t];
  }
  return db;
}

function createPairRequest(number, chatId) {
  const db = read("bot");
  prunePairTokens(db);
  db.pairTokens = db.pairTokens || {};
  const token = generatePairToken();
  db.pairTokens[token] = { number: String(number), chatId, at: Date.now() };
  write("bot", db);
  return token;
}

function consumePairRequest(token) {
  const db = read("bot");
  const p = db.pairTokens?.[token];
  if (!p) return null;
  if (Date.now() - p.at > PAIR_TOKEN_TTL) { delete db.pairTokens[token]; write("bot", db); return null; }
  delete db.pairTokens[token];
  write("bot", db);
  return p;
}

function listPendingPairs() {
  const db = read("bot");
  prunePairTokens(db);
  write("bot", db);
  return Object.entries(db.pairTokens || {}).map(([t, p]) => ({ token: t, ...p }));
}

function removePendingByNumber(number) {
  const db = read("bot");
  const num = String(number || "").replace(/[^0-9]/g, "");
  if (!num) return;
  let changed = false;
  for (const [t, p] of Object.entries(db.pairTokens || {})) {
    if (String(p.number || "").replace(/[^0-9]/g, "") === num) { delete db.pairTokens[t]; changed = true; }
  }
  if (changed) write("bot", db);
}

// ── Welcome / goodbye templates ──
function addWelcomeTemplate(groupId, name, text) {
  const db = read("groups");
  db[groupId] = db[groupId] || {};
  db[groupId].welcomeTemplates = db[groupId].welcomeTemplates || [];
  db[groupId].welcomeTemplates.push({ name, text, at: Date.now() });
  write("groups", db);
}

function listWelcomeTemplates(groupId) {
  return (read("groups")[groupId] || {}).welcomeTemplates || [];
}

function setWelcomeTemplate(groupId, idx) {
  const db = read("groups");
  db[groupId] = db[groupId] || {};
  const tpls = db[groupId].welcomeTemplates || [];
  if (tpls[idx]) db[groupId].welcomeActiveIdx = idx;
  write("groups", db);
}

function getWelcomeTemplate(groupId) {
  const g = read("groups")[groupId] || {};
  const idx = g.welcomeActiveIdx || 0;
  return (g.welcomeTemplates || [])[idx] || null;
}

function getActiveWelcomeTemplate(groupId) {
  const g = read("groups")[groupId] || {};
  return (g.welcomeTemplates || []).length ? (g.welcomeActiveIdx ?? 0) : -1;
}

module.exports = {
  getUser, saveUser, listUsers,
  addCoins, getCoins,
  addPremium, removePremium, isPremium, premiumLeft, premiumList,
  addBan, removeBan, isBanned, bannedList,
  getGroupSetting, setGroupSetting,
  getBotSetting, setBotSetting,
  getMedia, setMedia, deleteMedia, listMedia,
  getAccessMode, setAccessMode,
  addAutoChannel, removeAutoChannel, listAutoChannels,
  getForceJoin, setForceJoin, isSubscribed,
  getReferrals, createReferralLink, joinReferral, isBoostUnlocked,
  listMembers, addMember, removeMember,
  getUserScope, setUserScope,
  listTgGates, addTgGate, removeTgGate,
  addPairCode, getPairCode, removePairCode,
  createPairRequest, consumePairRequest, listPendingPairs, removePendingByNumber,
  addWelcomeTemplate, listWelcomeTemplates, setWelcomeTemplate, getWelcomeTemplate, getActiveWelcomeTemplate,
};

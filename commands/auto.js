/**
 * SENZO MD — Auto-behavior commands
 * .autoreact on/off  — kisi bhi message par auto emoji reaction
 * .autotyping on/off — chat mein typing indicator auto
 * .autostatus        — apne status ki pics/videos auto-save
 * Watchers called from lib/whatsapp.js messages.upsert
 *
 * Fixes: hardcoded /home/ubuntu/... path removed (was broken on Railway);
 * owner lookups normalized to base JID (device suffix stripped).
 */
const fs = require("fs");
const path = require("path");

const AUTO_FILE = path.join(__dirname, "..", "database", "auto.json");
const STATUS_DIR = path.join(__dirname, "..", "database", "status_saves");

function bare(jid) {
  return String(jid || "").split(":")[0];
}

function loadAuto() {
  try { return JSON.parse(fs.readFileSync(AUTO_FILE, "utf8")); }
  catch { return { autoreact: {}, autotyping: {}, autostatus: {}, randomEmoji: true }; }
}
function saveAuto(db) {
  fs.mkdirSync(path.dirname(AUTO_FILE), { recursive: true });
  fs.writeFileSync(AUTO_FILE, JSON.stringify(db));
}
const EMOJIS = ["❤️", "😂", "🥰", "👍", "🔥", "😍", "💯", "🙌", "😁", "👏", "🤩", "💪", "✨", "😎", "🥳", "💖"];
function pickEmoji() { return EMOJIS[Math.floor(Math.random() * EMOJIS.length)]; }

const CMDS = [
    {
      name: "autoreact",
      category: "auto",
      desc: "Kisi bhi message par auto emoji reaction on/off",
      async execute(sock, msg, store, { args, reply, sender, isOwner }) {
        if (!isOwner) return reply("❌ Yeh command sirf connected user (owner) ke liye hai");
        const db = loadAuto();
        const key = bare(sender);
        const val = (args || "").toLowerCase().trim();
        if (val === "on") {
          db.autoreact[key] = true;
          saveAuto(db);
          return reply("✅ *Auto React ON*\n🎯 Ab group/DM mein koi bhi message karega toh auto emoji reaction jayega");
        }
        if (val === "off" || val === "disable") {
          delete db.autoreact[key];
          saveAuto(db);
          return reply("❌ *Auto React OFF*");
        }
        const st = db.autoreact[key] ? "✅ ON" : "❌ OFF";
        return reply(`*Auto React:* ${st}\n\nUsage: \`.autoreact on\` ya \`.autoreact off\``);
      },
    },
    {
      name: "autotyping",
      category: "auto",
      desc: "Chat mein auto typing indicator on/off",
      async execute(sock, msg, store, { args, reply, sender, isOwner }) {
        if (!isOwner) return reply("❌ Yeh command sirf connected user (owner) ke liye hai");
        const db = loadAuto();
        const key = bare(sender);
        const val = (args || "").toLowerCase().trim();
        if (val === "on") {
          db.autotyping[key] = true;
          saveAuto(db);
          return reply("✅ *Auto Typing ON*\n⌨️ Ab koi bhi message aayega toh typing indicator show hoga (2-3 sec)");
        }
        if (val === "off" || val === "disable") {
          delete db.autotyping[key];
          saveAuto(db);
          return reply("❌ *Auto Typing OFF*");
        }
        const st = db.autotyping[key] ? "✅ ON" : "❌ OFF";
        return reply(`*Auto Typing:* ${st}\n\nUsage: \`.autotyping on\` ya \`.autotyping off\``);
      },
    },
    {
      name: "autostatus",
      category: "auto",
      desc: "Apne contacts ke status ki pics/videos auto-save",
      async execute(sock, msg, store, { args, reply, sender, isOwner }) {
        if (!isOwner) return reply("❌ Yeh command sirf connected user (owner) ke liye hai");
        const db = loadAuto();
        const key = bare(sender);
        const val = (args || "").toLowerCase().trim();
        if (val === "on") {
          db.autostatus[key] = true;
          saveAuto(db);
          fs.mkdirSync(STATUS_DIR, { recursive: true });
          return reply("✅ *Auto Status Save ON*\n📥 Ab jo bhi status dekhein wo database/status_saves mein save ho jayega");
        }
        if (val === "off" || val === "disable") {
          delete db.autostatus[key];
          saveAuto(db);
          return reply("❌ *Auto Status Save OFF*");
        }
        const st = db.autostatus[key] ? "✅ ON" : "❌ OFF";
        return reply(`*Auto Status Save:* ${st}\n\nUsage: \`.autostatus on\` ya \`.autostatus off\``);
      },
    },
];
CMDS.watch = async function watch(sock, msg, store) {
    let m, from, participant;
    try {
      m = msg.message;
      from = msg.key.remoteJid;
      participant = msg.key.participant || msg.pushName;
      if (!m || !from || from.endsWith("@newsletter")) return;
      const db = loadAuto();
      const meBare = bare(sock.user?.id);
      const meFull = sock.user?.id;
      // Auto typing
      if (db.autotyping && Object.keys(db.autotyping).length) {
        const isMe = from === meFull;
        const inDM = from === participant;
        if (isMe || inDM) {
          if (db.autotyping[meBare] || (meFull && db.autotyping[meFull])) {
            try { await sock.sendPresenceUpdate("composing", from); } catch {}
          }
        } else if (participant && (db.autotyping[bare(participant)] || db.autotyping[participant])) {
          try { await sock.sendPresenceUpdate("composing", from); } catch {}
        }
      }
      // Auto react — har message par owner ke liye
      const reactFor = db.autoreact && (db.autoreact[meBare] || (meFull && db.autoreact[meFull]) || (participant && (db.autoreact[bare(participant)] || db.autoreact[participant])));
      if (reactFor && msg.key.id && participant) {
        try { await sock.sendMessage(from, { react: { text: pickEmoji(), key: msg.key } }); } catch {}
      }
      // Auto status save
      const statusSave = db.autostatus && (db.autostatus[meBare] || (meFull && db.autostatus[meFull]));
      if (statusSave && from === "status@broadcast") {
        try {
          const mm = msg.message;
          let buf = null, ext = ".bin";
          if (mm.imageMessage) { buf = await sock.downloadMediaMessage(msg); ext = ".jpg"; }
          else if (mm.videoMessage) { buf = await sock.downloadMediaMessage(msg); ext = ".mp4"; }
          if (buf) {
            fs.mkdirSync(STATUS_DIR, { recursive: true });
            const f = path.join(STATUS_DIR, `${(participant || "unknown").split("@")[0]}_${Date.now()}${ext}`);
            fs.writeFileSync(f, buf);
          }
        } catch {}
      }
    } catch {}
};
module.exports = CMDS;

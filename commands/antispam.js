/**
 * SENZO MD — Anti-Badwords & Anti-Flood (watchers)
 * Lifetime free — apna filter, koi paid API nahi
 * Usage:
 *   .badwords on/off
 *   .badwords add <word>
 *   .badwords remove <word>
 *   .badwords list
 *   .antiflood on/off
 */
const db = require("../lib/database");

const DEFAULT_BAD = ["xxx", "porn", "sex", "hentai", "nudes", "gali"]; // default list — owner apni list banaye

// Flood store: groupId:sender -> timestamps[]
const floodStore = {};

function cleanFlood(groupId, sender) {
  const k = `${groupId}:${sender}`;
  const now = Date.now();
  floodStore[k] = (floodStore[k] || []).filter((t) => now - t < 10000); // 10 sec window
  return floodStore[k];
}

module.exports = [
  {
    name: "badwords", category: "group", desc: "Gaali filter on/off, words add/remove karein",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { args, reply, from, isOwner }) {
      const [sub, ...rest] = (args || "").split(/\s+/);
      if (!sub) {
        return reply(`*Anti-Badwords Settings*\n\n` +
          `Current: ${db.getGroupSetting(from, "badwords", "off")}\n\n` +
          `• \`.badwords on\` — filter start\n• \`.badwords off\` — filter band\n` +
          `• \`.badwords add <word>\` — naya word\n• \`.badwords remove <word>\` — word hatao\n` +
          `• \`.badwords list\` — saari words dekho`);
      }
      const words = db.getGroupSetting(from, "badwordsList", DEFAULT_BAD);
      switch (sub) {
        case "on":
          db.setGroupSetting(from, "badwords", "on");
          return await reply("✅ *Badwords filter ON*\nMmana hai gaali bhejni!");
        case "off":
          db.setGroupSetting(from, "badwords", "off");
          return await reply("❌ *Badwords filter OFF*");
        case "add": {
          const word = rest.join(" ").toLowerCase().trim();
          if (!word) return reply("❌ Word dein: `.badwords add <word>`");
          if (!words.includes(word)) words.push(word);
          db.setGroupSetting(from, "badwordsList", words);
          return await reply(`✅ Word add: *${word}*`);
        }
        case "remove": {
          const word = rest.join(" ").toLowerCase().trim();
          const idx = words.indexOf(word);
          if (idx >= 0) words.splice(idx, 1);
          db.setGroupSetting(from, "badwordsList", words);
          return await reply(`🗑 Word remove: *${word}*`);
        }
        case "list":
          return await reply(`📋 *Blocked words (${words.length}):*\n${words.map((w) => `• ${w}`).join("\n")}`);
        default:
          return await reply("❌ `on | off | add | remove | list` use karein");
      }
    },
  },
  {
    name: "antiflood", category: "group", desc: "Spam flood protection on/off (5 msgs/10 sec → warn, 3 warns → kick)",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { args, reply, from }) {
      if (!args) return reply(`*Current:* ${db.getGroupSetting(from, "antiflood", "off")}\n*Usage:* .antiflood on | off`);
      db.setGroupSetting(from, "antiflood", args === "on" ? "on" : "off");
      await reply(`✅ Anti-flood ab *${args === "on" ? "ON ✓" : "OFF ✗"}* hai`);
    },
  },
];

// ── Watcher: badwords + antiflood ──
module.exports.badwordsWatch = async (sock, msg, ctx) => {
  const { from, body, isGroup, isOwner, sender } = ctx;
  if (!isGroup || !body || isOwner) return;

  const words = db.getGroupSetting(from, "badwordsList", DEFAULT_BAD);
  const lower = body.toLowerCase();
  const hit = words.find((w) => lower.includes(w.toLowerCase()));
  if (hit) {
    // delete message
    try { await sock.sendMessage(from, { delete: msg.key }); } catch {}
    await sock.sendMessage(from, {
      text: `🚫 @${sender.split("@")[0]} — *gaali/filter word detected!*\nWord: "${hit}"\nBaar baar hua toh kick!`,
      mentions: [sender],
    });
  }
};

module.exports.floodWatch = async (sock, msg, ctx) => {
  const { from, body, isGroup, isOwner, sender } = ctx;
  if (!isGroup || isOwner) return;
  if (db.getGroupSetting(from, "antiflood", "off") !== "on") return;
  if (!body) return; // media flood nahi pakdein (lightweight)

  const window = cleanFlood(from, sender);
  window.push(Date.now());
  if (window.length >= 5) {
    // flood!
    try { await sock.sendMessage(from, { delete: msg.key }); } catch {}
    const warns = window.length - 4; // 1 warn per excess
    if (warns >= 3) {
      floodStore[`${from}:${sender}`] = [];
      try {
        await sock.sendMessage(from, {
          text: `🚫 @${sender.split("@")[0]} ko spam flood par *KICK* kiya gaya!\n(5 messages / 10 seconds)`,
          mentions: [sender],
        });
        await sock.groupParticipantsUpdate(from, [sender], "remove");
      } catch {}
    } else {
      try {
        await sock.sendMessage(from, {
          text: `⚠️ @${sender.split("@")[0]} — *SPAM FLOOD WARNING ${warns}/3*!\n10 second mein 5+ messages = kick`,
          mentions: [sender],
        });
      } catch {}
    }
  }
};

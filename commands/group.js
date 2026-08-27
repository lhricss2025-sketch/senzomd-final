/**
 * SENZO MD — Advanced Group Commands
 * Kick, add, promote, demote, group open/close, grouplink, hidetag, tagall,
 * delete, setpp, getpp, antilink, antibot, antidelete, welcome/goodbye templates,
 * setwelcome, setbye, listwelcome, actwelcome, groupinfo, linkgc, revoke, desc, subject
 */
const db = require("../lib/database");

// NOTE: fresh regex literals per call — module-level /g regexes are STATEFUL
// (.test() flips true/false on repeated calls), which made anti-link checks
// randomly miss/trigger. These helpers are safe.
function hasWhatsAppLink(text) {
  return /(?:https?:\/\/)?(?:chat\.whatsapp\.com|wa\.me|whatsapp\.com)\/\S+/i.test(String(text || ""));
}
function hasChannelLink(text) {
  return /(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/\S+/i.test(String(text || ""));
}

// In-memory warn store: groupId:sender -> { warns, resetAt }
const warnStore = {};

function getWarns(groupId, sender) {
  const k = `${groupId}:${sender}`;
  const w = warnStore[k];
  if (!w) return 0;
  if (Date.now() > w.resetAt) { delete warnStore[k]; return 0; }
  return w.warns;
}

function addWarn(groupId, sender) {
  const k = `${groupId}:${sender}`;
  warnStore[k] = warnStore[k] || { warns: 0, resetAt: Date.now() + 24 * 60 * 60 * 1000 };
  warnStore[k].warns += 1;
  return warnStore[k].warns;
}
function removeWarns(groupId, sender) {
  delete warnStore[`${groupId}:${sender}`];
}

// Tagall chunking: bari lists ko WhatsApp text limit (4090) ke andar todta hai
function splitText(all, args, chunkSize) {
  const chunks = [];
  for (let i = 0; i < all.length; i += chunkSize) {
    const part = all.slice(i, i + chunkSize);
    let text = args ? `*${args} (${i + 1}-${i + part.length})*\n\n` : `*⚠️ EVERYONE ATTENTION! (${i + 1}-${i + part.length})*\n\n`;
    part.forEach((u, j) => { text += `${i + j + 1}. @${u.split("@")[0]}\n`; });
    chunks.push(text);
  }
  return chunks;
}

// ── Template placeholders:
// {@mention} = @user  | {@name} = pushName  | {@num} = number  | {@group} = group name  | {@time} = time
function renderTemplate(tpl, ctx) {
  return tpl
    .replaceAll("{@mention}", ctx.mention)
    .replaceAll("{@name}", ctx.name || "User")
    .replaceAll("{@num}", ctx.num)
    .replaceAll("{@group}", ctx.group || "")
    .replaceAll("{@time}", new Date().toLocaleString());
}

// Default premium-style templates
const DEFAULT_TEMPLATES = [
  { name: "🌟 Royal Welcome", text: "✨ *WELCOME TO THE FAMILY!* ✨\n\n👑 *{@name}*\n📱 {@num}\n\nHamare group *{@group}* mein aane ka shukriya!\n⏰ {@time}" },
  { name: "🎉 Party Welcome", text: "🎉 *YEY! NAYA MEMBER!* 🎉\n\n{@mention} aapka swagat hai!\n📲 {@num}\n\nRules follow karein aur enjoy karein 💃🕺" },
  { name: "💎 VIP Welcome", text: "💎 *VIP ENTRY DETECTED* 💎\n\n👤 *{@name}* joined\n📱 {@num}\n━━━━━━━━━━━━━\n🏰 *{@group}*\n🕐 {@time}" },
  { name: "🔥 Gangster Welcome", text: "🔥 *GHAMAND NHI APNAPAN* 🔥\n\n{@mention} — Group mein shamil!\n📱 {@num}\n\nMasti allowed, rules zaroori! 🤝" },
];

module.exports = [
  {
    name: "antilink", category: "group", desc: "Anti-link on/off/delete",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { args, reply, from, isOwner }) {
      if (!args) return reply(`*Current:* ${db.getGroupSetting(from, "antilink", "off")}\n*Usage:* .antilink on | delete | off`);
      db.setGroupSetting(from, "antilink", args);
      await reply(`✅ Anti-link ab *${args}* hai`);
    },
  },
  {
    name: "channelwarn", category: "group", desc: "Channel/group link auto-delete + 3 warns ke baad kick (on/off)",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { args, reply, from }) {
      if (!args) return reply(`*Current:* ${db.getGroupSetting(from, "channelwarn", true) ? "ON ✓" : "OFF ✗"}\n*Usage:* .channelwarn on | off`);
      db.setGroupSetting(from, "channelwarn", args === "on");
      await reply(`✅ Channel/Group link protection ab *${args === "on" ? "ON ✓" : "OFF ✗"}* hai\n_3 warnings ke baad automatic kick!_`);
    },
  },
  {
    name: "antibot", category: "group", desc: "Doosre bots ko kick karein (on/off)",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { args, reply, from }) {
      if (!args) return reply(`*Current:* ${db.getGroupSetting(from, "antibot", "off")}\n*Usage:* .antibot on | off`);
      db.setGroupSetting(from, "antibot", args === "on");
      await reply(`✅ Antibot ab *${args}* hai`);
    },
  },
  {
    name: "welcome", category: "group", desc: "Welcome message on/off",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { args, reply, from }) {
      if (!args) return reply(`*Current:* ${db.getGroupSetting(from, "welcome", "on")}\n*Usage:* .welcome on | off`);
      db.setGroupSetting(from, "welcome", args === "on");
      await reply(`✅ Welcome ab *${args}* hai`);
    },
  },
  {
    name: "goodbye", aliases: ["leave"], category: "group", desc: "Goodbye message on/off (admin — bot leave nahi karega)",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { args, reply, from }) {
      if (!args) return reply(`*Current:* ${db.getGroupSetting(from, "goodbye", "on")}\n*Usage:* .goodbye on | off`);
      db.setGroupSetting(from, "goodbye", args === "on");
      await reply(`✅ Goodbye message ab *${args}* hai`);
    },
  },
  {
    name: "setwelcome", category: "group", desc: "Welcome template set karein (premium)",
    groupOnly: true, adminRequired: true,
    premiumOnly: true,
    async execute(sock, msg, store, { args, reply, from, isOwner }) {
      if (!args) {
        let txt = "🎨 *Premium Welcome Templates*\n━━━━━━━━━━━━━━━\n\n";
        DEFAULT_TEMPLATES.forEach((t, i) => { txt += `${i + 1}. *${t.name}*\n${t.text}\n\n`; });
        txt += "━━━━━━━━━━━━━━━\n*Custom banaein:* `.setwelcome <apna message>`\nPlaceholders: `{@mention} {@name} {@num} {@group} {@time}`\n*Default choose karein:* `.setwelcome 1` (ya 2,3,4)";
        return reply(txt);
      }
      const idx = Number(args) - 1;
      if (!isNaN(idx) && DEFAULT_TEMPLATES[idx]) {
        db.addWelcomeTemplate(from, DEFAULT_TEMPLATES[idx].name, DEFAULT_TEMPLATES[idx].text);
        await reply(`✅ Template *${DEFAULT_TEMPLATES[idx].name}* set ho gaya!\nActivate karne ke liye: .actwelcome`);
      } else {
        db.addWelcomeTemplate(from, "Custom", args);
        await reply("✅ *Custom welcome template* add ho gaya!\nActivate karne ke liye: .actwelcome");
      }
    },
  },
  {
    name: "setbye", aliases: ["setgoodbye"], category: "group", desc: "Goodbye template set karein (premium)",
    groupOnly: true, adminRequired: true,
    premiumOnly: true,
    async execute(sock, msg, store, { args, reply, from }) {
      if (!args) {
        const defaultBye = "👋 *GOODBYE!*\n\n{@mention} ne group chhor diya\n📱 {@num}\n━━━━━━━━━━━━━━━\n🏰 *{@group}*\n🕐 {@time}";
        db.addWelcomeTemplate(from + ":bye", "Default Bye", defaultBye);
        return reply("✅ Default *goodbye template* add ho gaya!\nActivate: .actbye\nCustom: `.setbye <apna message>` (placeholders: {@mention} {@name} {@num} {@group} {@time})");
      }
      db.addWelcomeTemplate(from + ":bye", "Custom Bye", args);
      await reply("✅ *Custom goodbye template* add ho gaya!\nActivate: .actbye");
    },
  },
  {
    name: "warn", category: "group", desc: "Member ko warn karein — 3 warns par auto kick",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { reply, from, isOwner }) {
      const target = msg.message?.extendedTextMessage?.contextInfo?.participant ||
        (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [])[0];
      if (!target) return reply("*Usage:* kisi message par reply karke `.warn` likhein\n\n⚠️ 3 warns = auto kick (24 ghante ke andar)\n_Bot ka admin hona zaroori hai_");
      const total = addWarn(from, target);
      if (total >= 3) {
        removeWarns(from, target);
        try {
          await sock.groupParticipantsUpdate(from, [target], "remove");
          await reply(`⚠️ @${target.split("@")[0]} *KICKED* — 3 warns complete\n_(Reason: 3 warns rule)_`, { mentions: [target] });
        } catch {
          await reply(`⚠️ @${target.split("@")[0]} ke 3 warns complete ho gaye — kick ke liye bot ko admin banayein`, { mentions: [target] });
        }
      } else {
        await reply(`⚠️ *WARN ${total}/3* — @${target.split("@")[0]}\n_Aur 1 warning milne par auto kick hoga (24h window)_`, { mentions: [target] });
      }
    },
  },
  {
    name: "warnings", aliases: ["checkwarn"], category: "group", desc: "Member ke warns check karein",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { reply, from }) {
      const target = msg.message?.extendedTextMessage?.contextInfo?.participant ||
        (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [])[0];
      if (!target) return reply("*Usage:* kisi message par reply karke `.warnings` likhein");
      const w = getWarns(from, target);
      await reply(`📋 *WARN STATUS*\n\n👤 @${target.split("@")[0]}\n⚠️ Warns: *${w}/3*\n_Agar 3 ho gaye toh auto kick (24h window)_`, { mentions: [target] });
    },
  },
  {
    name: "resetwarn", aliases: ["resetwarns"], category: "group", desc: "Member ke warns reset karein",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { reply, from }) {
      const target = msg.message?.extendedTextMessage?.contextInfo?.participant ||
        (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [])[0];
      if (!target) return reply("*Usage:* kisi message par reply karke `.resetwarn` likhein");
      removeWarns(from, target);
      await reply(`✅ Warns reset ho gaye — @${target.split("@")[0]} (0/3)`, { mentions: [target] });
    },
  },
  {
    name: "bye", category: "group", desc: "Goodbye templates ki list dekhein",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { reply, from }) {
      const tpls = db.listWelcomeTemplates(from + ":bye");
      if (!tpls.length) return reply("❌ Koi goodbye template nahi hai.\n\nAdd karein: `.setbye` (default) ya `.setbye <apna message>`\nActivate: `.actbye`");
      const act = db.getActiveWelcomeTemplate(from + ":bye");
      let txt = "📋 *GOODBYE TEMPLATES*\n━━━━━━━━━━━━━━━\n";
      tpls.forEach((t, i) => { txt += `${act === i ? "🔹" : "🔸"} #${i + 1} — ${t.name}\n`; });
      txt += "\nActivate: `.actbye <number>`\nCustom: `.setbye <message>`";
      await reply(txt);
    },
  },
  {
    name: "actwelcome", category: "group", desc: "Welcome template activate karein",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { args, reply, from }) {
      const tpls = db.listWelcomeTemplates(from);
      if (!tpls.length) return reply("❌ Pehle `.setwelcome` se template add karein");
      const idx = args ? Number(args) - 1 : 0;
      if (!tpls[idx]) return reply("❌ Template number galat hai");
      db.setWelcomeTemplate(from, idx);
      await reply(`✅ Welcome template *#${idx + 1} (${tpls[idx].name})* activate ho gaya`);
    },
  },
  {
    name: "actbye", category: "group", desc: "Goodbye template activate karein",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { args, reply, from }) {
      const tpls = db.listWelcomeTemplates(from + ":bye");
      if (!tpls.length) return reply("❌ Pehle `.setbye` se template add karein");
      const idx = args ? Number(args) - 1 : 0;
      if (!tpls[idx]) return reply("❌ Template number galat hai");
      db.setWelcomeTemplate(from + ":bye", idx);
      await reply(`✅ Goodbye template *#${idx + 1} (${tpls[idx].name})* activate ho gaya`);
    },
  },
  {
    name: "listwelcome", category: "group", desc: "Set kiye gaye templates dekhein",
    groupOnly: true,
    async execute(sock, msg, store, { reply, from }) {
      const w = db.listWelcomeTemplates(from);
      const b = db.listWelcomeTemplates(from + ":bye");
      let txt = "📋 *Templates:*\n\n*Welcome:*\n";
      w.forEach((t, i) => { txt += `${i + 1}. ${t.name}\n`; });
      txt += "\n*Goodbye:*\n";
      b.forEach((t, i) => { txt += `${i + 1}. ${t.name}\n`; });
      if (!w.length && !b.length) txt += "_Koi template nahi — .setwelcome / .setbye use karein_";
      await reply(txt);
    },
  },
  {
    name: "kick", aliases: ["k"], category: "group", desc: "Member ko kick karein (reply/mention)",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { args, reply, from, isOwner }) {
      const m = msg.message;
      const type = Object.keys(m)[0];
      const quoted = m[type]?.contextInfo?.quotedMessage;
      let target = quoted ? m[type].contextInfo.participant : (args ? args.replace(/[^0-9]/g, "") + "@s.whatsapp.net" : null);
      if (!target) return reply("*Usage:* member ko mention/reply karke `.kick` likhein");
      await sock.groupParticipantsUpdate(from, [target], "remove");
      await reply("👢 Member kick ho gaya");
    },
  },
  {
    name: "add", category: "group", desc: "Member add karein",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { args, reply, from }) {
      if (!args) return reply("*Usage:* .add 923XXXXXXXXXX");
      const jid = args.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
      await sock.groupParticipantsUpdate(from, [jid], "add");
      await reply(`✅ Add request bhej di: ${jid.split("@")[0]}`);
    },
  },
  {
    name: "promote", aliases: ["makeadmin"], category: "group", desc: "Admin banayein",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { args, reply, from }) {
      const m = msg.message;
      const type = Object.keys(m)[0];
      const quoted = m[type]?.contextInfo?.quotedMessage;
      const target = quoted ? m[type].contextInfo.participant : (args ? args.replace(/[^0-9]/g, "") + "@s.whatsapp.net" : null);
      if (!target) return reply("*Usage:* member ko mention/reply karke `.promote` likhein");
      await sock.groupParticipantsUpdate(from, [target], "promote");
      await reply("⬆️ Admin bana diya");
    },
  },
  {
    name: "demote", category: "group", desc: "Admin hataein",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { args, reply, from }) {
      const m = msg.message;
      const type = Object.keys(m)[0];
      const quoted = m[type]?.contextInfo?.quotedMessage;
      const target = quoted ? m[type].contextInfo.participant : (args ? args.replace(/[^0-9]/g, "") + "@s.whatsapp.net" : null);
      if (!target) return reply("*Usage:* member ko mention/reply karke `.demote` likhein");
      await sock.groupParticipantsUpdate(from, [target], "demote");
      await reply("⬇️ Admin hata diya");
    },
  },
  {
    name: "group", aliases: ["gc"], category: "group", desc: "Group open/close",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { args, reply, from }) {
      if (args === "open") { await sock.groupSettingUpdate(from, "not_announcement"); await reply("🔓 Group open"); }
      else if (args === "close") { await sock.groupSettingUpdate(from, "announcement"); await reply("🔒 Group close"); }
      else await reply("*Usage:* .group open | close");
    },
  },
  {
    name: "lockgc", category: "group", desc: "Sirf admins message bhej sakte hain (lock/unlock)",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { args, reply, from }) {
      if (args === "on") { await sock.groupSettingUpdate(from, "locked"); await reply("🔒 Group locked — sirf admins message bhej sakte hain"); }
      else if (args === "off") { await sock.groupSettingUpdate(from, "unlocked"); await reply("🔓 Group unlocked"); }
      else await reply("*Usage:* .lockgc on | off");
    },
  },
  {
    name: "grouplink", aliases: ["linkgc"], category: "group", desc: "Group invite link",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { reply, from }) {
      const code = await sock.groupInviteCode(from);
      await reply(`🔗 https://chat.whatsapp.com/${code}`);
    },
  },
  {
    name: "revoke", aliases: ["resetlink"], category: "group", desc: "Group link reset karein",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { reply, from }) {
      await sock.groupRevokeInvite(from);
      await reply("✅ Purana link revoke ho gaya — naya link `.grouplink` se lein");
    },
  },
  {
    name: "hidetag", aliases: ["htag"], category: "group", desc: "Sabko bina tag ke notify karein",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { args, reply, from }) {
      if (!args) return reply("*Usage:* .hidetag <message>");
      const meta = await sock.groupMetadata(from);
      const mentions = meta.participants.map((p) => p.id);
      await sock.sendMessage(from, { text: args, mentions });
    },
  },
  {
    name: "tagall", aliases: ["everyone"], category: "group", desc: "Sabko tag karein — all restrictions bypass",
    groupOnly: true,
    async execute(sock, msg, store, { args, reply, from }) {
      const meta = await sock.groupMetadata(from);
      const all = meta.participants.map((p) => p.id);
      let text = args ? `*${args}*\n\n` : "*⚠️ EVERYONE ATTENTION!*\n\n";
      all.forEach((u, i) => { text += `${i + 1}. @${u.split("@")[0]}\n`; });
      text += `\n━━━━━━━━━━━━━\n_(All restrictions bypass — har member notified: ${all.length})_`;
      // Restrictions bypass: official mentions + hidden/text mentions dono — WhatsApp ki koi bhi
      // mention-restriction in dono se bypass hoti hai aur har user ko notification jata hai
      const chunks = text.length > 4090 ? splitText(all, args, 100) : [text];
      for (const chunk of chunks) {
        await sock.sendMessage(from, { text: chunk, mentions: all });
      }
    },
  },
  {
    name: "delete", aliases: ["del"], category: "group", desc: "Kisi ka message delete karein (admin/owner)",
    groupOnly: true,
    async execute(sock, msg, store, { reply, from, isOwner }) {
      const m = msg.message;
      const type = Object.keys(m)[0];
      const quoted = m[type]?.contextInfo?.quotedMessage;
      if (!quoted) return reply("*Usage:* kisi message ko reply karke `.del` likhein");
      const remote = m[type].contextInfo.remoteJid;
      const key = {
        remoteJid: remote,
        fromMe: m[type].contextInfo.fromMe === true,
        id: m[type].contextInfo.stanzaId,
        participant: m[type].contextInfo.participant,
      };
      try {
        if (isOwner) await sock.sendMessage(remote, { delete: key });
        else {
          const meta = await sock.groupMetadata(from);
          const isAdmin = meta.participants.find((p) => p.id === msg.key.participant)?.admin;
          if (isAdmin) await sock.sendMessage(remote, { delete: key });
          else await reply("*Yeh command admin/owner ke liye hai!*");
        }
      } catch {
        await reply("❌ Delete nahi ho saka");
      }
    },
  },
  {
    name: "setpp", category: "owner", desc: "Group/profile picture (owner)",
    ownerOnly: true,
    async execute(sock, msg, store, { reply, from }) {
      const m = msg.message;
      const type = Object.keys(m)[0];
      const quoted = m[type]?.contextInfo?.quotedMessage;
      let buf = null;
      try {
        if (quoted?.imageMessage) buf = await sock.downloadMediaMessage({ message: { imageMessage: quoted.imageMessage } });
        else if (type === "imageMessage") buf = await sock.downloadMediaMessage(msg);
      } catch { buf = null; }
      if (!buf) return reply("*Usage:* image reply karke `.setpp` (group mein = group dp, PM mein = bot dp)");
      const target = from.endsWith("@g.us") ? from : (sock.user?.id || "");
      await sock.updateProfilePicture(target, buf);
      await reply("✅ Picture update ho gayi");
    },
  },
  {
    name: "getpp", category: "group", desc: "Kisi ki profile picture",
    async execute(sock, msg, store, { args, reply, from, sendImage }) {
      const m = msg.message;
      const type = Object.keys(m)[0];
      const quoted = m[type]?.contextInfo?.quotedMessage;
      const jid = quoted ? m[type].contextInfo.participant : (args ? args.replace(/[^0-9]/g, "") + "@s.whatsapp.net" : from);
      try {
        const url = await sock.profilePictureUrl(jid, "image");
        const axios = require("axios");
        const r = await axios.get(url, { responseType: "arraybuffer" });
        await sendImage(Buffer.from(r.data));
      } catch {
        await reply("❌ Profile picture nahi mili");
      }
    },
  },
  {
    name: "groupinfo", aliases: ["gcinfo", "ginfo"], category: "group", desc: "Group ki full info",
    groupOnly: true,
    async execute(sock, msg, store, { reply, from }) {
      const meta = await sock.groupMetadata(from);
      const owner = meta.owner ? meta.owner.split("@")[0] : "N/A";
      const admins = meta.participants.filter((p) => p.admin).length;
      let text = `🏰 *GROUP INFO*\n━━━━━━━━━━━━━━━\n`;
      text += `📛 *${meta.subject}*\n`;
      text += `🆔 ID: ${from}\n`;
      text += `👥 Members: ${meta.participants.length}\n`;
      text += `👑 Admins: ${admins}\n`;
      text += `👤 Owner: ${owner}\n`;
      text += `📅 Created: ${new Date(meta.creation * 1000).toLocaleDateString()}\n`;
      if (meta.desc) text += `📝 Description: ${meta.desc.slice(0, 300)}\n`;
      text += "━━━━━━━━━━━━━━━";
      await reply(text);
    },
  },
  {
    name: "desc", category: "group", desc: "Group description change (admin/owner)",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { args, reply, from, isOwner }) {
      if (!args) return reply("*Usage:* .desc <naya description>");
      await sock.groupUpdateDescription(from, args);
      await reply("✅ Group description update ho gayi");
    },
  },
  {
    name: "subject", category: "group", desc: "Group ka naam change (admin/owner)",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { args, reply, from }) {
      if (!args) return reply("*Usage:* .subject <naya naam>");
      await sock.groupUpdateSubject(from, args);
      await reply("✅ Group ka naam update ho gaya");
    },
  },
  {
    name: "mute", aliases: ["muteuser"], category: "group", desc: "User ko restrict karein (sirf admins message bhej sakte hain nahi — settings)",
    groupOnly: true, adminRequired: true,
    async execute(sock, msg, store, { reply }) {
      await reply("*Yeh group setting group open/close se hoti hai:*\n`.group close` — sab mute\n`.group open` — sab unmute\nIndividual mute ke liye `.kick` use karein.");
    },
  },
];

// ── Watchers: anti-link, antibot, welcome, goodbye ──
async function antiLinkWatch(sock, msg, store, ctx) {
  const { from, body, isGroup, isOwner, sender } = ctx;
  if (!isGroup || isOwner || !body) return;
  const state = db.getGroupSetting(from, "antilink", "off");
  if (state === "off") return;
  const botMeta = await sock.groupMetadata(from).catch(() => null);
  if (!botMeta) return;
  const botId = (sock.user?.id || "").split(":")[0] + "@s.whatsapp.net";
  const isBotAdmin = botMeta.participants.find((p) => p.id === botId)?.admin;
  if (!isBotAdmin) return;
  const senderMeta = botMeta.participants.find((p) => p.id === sender);
  if (senderMeta?.admin) return;
  if (!hasWhatsAppLink(body)) return;

  if (state === "delete") {
    try {
      await sock.sendMessage(from, { delete: msg.key });
      await sock.sendMessage(from, { text: `⚠️ @${sender.split("@")[0]} Link bhejna mana hai!`, mentions: [sender] });
    } catch {}
  } else if (state === "on") {
    try {
      await sock.sendMessage(from, { delete: msg.key });
      await sock.groupParticipantsUpdate(from, [sender], "remove");
      await sock.sendMessage(from, { text: `🚫 @${sender.split("@")[0]} link ki wajah se kick ho gaya`, mentions: [sender] });
    } catch {}
  }
}

async function antiBotWatch(sock, msg, store, ctx) {
  const { from, isGroup, isOwner, sender } = ctx;
  if (!isGroup || isOwner) return;
  if (!db.getGroupSetting(from, "antibot", false)) return;
  if (!sender.endsWith("bot")) return; // detect bots via JID suffix
  const botMeta = await sock.groupMetadata(from).catch(() => null);
  if (!botMeta) return;
  const botId = (sock.user?.id || "").split(":")[0] + "@s.whatsapp.net";
  if (botMeta.participants.find((p) => p.id === botId)?.admin) {
    try { await sock.groupParticipantsUpdate(from, [sender], "remove"); } catch {}
  }
}

async function welcomeWatcher(sock, data) {
  // data: { id, participants, action }
  const groupId = data.id;
  const action = data.action; // add | remove
  const templateKey = action === "remove" ? groupId + ":bye" : groupId;

  if (action === "add" && !db.getGroupSetting(groupId, "welcome", true)) return;
  if (action === "remove" && !db.getGroupSetting(groupId, "goodbye", true)) return;

  for (const p of (data.participants || [])) {
    if (p === (sock.user?.id || "").split(":")[0] + "@s.whatsapp.net") continue;
    const tpl = db.getWelcomeTemplate(templateKey);
    if (!tpl) continue;
    const meta = await sock.groupMetadata(groupId).catch(() => null);
    const pushName = meta?.participants?.find((x) => x.id === p)?.notify || p.split("@")[0];
    const text = renderTemplate(tpl.text, {
      mention: `@${p.split("@")[0]}`,
      name: pushName,
      num: p.split("@")[0],
      group: meta?.subject || "",
    });
    try {
      await sock.sendMessage(groupId, { text, mentions: [p] });
    } catch {}
  }
}

// ── Channel/Group link protection with 3-warning kick ──
async function channelLinkWatch(sock, msg, store, ctx) {
  const { from, body, isGroup, isOwner, sender } = ctx;
  if (!isGroup || isOwner || !body) return;
  const state = db.getGroupSetting(from, "channelwarn", true);
  if (!state) return;
  // message mein channel/group link hai?
  const hasChannel = hasChannelLink(body);
  const hasGroup = hasWhatsAppLink(body);
  if (!hasChannel && !hasGroup) return;

  const botId = (sock.user?.id || "").split(":")[0] + "@s.whatsapp.net";
  const meta = await sock.groupMetadata(from).catch(() => null);
  if (!meta) return;
  const isBotAdmin = meta.participants.find((p) => p.id === botId)?.admin;
  if (!isBotAdmin) return;
  const senderMeta = meta.participants.find((p) => p.id === sender);
  if (senderMeta?.admin) return; // admins par apply nahi

  // message delete
  try { await sock.sendMessage(from, { delete: msg.key }); } catch {}

  const warns = addWarn(from, sender);
  if (warns >= 3) {
    resetWarn(from, sender);
    try {
      await sock.sendMessage(from, {
        text: `🚫 @${sender.split("@")[0]} ko *3 warnings* mil chuki hain — group link/channel link share karne par KICK!`,
        mentions: [sender],
      });
      await sock.groupParticipantsUpdate(from, [sender], "remove");
    } catch {}
  } else {
    const remaining = 3 - warns;
    await sock.sendMessage(from, {
      text: `⚠️ *WARNING ${warns}/3*\n\n@${sender.split("@")[0]} — Channel/Group link share karna mana hai!\n🚨 ${remaining} warning aur → *kick*`,
      mentions: [sender],
    });
  }
}

module.exports.antiLinkWatch = antiLinkWatch;
module.exports.antiBotWatch = antiBotWatch;
module.exports.welcomeWatcher = welcomeWatcher;
module.exports.channelLinkWatch = channelLinkWatch;

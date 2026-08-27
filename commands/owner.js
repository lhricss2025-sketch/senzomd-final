/**
 * Owner: .owner, .broadcast, .premium add/remove/list, .ban, .unban,
 *        .mode, .restart, .block, .unblock, .joingc, .leave
 */
const db = require("../lib/database");
const { OWNER_NUMBER, CHANNEL_URL } = require("../lib/config");

module.exports = [
  {
    name: "ping", aliases: ["speed", "server"], category: "tools", desc: "Bot ki response speed (ms)",
    async execute(sock, msg, store, { reply }) {
      const start = Date.now();
      await reply("🏓 *PING...*");
      const ms = Date.now() - start;
      const emoji = ms < 200 ? "⚡ Fast" : ms < 500 ? "🟢 Good" : ms < 1000 ? "🟡 Okay" : "🔴 Slow";
      await reply(`🏓 *PONG!*
━━━━━━━━━━━━━
⚡ Speed: *${ms}ms*
📶 Status: ${emoji}
🕐 Uptime: ${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m
━━━━━━━━━━━━━
*SENZO MD* ✓`);
    },
  },
  {
    name: "owner", category: "other", desc: "Owner info",
    async execute(sock, msg, store, { reply }) {
      await reply(
        `👑 *Owner Info*\n` +
        `━━━━━━━━━━━━━━━\n` +
        `📱 Number: wa.me/${OWNER_NUMBER}\n` +
        `✈️ Channel: ${CHANNEL_URL}\n` +
        `━━━━━━━━━━━━━━━\n` +
        `*${"S E N Z O  M D"}*`
      );
    },
  },
  {
    name: "broadcast", aliases: ["bc"], category: "owner", desc: "Sab groups/users mein message bhejein (owner)",
    ownerOnly: true,
    async execute(sock, msg, store, { args, reply }) {
      if (!args) return reply("*Usage:* .broadcast <message>");
      const chats = await sock.groupFetchAllParticipating().catch(() => ({}));
      let sent = 0;
      await reply("📡 Broadcast shuru...");
      for (const g of Object.values(chats)) {
        try {
          await sock.sendMessage(g.id, { text: `*📢 BROADCAST:*\n\n${args}` });
          sent++;
        } catch {}
      }
      await reply(`✅ Broadcast complete — ${sent} groups`);
    },
  },
  {
    name: "premium", category: "owner", desc: "Premium manage karein (owner)",
    ownerOnly: true,
    async execute(sock, msg, store, { args, reply }) {
      const [sub, target, days] = args.split(/\s+/);
      if (sub === "add" && target && days) {
        db.addPremium(target.replace(/[^0-9]/g, ""), Number(days));
        return reply(`✅ Premium added: ${target} for ${days} days`);
      }
      if (sub === "remove" && target) {
        db.removePremium(target.replace(/[^0-9]/g, ""));
        return reply(`✅ Premium removed: ${target}`);
      }
      if (sub === "list") {
        const all = db.premiumList();
        let txt = "👑 *Premium List:*\n";
        for (const u of all) txt += `• ${u.id}\n`;
        return reply(all.length ? txt : "👑 *Premium List:*\n_Koi premium user nahi hai_");
      }
      if (sub === "check") {
        const left = db.premiumLeft(target.replace(/[^0-9]/g, ""));
        return reply(db.isPremium(target.replace(/[^0-9]/g, ""))
          ? `✅ Premium active — ${Math.round(left / 86400000)} days left`
          : "❌ Premium not active");
      }
      await reply("*Usage:*\n`.premium add 923000000000 30`\n`.premium remove 923000000000`\n`.premium list`\n`.premium check 923000000000`");
    },
  },
  {
    name: "ban", category: "owner", desc: "User ban (owner)",
    ownerOnly: true,
    async execute(sock, msg, store, { args, reply, from }) {
      const m = msg.message;
      const type = Object.keys(m)[0];
      const quoted = m[type]?.contextInfo?.quotedMessage;
      const target = quoted ? m[type].contextInfo.participant : (args ? args.replace(/[^0-9]/g, "") + "@s.whatsapp.net" : null);
      if (!target) return reply("*Usage:* user reply karke `.ban` likhein ya number dein");
      db.addBan(target);
      await reply(`🚫 Banned: ${target.split("@")[0]}`);
    },
  },
  {
    name: "unban", category: "owner", desc: "User unban (owner)",
    ownerOnly: true,
    async execute(sock, msg, store, { args, reply }) {
      const target = args ? args.replace(/[^0-9]/g, "") + "@s.whatsapp.net" : null;
      if (!target) return reply("*Usage:* .unban 923000000000");
      db.removeBan(target);
      await reply(`✅ Unbanned: ${target.split("@")[0]}`);
    },
  },
  {
    name: "mode", category: "owner", desc: "Bot mode: public/private (owner)",
    ownerOnly: true,
    async execute(sock, msg, store, { args, reply }) {
      if (!args) return reply(`*Current mode:* ${db.getBotSetting("mode", "public")}\n*Usage:* .mode public | private`);
      db.setBotSetting("mode", args);
      await reply(`✅ Mode set: *${args}*`);
    },
  },
  {
    name: "restart", aliases: ["reboot"], category: "owner", desc: "Bot restart (owner)",
    ownerOnly: true,
    async execute(sock, msg, store, { reply }) {
      await reply("🔄 Restarting SENZO MD...");
      setTimeout(() => process.exit(0), 1500);
    },
  },
  {
    name: "block", category: "owner", desc: "User block (owner)",
    ownerOnly: true,
    async execute(sock, msg, store, { args, reply }) {
      const m = msg.message;
      const type = Object.keys(m)[0];
      const quoted = m[type]?.contextInfo?.quotedMessage;
      const target = quoted ? m[type].contextInfo.participant : (args ? args.replace(/[^0-9]/g, "") + "@s.whatsapp.net" : null);
      if (!target) return reply("*Usage:* user reply karke `.block` likhein");
      await sock.updateBlockStatus(target, "block");
      await reply(`🚫 Blocked: ${target.split("@")[0]}`);
    },
  },
  {
    name: "unblock", category: "owner", desc: "User unblock (owner)",
    ownerOnly: true,
    async execute(sock, msg, store, { args, reply }) {
      const target = args ? args.replace(/[^0-9]/g, "") + "@s.whatsapp.net" : null;
      if (!target) return reply("*Usage:* .unblock 923000000000");
      await sock.updateBlockStatus(target, "unblock");
      await reply(`✅ Unblocked: ${target.split("@")[0]}`);
    },
  },
  {
    name: "joingc", category: "owner", desc: "Group link se join (owner) — 'join' naam referral command ka hai",
    ownerOnly: true,
    async execute(sock, msg, store, { args, reply }) {
      if (!args || !args.includes("chat.whatsapp.com")) return reply("*Usage:* .joingc <group link>");
      const code = args.split("/").pop();
      await sock.groupAcceptInvite(code);
      await reply("✅ Group join ho gaya");
    },
  },
  {
    name: "leave", aliases: ["leftgc"], category: "owner", desc: "Group chhorein (owner)",
    ownerOnly: true,
    async execute(sock, msg, store, { args, reply, from, isGroup }) {
      if (!isGroup) return reply("*Yeh command sirf group mein chalega!*");
      await reply("👋 Group chhor raha hoon...");
      await sock.groupLeave(from);
    },
  },
  {
    name: "blocklist", aliases: ["blocked"], category: "owner", desc: "Banned users list (owner)",
    ownerOnly: true,
    async execute(sock, msg, store, { reply }) {
      const all = db.bannedList();
      let txt = "🚫 *Banned List:*\n";
      for (const k of all) txt += `• ${k.split("@")[0]}\n`;
      await reply(all.length ? txt : "🚫 *Banned List:*\n_Koi banned nahi hai_");
    },
  },
  {
    name: "public", aliases: ["pub"], category: "owner", desc: "User/group ka scope public karein — sab ke commands par bot respond kare (owner)",
    ownerOnly: true,
    async execute(sock, msg, store, { args, reply, from, isGroup }) {
      if (!args) {
        // bina args: jis chat mein likha usko public
        const target = isGroup ? from : (msg.key.participant || from);
        db.setUserScope(target, "public");
        await reply("✅ Scope *PUBLIC* — ab sab ke commands par respond hoga");
      } else {
        const target = args.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
        db.setUserScope(target, "public");
        await reply(`✅ *${target.split("@")[0]}* public mode mein — bot ab sab par respond karega`);
      }
    },
  },
  {
    name: "private", aliases: ["priv"], category: "owner", desc: "User/group ka scope private karein — sirf apni commands par bot respond kare (owner)",
    ownerOnly: true,
    async execute(sock, msg, store, { args, reply, from, isGroup }) {
      if (!args) {
        const target = isGroup ? from : (msg.key.participant || from);
        db.setUserScope(target, "private");
        await reply("🔒 Scope *PRIVATE* — ab yahan sirf OWNER ki commands par respond hoga");
      } else {
        const target = args.replace(/[^0-9]/g, "") + "@s.whatsapp.net";
        db.setUserScope(target, "private");
        await reply(`🔒 *${target.split("@")[0]}* private mode mein — bot ab sirf owner ki commands par respond karega`);
      }
    },
  },
];

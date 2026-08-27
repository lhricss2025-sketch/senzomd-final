/**
 * .menu — SENZO MD premium UI menu (redesigned)
 * Modern look: angled borders, badge icons, compact rows, fancy header/footer
 */
const fs = require("fs");
const path = require("path");
const { cmds } = require("../lib/whatsapp");
const db = require("../lib/database");
const { fancyName, ds } = require("../utils/styling");
const { BOT_NAME, PREFIX, OWNER_NUMBER, CHANNEL_URL, OWNER_HANDLE } = require("../lib/config");

module.exports = {
  name: "menu",
  aliases: ["m", "commands", "allmenu", "help"],
  desc: "Bot ka complete menu",
  category: "other",
  async execute(sock, msg, store, { from, sender, isOwner, reply, sendImage }) {
    // unique commands only (aliases share the same command object)
    const seen = new Set();
    const allCmds = [];
    for (const c of Object.values(cmds)) {
      if (!seen.has(c.name)) { seen.add(c.name); allCmds.push(c); }
    }
    const total = allCmds.length;
    const uptime = process.uptime();
    const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60), s = Math.floor(uptime % 60);

    const cats = {};
    for (const c of allCmds) {
      const cat = c.category || "other";
      cats[cat] = cats[cat] || [];
      cats[cat].push(c);
    }

    // ── Premium header (angled banner) ──
    let text =
`┏━━━━━━━━━━━━━━━━━━━━┓
┃  ⚡ *${ds("S E N Z O")}* ${ds("M D")} ⚡  ┃
┃  ━━━━━━━━━━━━━━━━━━  ┃
┃  🏆 _ULTRA EDITION_ 🏆  ┃
┗━━━━━━━━━━━━━━━━━━━━┛
`;

    // ── Info strip (compact, styled) ──
    text +=
`╭──────────────────╮
│ 👑 *Owner:* ${OWNER_HANDLE}
│ 🔖 *Edition:* ${ds("ULTRA")} • ${ds("FOREVER FREE")}
│ 🕐 *Online:* ${h}h ${m}m ${s}s
│ ⚡ *Commands:* ${ds(String(total))}
│ 📶 *Mode:* ${db.getBotSetting("mode", "public").toUpperCase()}
│ 🎫 *Premium:* ${db.isPremium(sender) ? ds("ACTIVE ✓") : "INACTIVE ✗"}
╰──────────────────╯
`;

    const catInfo = {
      download: { icon: "⬇️", label: "DOWNLOADERS", color: "🔴" },
      ai: { icon: "🤖", label: "AI BRAIN", color: "🟣" },
      sticker: { icon: "🎴", label: "STICKER LAB", color: "🟡" },
      group: { icon: "👥", label: "GROUP ARSENAL", color: "🟢" },
      fun: { icon: "🎉", label: "FUN ZONE", color: "🩷" },
      games: { icon: "🎮", label: "GAMES & COINS", color: "🟠" },
      tools: { icon: "🛠", label: "TOOLBOX", color: "🔵" },
      owner: { icon: "👑", label: "ROYAL CMDS", color: "👑" },
      islamic: { icon: "🕌", label: "ISLAMIC ZONE", color: "🟢" },
      hacker: { icon: "💀", label: "HACKER TOOLS", color: "⚫" },
      osint: { icon: "🕵", label: "OSINT ZONE", color: "🔵" },
      other: { icon: "📦", label: "OTHER", color: "⚪" },
    };

    let n = 0;
    for (const cat of Object.keys(cats)) {
      const info = catInfo[cat] || { icon: "📦", label: cat.toUpperCase(), color: "⚪" };
      text += `\n╭──═❖ ${info.icon} *${info.label}* ❖═──╮\n`;
      cats[cat].forEach((c) => {
        n++;
        const prem = c.premiumOnly ? " 👑" : "";
        const grp = c.groupOnly ? " 🏰" : "";
        const arrow = (n % 3 === 0) ? "▸" : "◈";
        text += `│ ${arrow} *${PREFIX}${c.name}*${prem}${grp}\n`;
      });
      text += `╰──────────────────╯`;
    }

    // ── Premium footer ──
    text += `
┏━━━━━━━━━━━━━━━━━━━━┓
┃  👑 = Premium  🏰 = Group ┃
┃  ➜ Owner: *${OWNER_HANDLE}*  ┃
┃  ➜ Channel: *Senzo* ✓   ┃
┃  ${CHANNEL_URL.split("channel/")[1] ? "✦ Join & Support! ✦" : ""}  ┃
┗━━━━━━━━━━━━━━━━━━━━┛
`;

    const menuPic = db.getMedia("whatsapp_menu");
    try {
      if (menuPic?.type === "photo") {
        await sock.sendMessage(from, { image: menuPic.buffer, caption: text }, { quoted: msg });
      } else {
        const thumb = path.join(__dirname, "..", "media", "thumb.png");
        if (fs.existsSync(thumb)) {
          await sock.sendMessage(from, { image: fs.readFileSync(thumb), caption: text }, { quoted: msg });
        } else {
          await reply(text);
        }
      }
    } catch {
      await reply(text);
    }
  },
};

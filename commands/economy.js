/**
 * SENZO MD — Economy System: .daily, .balance, .give, .leaderboard
 * Lifetime free — apna coin system, database based
 */
const db = require("../lib/database");

function topUsers(n) {
  try {
    const users = db.listUsers();
    return Object.entries(users)
      .filter(([, u]) => u.coins > 0)
      .sort((a, b) => b[1].coins - a[1].coins)
      .slice(0, n)
      .map((e, i) => `#${i + 1} @${e[0].split("@")[0]} — ${e[1].coins} coins`);
  } catch { return []; }
}

module.exports = [
  {
    name: "daily", category: "fun", desc: "Rozana 100 coins collect karein 🎁",
    async execute(sock, msg, store, { reply, sender }) {
      const u = db.getUser(sender);
      const now = new Date().toDateString();
      if (u.lastDaily === now) {
        const left = 24 * 3600 - Math.floor((Date.now() - u.dailyAt) / 1000);
        const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60);
        return await reply(`⏳ Aapne aaj daily collect kar liya!\nAgle reward mein: *${h}h ${m}m*`);
      }
      const reward = 100 + Math.floor(Math.random() * 50);
      db.addCoins(sender, reward);
      u.lastDaily = now;
      u.dailyAt = Date.now();
      db.saveUser(sender, u);
      await reply(`🎁 *Daily Reward: +${reward} coins!*\n💰 Total balance: *${db.getCoins(sender)}*\n_Kal phir aana!_`);
    },
  },
  {
    name: "balance", aliases: ["bal", "coins", "coin"], category: "fun", desc: "Apna coin balance dekhain 💰",
    async execute(sock, msg, store, { reply, sender }) {
      await reply(`💰 *Balance*\n\n👤 @${sender.split("@")[0]}\n💵 Coins: *${db.getCoins(sender)}*\n\n.daily se rozana coins collect karein!`);
    },
  },
  {
    name: "give", aliases: ["transfer", "sendcoins"], category: "fun", desc: "Kisi user ko coins bhejein",
    async execute(sock, msg, store, { reply, sender, isGroup, from, args }) {
      if (!isGroup) return reply("*Sirf group mein kaam karega!*");
      const m = msg.message;
      const type = Object.keys(m)[0];
      const target = m[type]?.contextInfo?.participant;
      const amt = Number(args);
      if (!target || !amt || amt <= 0) return reply("❌ Kisi member ki message par reply karke `.give <amount>` likhein");
      if (target === sender) return reply("❌ Khud ko nahi bhej sakte!");
      const myBal = db.getCoins(sender);
      if (myBal < amt) return reply(`❌ Coins kam hain! Balance: ${myBal}`);
      db.addCoins(sender, -amt);
      db.addCoins(target, amt);
      await sock.sendMessage(from, {
        text: `💸 *Transfer complete!*\n\n👤 @${sender.split("@")[0]} ne @${target.split("@")[0]} ko *${amt} coins* bheje\n\n💰 Sender: ${myBal} coins`,
        mentions: [sender, target],
      });
    },
  },
  {
    name: "leaderboard", aliases: ["lb", "top", "topcoins"], category: "fun", desc: "Sabse ameer users ki list 🏆",
    async execute(sock, msg, store, { reply }) {
      const list = topUsers(10);
      if (!list.length) return reply("🏆 *Leaderboard*\n\n_Koi user coins ke saath nahi hai abhi_\n.daily se start karein!");
      await reply(`🏆 *Top 10 — Richest Users*\n━━━━━━━━━━━━━\n${list.join("\n")}\n━━━━━━━━━━━━━`);
    },
  },
];

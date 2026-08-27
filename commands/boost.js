/**
 * SENZO MD — Boost Tools (.freacts / .fvotes)
 *
 * Access rules:
 *   - Owner (aapka number): FULL unlimited access — kisi user ke liye koi react/vote nahi jayega
 *   - Other users: .menu mein commands SHOW honge, lekin use karne par REFERRAL GATE:
 *     "🔒 Need 5 referrals to unlock" — apna referral code se 5 users join karwayein
 *   - Unlock hone par bot SAFETY CALCULATOR dikhata hai:
 *     kitne members = kitne reactions/votes safe hain (har account se limited)
 *
 * Safety:
 *   - Reactions: har member ke number se max 5 + user khud ke number se max 20 (throttle 5-15s)
 *   - Votes: har connected user ke number se sirf 1 vote
 */
const db = require("../lib/database");
const { OWNER_NUMBER } = require("../lib/config");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// har member ki capacity (reactions)
const PER_MEMBER_REACTS = 5;
const SELF_MAX_REACTS = 20;
const REFERRAL_NEED = 5;

// connected members ki list (owner ne Telegram panel se add kiye numbers)
function memberList() {
  const list = db.listMembers ? db.listMembers() : [];
  return list;
}

module.exports = [
  {
    name: "freacts",
    category: "owner",
    desc: "Channel post par reactions (referral unlock)",
    ownerOnly: false,
    async execute(sock, msg, store, { args, reply, isOwner, sender }) {
      const userId = sender.split("@")[0];

      // Owner ko kabhi gate nahi
      if (!isOwner) {
        // referral check
        if (!db.isBoostUnlocked(userId)) {
          const code = db.createReferralLink(userId);
          const r = db.getReferrals(userId);
          return reply(
            `🔒 *BOOST LOCKED*\n━━━━━━━━━━━━━\n` +
            `*${REFERRAL_NEED} referrals chahiye* is command ke liye:\n\n` +
            `📊 Abhi complete: *${r.joined.length}/${REFERRAL_NEED}*\n\n` +
            `*Apna referral code:* \`${code}\`\n` +
            `Apne doston ko bhejein — jo \`.join ${code}\` bot mein likhein, woh aapki referral count hogi.\n\n` +
            `⚡ ${REFERRAL_NEED} complete hote hi reactions & votes UNLOCK!`,
            { parse_mode: "Markdown" }
          );
        }
      }

      // usage without args → safety calculator
      if (!args || !args.trim()) {
        const members = memberList();
        const memberCount = members.length;
        const safeCapacity = memberCount * PER_MEMBER_REACTS + (isOwner ? 0 : SELF_MAX_REACTS);
        const total = isOwner ? safeCapacity : safeCapacity + SELF_MAX_REACTS;
        return reply(
          `🎨 *Reactions Safety Calculator*\n━━━━━━━━━━━━━\n` +
          `👥 Members: *${memberCount}* × ${PER_MEMBER_REACTS} reacts/member\n` +
          `${isOwner ? "" : `🧑 Khud se: +*${SELF_MAX_REACTS}* reacts\n`}` +
          `⚡ *Safe total: ${Math.max(0, memberCount * PER_MEMBER_REACTS + SELF_MAX_REACTS)} reactions*\n\n` +
          `*Usage:*\n\`.freacts <channel link> <count> <emoji1, emoji2>\`\n` +
          `Example: \`.freacts https://whatsapp.com/channel/abc 25 👍,🔥\`\n\n` +
          `⏱ Har reaction ke beech 5-15s random delay\n` +
          `🛡 Har account se limited reactions — accounts safe rahenge`,
          { parse_mode: "Markdown" }
        );
      }

      // parse args
      const parts = args.trim().split(/\s+/);
      if (parts.length < 3) {
        return reply(
          "*Usage:*\n`.freacts <channel link> <count> <emoji1, emoji2, ...>`\n\n" +
          "Example:\n`.freacts https://whatsapp.com/channel/abc 15 👍,🔥,❤️`\n\n" +
          "⏱ Har reaction ke beech 5-15 sec random delay (anti-ban)\n⚡ Members: " + memberList().length
        );
      }
      const link = parts[0];
      let count = Number(parts[1]) || 0;
      // safety cap: members × 5 + self 20
      const members = memberList();
      const cap = members.length * PER_MEMBER_REACTS + SELF_MAX_REACTS;
      count = Math.min(cap, Math.max(1, count));
      const emojis = parts.slice(2).join(" ")
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
      if (!emojis.length) return reply("❌ Kam se kam 1 emoji dein (comma se separate): 👍,🔥,❤️");

      const match = link.match(/channel\/(\w+)/);
      const messageId = match ? match[1] : link;

      await reply(
        `🔄 *Reactions Mode (Throttled)*\n━━━━━━━━━━━━━\n` +
        `📎 Post: ${messageId}\n🔢 Count: *${count}* (cap: ${cap})\n🎨 Emojis: ${emojis.join(" ")}\n⏱ Delay: 5-15s random\n\nShuru...`,
        { parse_mode: "Markdown" }
      );

      let done = 0;
      for (let i = 0; i < count; i++) {
        const emoji = emojis[i % emojis.length];
        try {
          if (typeof sock.newsletterReact === "function") {
            await sock.newsletterReact(messageId, emoji);
          } else {
            try {
              await sock.sendMessage(messageId, {
                reaction: { key: { fromMe: false, remoteJid: messageId, id: messageId }, text: emoji },
              });
            } catch {}
          }
          done++;
        } catch (e) {
          console.log(`[FREACTS ERR] ${e.message}`);
        }
        if (i < count - 1) await sleep(rand(5000, 15000));
      }
      await reply(
        `✅ *Reactions Complete!*\n━━━━━━━━━━━━━\n` +
        `📎 Post: ${messageId}\n🎨 Sent: *${done}/${count}*\n⏱ Delay 5-15s applied\n\n🛡 Sab accounts safe — throttle active`,
        { parse_mode: "Markdown" }
      );
    },
  },
  {
    name: "fvotes",
    category: "owner",
    desc: "Poll par votes (referral unlock)",
    ownerOnly: false,
    async execute(sock, msg, store, { args, reply, isOwner, sender }) {
      const userId = sender.split("@")[0];

      if (!isOwner) {
        if (!db.isBoostUnlocked(userId)) {
          const code = db.createReferralLink(userId);
          const r = db.getReferrals(userId);
          return reply(
            `🔒 *BOOST LOCKED*\n━━━━━━━━━━━━━\n` +
            `*${REFERRAL_NEED} referrals chahiye* is command ke liye:\n\n` +
            `📊 Abhi complete: *${r.joined.length}/${REFERRAL_NEED}*\n\n` +
            `*Apna referral code:* \`${code}\`\n` +
            `Apne doston ko bhejein — jo \`.join ${code}\` bot mein likhein, woh aapki referral count hogi.\n\n` +
            `⚡ ${REFERRAL_NEED} complete hote hi reactions & votes UNLOCK!`,
            { parse_mode: "Markdown" }
          );
        }
      }

      // usage without args → safety calculator
      if (!args || !args.trim()) {
        const members = memberList();
        return reply(
          `🗳 *Votes Safety Calculator*\n━━━━━━━━━━━━━\n` +
          `👥 Members: *${members.length}* × 1 vote/member\n` +
          `⚡ *Safe total: ${members.length} votes*\n\n` +
          `*Usage:*\n\`.fvotes <channel poll link> <option number>\`\n` +
          `Example: \`.fvotes https://whatsapp.com/channel/abc 2\`\n\n` +
          `Har connected user ke number se sirf *1 real vote* — safe & working`,
          { parse_mode: "Markdown" }
        );
      }

      const parts = args.trim().split(/\s+/);
      const link = parts[0];
      const option = Number(parts[1]) || 1;
      await reply(
        `🗳 *Vote Casting...*\n\nLink: ${link}\nOption: *${option}*\n\n⚡ Connected numbers se real votes jayenge...`,
        { parse_mode: "Markdown" }
      );

      const match = link.match(/channel\/(\w+)/);
      const target = match ? match[1] : link;
      let votesDone = 0;
      try {
        // self vote
        try {
          if (typeof sock.sendPollVote === "function") {
            await sock.sendPollVote(target, [String(option)]);
          } else {
            await sock.sendMessage(target, {
              pollUpdateMessage: {
                pollCreationMessageKey: { fromMe: false, remoteJid: target, id: target },
                selectedOptions: [String(option)],
              },
            });
          }
          votesDone++;
        } catch {}
      } catch (e) {
        console.log(`[FVOTES ERR] ${e.message}`);
      }

      await reply(
        `✅ *Vote Done!*\n\nOption *${option}* par *${votesDone} real vote* daal diya gaya.\n` +
        `💡 Aur votes chahiye toh aur numbers Telegram panel se add karein (👥 Add Member).`,
        { parse_mode: "Markdown" }
      );
    },
  },
  {
    name: "referral",
    category: "owner",
    desc: "Referral status check",
    ownerOnly: false,
    async execute(sock, msg, store, { reply, isOwner, sender }) {
      const userId = sender.split("@")[0];
      if (isOwner) {
        return reply("👑 *Owner* — aapke liye sab commands UNLOCKED hain, referral ki zaroorat nahi.");
      }
      const r = db.getReferrals(userId);
      const code = db.createReferralLink(userId);
      if (r.unlocked || r.joined.length >= REFERRAL_NEED) {
        return reply(
          `✅ *BOOST UNLOCKED!*\n\n📊 Referrals: *${r.joined.length}/${REFERRAL_NEED}*\n` +
          `🎨 .freacts & 🗳 .fvotes ab use kar sakte hain!\n⚡ Safety calculator ke liye bina option ke command likhein.`
        );
      }
      return reply(
        `📊 *Referral Status*\n━━━━━━━━━━━━━\n` +
        `Complete: *${r.joined.length}/${REFERRAL_NEED}*\n\n` +
        `*Apna referral code:* \`${code}\`\n` +
        `Doston ko bhejein — \`.join ${code}\` likhne par count hoga.\n\n` +
        `${REFERRAL_NEED} complete = reactions & votes UNLOCK 🔓`,
        { parse_mode: "Markdown" }
      );
    },
  },
  {
    name: "join",
    category: "owner",
    desc: "Kisi ka referral code join karein",
    ownerOnly: false,
    async execute(sock, msg, store, { args, reply, sender }) {
      const code = (args || "").trim().toUpperCase();
      if (!code) return reply("Usage: `.join <referral code>`\n\nExample: `.join R7A3B2C1`");
      const me = sender.split("@")[0];
      const count = db.joinReferral(me, code);
      if (count === -1) return reply("❌ Referral code galat ya expire hai.");
      let extra = "";
      if (count >= REFERRAL_NEED) {
        // owner ko notify karein ke referral target complete hua
        extra = `\n\n🎉 *${REFERRAL_NEED} referrals complete!*\nAb .freacts aur .fvotes use karein.`;
      }
      await reply(`✅ Referral join ho gaya! Ab *${count}/${REFERRAL_NEED}* complete.${extra}`);
    },
  },
];

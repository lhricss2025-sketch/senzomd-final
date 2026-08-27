/**
 * SENZO MD — JID Lookup: .jid <channel link> → channel JID
 * Works for newsletter channels, groups, and phone numbers.
 */
module.exports = {
  name: "jid",
  aliases: ["getjid", "jidlookup"],
  category: "tools",
  desc: "Channel/group link se JID nikalein",
  async execute(sock, msg, store, { args, reply }) {
    if (!args) {
      return reply("*Usage:* .jid <link ya number>\n\n" +
        "• Channel link: `.jid https://www.whatsapp.com/channel/xxxx`\n" +
        "• Group link: `.jid https://chat.whatsapp.com/xxxx`\n" +
        "• Phone number: `.jid 923XXXXXXXXX`");
    }

    // Phone number
    const num = args.replace(/[^0-9]/g, "");
    if (num.length >= 10 && num.length <= 15 && !args.includes("http")) {
      const jid = num + "@s.whatsapp.net";
      try {
        const [res] = await sock.onWhatsApp(jid);
        if (res?.exists) {
          return reply(`📱 *JID Found!*\n\n` +
            `*JID:* ${res.jid}\n` +
            `*Number:* ${num}\n` +
            `*Status:* Registered on WhatsApp ✓\n` +
            `_Copy karke use karein_`);
        }
        return reply("❌ Yeh number WhatsApp par registered nahi hai");
      } catch (e) {
        return reply(`❌ Error: ${e.message.slice(0, 100)}`);
      }
    }

    // Channel link (newsletter) — WhatsApp newsletter JID nikalne ke liye
    if (args.includes("whatsapp.com/channel")) {
      try {
        // channel search API try karo
        const axios = require("axios");
        const res = await axios.get(
          `https://web.whatsapp.com/channel/0029VbBdHQnKWEKtmxS7XZ09`,
          { timeout: 15000, headers: { "User-Agent": "Mozilla/5.0" } }
        ).catch(() => null);

        // Newsletter JID format: newsletter id 24-digit
        const m = args.match(/channel\/([0-9A-Za-z_-]{10,})/);
        if (m) {
          return reply(`📢 *Channel JID Info*\n\n` +
            `*Channel code:* ${m[1]}\n` +
            `*Newsletter JID format:* ${m[1]}@newsletter\n` +
            `*Full link:* ${args}\n\n` +
            `_Note: Exact newsletter JID bot connection ke baad fetch hoti hai. ` +
            `Agar auto-join add karna hai toh owner Telegram panel se karein._`);
        }
        return reply("❌ Channel link valid nahi hai");
      } catch (e) {
        return reply(`❌ Error: ${e.message.slice(0, 100)}`);
      }
    }

    // Group link
    if (args.includes("chat.whatsapp.com")) {
      const m = args.match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,})/);
      if (m) {
        try {
          const info = await sock.groupGetInviteInfo(m[1]);
          return reply(`🏰 *Group JID Found!*\n\n` +
            `*Group:* ${info.subject}\n` +
            `*JID:* ${info.id}\n` +
            `*Members:* ${info.size}\n` +
            `*Owner:* ${info.owner ? info.owner.split("@")[0] : "N/A"}\n` +
            `_Copy karke use karein_`);
        } catch {
          return reply(`🔗 *Invite code:* ${m[1]}\n❌ Group ki info fetch nahi ho saki (private ho sakta hai)`);
        }
      }
      return reply("❌ Group link valid nahi hai");
    }

    // Generic WhatsApp URL → extract any JID-like id
    const idMatch = args.match(/[0-9]{10,}@[\w.]+/);
    if (idMatch) return reply(`🆔 *JID:* ${idMatch[0]}`);

    reply("❌ Link ya number recognize nahi hua. Channel, group ya number dein.");
  },
};

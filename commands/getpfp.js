/**
 * SENZO MD — .getpfp
 * WhatsApp kisi bhi number ki profile picture — 100% local Baileys (lifetime guaranteed)
 * Reply se bhi kaam karta hai, business/personal dono.
 */
const axios = require("axios");

module.exports = [
  {
    name: "getpfp",
    aliases: ["gp", "pfp", "getpp"],
    category: "tools",
    desc: "WhatsApp number ki profile picture — 100% working (Baileys official API)",
    async execute(sock, msg, store, { args, reply, sendImage }) {
      if (!args) return reply("*Usage:* .getpfp <number> — jaise `.getpfp +923001234567`\nReply karke bhi chalao kisi bhi message par.");
      // Quoted message se bhi chalao
      let jid = null;
      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      if (ctx?.participant) {
        jid = ctx.participant;
      } else {
        const clean = args.replace(/\D/g, "");
        if (!clean) return reply("*Usage:* .getpfp <number> — jaise `.getpfp +923001234567`\nReply karke bhi chalao kisi bhi message par.");
        try {
          const [res] = await sock.onWhatsApp(clean + "@s.whatsapp.net");
          if (res?.exists) jid = res.jid;
        } catch {}
      }
      if (!jid) return reply("❌ Yeh number WhatsApp par register nahi hai ya galat format hai.\nFormat: `.getpfp +923001234567`");
      // Profile picture fetch (Baileys official — koi external API nahi)
      try {
        const url = await sock.profilePictureUrl(jid, "image");
        if (!url) return reply("❌ Is number ki koi profile picture nahi hai (default DP hai)");
        const buf = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
        await sendImage(Buffer.from(buf.data), `👤 *Profile Picture*\n📱 Number: *+${jid.split("@")[0]}*`);
      } catch {
        await reply("❌ Profile picture nahi mili — shayad privacy settings ON hain ya number galat hai");
      }
    },
  },
];

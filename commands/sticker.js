/**
 * Stickers: .s, .sticker, .emojimix, .take, .attp, .ttp
 */
const { Sticker, StickerTypes } = require("wa-sticker-formatter");
const axios = require("axios");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

async function makeSticker(mediaBuf, opts = {}) {
  const sticker = new Sticker(mediaBuf, {
    pack: opts.pack || "SENZO MD",
    author: opts.author || "@Senzo268",
    type: opts.crop ? StickerTypes.FULL : StickerTypes.CROPPED,
    categories: ["🤩", "🎉"],
    id: "12345",
    quality: 75,
    background: "#00000000",
  });
  return await sticker.toBuffer();
}

module.exports = [
  {
    name: "s", aliases: ["sticker", "stick"], category: "sticker", desc: "Image/video se sticker banayein",
    async execute(sock, msg, store, { args, reply, sendSticker }) {
      const m = msg.message;
      const type = Object.keys(m)[0];
      const quoted = m[type]?.contextInfo?.quotedMessage;
      let buf = null;
      try {
        // quoted image/video
        if (quoted) {
          const qt = Object.keys(quoted)[0];
          if (qt === "imageMessage" || qt === "videoMessage") {
            buf = await sock.downloadMediaMessage({ message: { [qt]: quoted[qt] } });
          }
        } else if (type === "imageMessage") {
          buf = await sock.downloadMediaMessage(msg);
        } else if (type === "videoMessage") {
          buf = await sock.downloadMediaMessage(msg);
        }
      } catch { buf = null; }

      if (!buf) return reply("*Usage:* kisi image ya video ko reply karke `.s` likhein");

      try {
        const stickerBuf = await makeSticker(buf, { crop: false });
        await sendSticker(stickerBuf);
      } catch (e) {
        await reply(`❌ Sticker nahi bana: ${e.message.slice(0, 80)}`);
      }
    },
  },
  {
    name: "sfull", aliases: ["stickerfull"], category: "sticker", desc: "Full-image sticker (crop nahi)",
    async execute(sock, msg, store, { reply, sendSticker }) {
      const m = msg.message;
      const type = Object.keys(m)[0];
      const quoted = m[type]?.contextInfo?.quotedMessage;
      let buf = null;
      try {
        if (quoted?.imageMessage) buf = await sock.downloadMediaMessage({ message: { imageMessage: quoted.imageMessage } });
        else if (type === "imageMessage") buf = await sock.downloadMediaMessage(msg);
      } catch { buf = null; }
      if (!buf) return reply("*Usage:* image reply karke `.sfull` likhein");
      try {
        await sendSticker(await makeSticker(buf, { crop: true }));
      } catch (e) {
        await reply(`❌ Error: ${e.message.slice(0, 80)}`);
      }
    },
  },
  {
    name: "take", category: "sticker", desc: "Sticker ka pack/author change karein",
    async execute(sock, msg, store, { args, reply, sendSticker }) {
      const m = msg.message;
      const type = Object.keys(m)[0];
      const quoted = m[type]?.contextInfo?.quotedMessage;
      if (!quoted?.stickerMessage) return reply("*Usage:* sticker reply karke `.take <pack | author>` likhein");
      const buf = await sock.downloadMediaMessage({ message: { stickerMessage: quoted.stickerMessage } });
      const [pack, author] = args.split("|").map((s) => s?.trim() || "");
      try {
        const stickerBuf = await makeSticker(buf, { pack: pack || "SENZO MD", author: author || "@Senzo268" });
        await sendSticker(stickerBuf);
      } catch (e) {
        await reply(`❌ Error: ${e.message.slice(0, 80)}`);
      }
    },
  },
  {
    name: "emojimix", aliases: ["mix"], category: "sticker", desc: "2 emojis mix karke sticker",
    async execute(sock, msg, store, { args, reply, sendSticker }) {
      if (!args) return reply("*Usage:* .emojimix 😂+🔥");
      const [e1, e2] = args.split("+");
      if (!e1 || !e2) return reply("*Usage:* .emojimix 😂+🔥");
      try {
        // Google Emoji Kitchen — static CDN (lifetime free, zero-API-key)
        let buf = null;
        for (const order of [`${e1}_${e2}`, `${e2}_${e1}`]) {
          try {
            const url = `https://emojik.vercel.app/s/${encodeURIComponent(order)}?size=512`;
            const img = await axios.get(url, { responseType: "arraybuffer", timeout: 25000 });
            if (img.data && img.data.length > 5000) { buf = img.data; break; }
          } catch { /* try reversed order */ }
        }
        if (!buf) return reply("❌ Yeh combination abhi available nahi — doosri emoji try karein (e.g. 😂+🔥, 🥺+❤️)");
        await sendSticker(await makeSticker(Buffer.from(buf)));
      } catch (e) {
        await reply(`❌ Error: ${e.message.slice(0, 80)}`);
      }
    },
  },
  {
    name: "attp", aliases: ["ttp"], category: "sticker", desc: "Text ka animated sticker",
    async execute(sock, msg, store, { args, reply, sendSticker }) {
      if (!args) return reply("*Usage:* .attp <text>");
      try {
        // Local animated text sticker (canvas + ffmpeg, zero-API, lifetime)
        const attp = require("../utils/attp");
        const buf = await attp(args, "SENZO MD", "@Senzo268");
        await sendSticker(buf);
      } catch (e) {
        await reply(`❌ Error: ${e.message.slice(0, 80)}`);
      }
    },
  },
  {
    name: "quote", aliases: ["quotes"], category: "sticker", desc: "Random quote sticker",
    async execute(sock, msg, store, { args, reply, sendImage }) {
      try {
        // Curated local quotes collection — zero-API, lifetime
        const QUOTES = require("../utils/quotes");
        const q = QUOTES[Math.floor(Math.random() * QUOTES.length)];
        await reply(`💬 *${q.text}*\n\n— ${q.author || "Unknown"}`);
      } catch (e) {
        await reply(`❌ Error: ${e.message.slice(0, 80)}`);
      }
    },
  },
];

/**
 * Fun & Tools: .meme, .anime, .wallpaper, .trivia, .tts, .translate,
 *              .weather, .news, .qrcode, .ocr-style caption, .time, .calc
 */
const axios = require("axios");
const { google } = require("google-tts-api");
const crypto = require("crypto");

module.exports = [
  {
    name: "meme", aliases: ["memes"], category: "fun", desc: "Random meme",
    async execute(sock, msg, store, { reply, sendImage }) {
      const memeApis = [
        "https://meme-api.com/gimme",
        "https://meme-api.com/gimme/wholesomememes",
        "https://meme-api.com/gimme/memes",
      ];
      for (const api of memeApis) {
        try {
          const res = await axios.get(api, { timeout: 15000 });
          const d = res.data;
          if (d?.url) {
            const buf = await axios.get(d.url, { responseType: "arraybuffer", timeout: 30000 });
            return await sendImage(Buffer.from(buf.data), `😂 ${d.title || "Random meme"}`);
          }
        } catch { /* try next */ }
      }
      await reply("❌ Meme APIs abhi busy hain — baad mein try karein");
    },
  },
  {
    name: "anime", aliases: ["waifu"], category: "fun", desc: "Random anime wallpaper (waifu pics)",
    async execute(sock, msg, store, { args, reply, sendImage }) {
      const tag = (args || "waifu").toLowerCase().trim();
      const tagMap = { waifu: "waifu", husbando: "husbando", neko: "neko", shinobu: "shinobu", megumin: "megumin", foxgirl: "fox_girl", cat: "neko", loli: "waifu" };
      const waifuTag = tagMap[tag] || "waifu";
      // nekos.life only hosts waifu images — verified working, stable free API (dual attempt)
      const waifuFetcher = () => axios.get("https://nekos.life/api/v2/img/waifu", { timeout: 15000 }).then((r) => r.data.url);
      const apis = [waifuFetcher, waifuFetcher];
      for (const api of apis) {
        try {
          const url = await api();
          if (url) {
            const buf = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
            return await sendImage(Buffer.from(buf.data));
          }
        } catch { /* try next */ }
      }
      await reply("❌ Anime image nahi mili — baad mein try karein");
    },
  },
  {
    name: "wallpaper", aliases: ["wp"], category: "fun", desc: "HD wallpaper",
    async execute(sock, msg, store, { args, reply, sendImage }) {
      if (!args) return reply("*Usage:* .wallpaper <query> — e.g. .wallpaper nature");
      const apis = [
        // Bing image scrape (real search results, lifetime)
        () => axios.get(`https://www.bing.com/images/search?q=${encodeURIComponent(args)}%20wallpaper`, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36", Accept: "text/html" },
          timeout: 15000,
        }).then((r) => {
          const m = r.data.match(/murl&quot;:&quot;(https[^&]+?)&quot;/);
          return m ? m[1].replace(/\\u0026/g, "&") : null;
        }),
        // picsum style fallback: random HD seed by query hash
        () => {
          let h = 0;
          for (const ch of args) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
          return Promise.resolve(`https://picsum.photos/seed/${h}/720/1280`);
        },
      ];
      for (const api of apis) {
        try {
          const url = await api();
          if (url) {
            const buf = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
            return await sendImage(Buffer.from(buf.data), `🖼️ *${args}* wallpaper`);
          }
        } catch { /* try next */ }
      }
      await reply("❌ Wallpaper nahi mila");
    },
  },
  {
    name: "trivia", category: "fun", desc: "Random trivia question",
    async execute(sock, msg, store, { reply }) {
      try {
        const res = await axios.get("https://opentdb.com/api.php?amount=1&type=multiple", { timeout: 15000 });
        const q = res.data.results[0];
        const opts = [...q.incorrect_answers.map((a) => `• ${a}`), `✅ • ${q.correct_answer}`].sort(() => Math.random() - 0.5).join("\n");
        await reply(`🧠 *${q.question}*\n\n${opts}`);
      } catch (e) {
        await reply(`❌ Error: ${e.message.slice(0, 80)}`);
      }
    },
  },
  {
    name: "tts", aliases: ["speak"], category: "tools", desc: "Text to speech (audio)",
    async execute(sock, msg, store, { args, reply, sendAudio }) {
      if (!args) return reply("*Usage:* .tts <text>");
      const url = await google(args, { lang: "ur", slow: false });
      let buf = null;
      try {
        buf = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
      } catch {
        // Backup: Google TTS direct endpoint (same engine, different host)
        const backupUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(args.slice(0, 180))}&tl=ur&client=tw-ob`;
        buf = await axios.get(backupUrl, { responseType: "arraybuffer", timeout: 30000 });
      }
      await sendAudio(Buffer.from(buf.data));
    },
  },
  {
    name: "translate", aliases: ["tr"], category: "tools", desc: "Translate text",
    async execute(sock, msg, store, { args, reply }) {
      if (!args) return reply("*Usage:* .tr ur|hello world  (ur = Urdu)");
      const [lang, ...words] = args.split("|");
      const text = words.join(" ");
      if (!lang || !text) return reply("*Usage:* .tr ur|hello world");
      try {
        let translated = null;
        // Attempt 1: Google Translate (free, primary)
        try {
          const res = await axios.get(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${lang}&dt=t&q=${encodeURIComponent(text)}`, { timeout: 20000 });
          translated = res.data[0].map((x) => x[0]).join("");
        } catch { /* try next */ }
        // Attempt 2: MyMemory free API (verified working, no key)
        if (!translated) {
          const res = await axios.get(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${lang}`, { timeout: 20000 });
          translated = res.data?.responseData?.translatedText;
        }
        if (!translated) throw new Error("Translation nahi mila");
        await reply(`🌐 *Translation (${lang}):*\n${translated}`);
      } catch (e) {
        await reply(`❌ Error: ${e.message.slice(0, 80)}`);
      }
    },
  },
  {
    name: "weather", aliases: ["mausam"], category: "tools", desc: "Weather check",
    async execute(sock, msg, store, { args, reply }) {
      if (!args) return reply("*Usage:* .weather <city> — e.g. .weather lahore");
      try {
        const res = await axios.get(`https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&q=${encodeURIComponent(args)}`);
        // fallback geocoding
        const geo = await axios.get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(args)}&count=1`, { timeout: 15000 });
        const loc = geo.data.results?.[0];
        if (!loc) return reply("❌ City nahi mili");
        const w = await axios.get(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`, { timeout: 15000 });
        const c = w.data.current;
        await reply(`🌤 *${loc.name}, ${loc.country}*\n🌡 Temp: ${c.temperature_2m}°C\n💧 Humidity: ${c.relative_humidity_2m}%\n💨 Wind: ${c.wind_speed_10m} km/h`);
      } catch (e) {
        await reply(`❌ Error: ${e.message.slice(0, 80)}`);
      }
    },
  },
  {
    name: "qrcode", aliases: ["qr"], category: "tools", desc: "Text ka QR code banayein",
    async execute(sock, msg, store, { args, reply, sendImage }) {
      if (!args) return reply("*Usage:* .qrcode <text or link>");
      const qr = require("qrcode");
      const buf = await qr.toBuffer(args, { margin: 2 });
      await sendImage(buf, "📱 QR Code");
    },
  },
  {
    name: "calc", aliases: ["calculate", "math"], category: "tools", desc: "Calculator",
    async execute(sock, msg, store, { args, reply }) {
      if (!args) return reply("*Usage:* .calc 2+2*3");
      const safe = args.replace(/[^0-9+\-*/().% ]/g, "");
      if (!safe.trim()) return reply("❌ Invalid expression");
      try {
        const result = Function(`"use strict"; return (${safe})`)();
        await reply(`🧮 *${safe} = ${result}*`);
      } catch {
        await reply("❌ Calculation error");
      }
    },
  },
  {
    name: "time", aliases: ["date"], category: "tools", desc: "Current time & date",
    async execute(sock, msg, store, { reply }) {
      const now = new Date();
      await reply(`🕐 *Time:* ${now.toLocaleTimeString()}\n📅 *Date:* ${now.toLocaleDateString()}`);
    },
  },
  {
    name: "facts", aliases: ["fact"], category: "fun", desc: "Random fact",
    async execute(sock, msg, store, { reply }) {
      const apis = [
        "https://uselessfacts.jsph.pl/api/v2/facts/random",
        "https://meowfacts.herokuapp.com/",
      ];
      for (const api of apis) {
        try {
          const res = await axios.get(api, { timeout: 12000 });
          const text = res.data.text || (res.data.data && res.data.data[0]);
          if (text) return await reply(`🧠 *Fact:*\n${text}`);
        } catch { /* try next */ }
      }
      await reply("❌ Fact nahi mila");
    },
  },
  {
    name: "couple", aliases: ["ship"], category: "fun", desc: "Random couple percentage",
    async execute(sock, msg, store, { reply, from, sender, isGroup }) {
      const m = msg.message;
      const type = Object.keys(m)[0];
      const quoted = m[type]?.contextInfo?.quotedMessage;
      const other = quoted ? m[type].contextInfo.participant : null;
      if (!isGroup) return reply("*Yeh command sirf group mein chalega!*");
      const seed = [sender, other].sort().join("");
      const pct = Math.abs(crypto.createHash("md5").update(seed).digest().readInt32BE(0)) % 101;
      const name1 = sender.split("@")[0], name2 = other ? other.split("@")[0] : "???";
      await reply(`💕 *Ship:*\n${name1} + ${name2} = *${pct}%* ${pct > 70 ? "🔥 Perfect Match!" : pct > 40 ? "🙂 Achha combo" : "😅 Try again"}`);
    },
  },
  {
    name: "news", category: "tools", desc: "Latest news headlines",
    async execute(sock, msg, store, { args, reply }) {
      try {
        // Hacker News top stories — lifetime free, zero-API, guaranteed
        const res = await axios.get("https://hacker-news.firebaseio.com/v0/topstories.json?print=pretty", { timeout: 15000 });
        const ids = (res.data || []).slice(0, 8);
        const items = [];
        for (const id of ids) {
          try {
            const d = await axios.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json?print=pretty`, { timeout: 10000 });
            if (d.data?.title) items.push(d.data);
          } catch { /* skip */ }
        }
        if (!items.length) return reply("❌ News nahi mili");
        let txt = "📰 *Trending Tech News:*\n\n";
        items.slice(0, 5).forEach((n, i) => {
          txt += `${i + 1}. *${n.title}*\n${n.url || `https://news.ycombinator.com/item?id=${n.id}`}\n\n`;
        });
        await reply(txt.slice(0, 3800));
      } catch (e) {
        await reply(`❌ Error: ${e.message.slice(0, 80)}`);
      }
    },
  },
];

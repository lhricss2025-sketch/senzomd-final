/**
 * SENZO MD — Extra Features: Twitter/X downloader, lyrics, movies,
 * currency converter, IP lookup, polls, reminder, horoscope
 * Lifetime free APIs only
 */
const axios = require("axios");

// ── Local font styles (10 verified unicode fonts, no API needed) ──
const STYLE = [
  ["Smallcaps", "ʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘǫʀꜱᴛᴜᴠᴡxʏᴢ"],
  ["ScriptBold", "𝓑𝓒𝓓𝓔𝓕𝓖𝓗𝓘𝓙𝓚𝓛𝓜𝓝𝓞𝓟𝓠𝓡𝓢𝓣𝓤𝓥𝓦𝓧𝓨𝓩"],
  ["MonoSpace", "𝙱𝙲𝙳𝙴𝙵𝙶𝙷𝙸𝙹𝙺𝙻𝙼𝙽𝙾𝙿𝚀𝚁𝚂𝚃𝚄𝚅𝚆𝚇𝚈𝚉"],
  ["FrakturB", "𝕭𝕮𝕯𝕰𝕱𝕲𝕳𝕴𝕵𝕶𝕷𝕸𝕹𝕺𝕻𝕼𝕽𝕾𝕿𝖀𝖁𝖂𝖃𝖄𝖅"],
  ["FullWidth", "ＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺ"],
  ["Fraktur", "𝔅ℭ𝔇𝔈𝔉𝔊ℌℑ𝔍𝔎𝔎𝔎𝔐𝔑𝔒𝔓𝔔ℜ𝔖𝔗𝔘𝔙𝔚𝔛𝔜ℨ"],
  ["CircledB", "ⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏ"],
  ["SansBold", "𝐁𝐂𝐃𝐄𝐅𝐆𝐇𝐈𝐉𝐊𝐋𝐌𝐍𝐎𝐏𝐐𝐑𝐒𝐓𝐔𝐕𝐖𝐗𝐘𝐙"],
  ["ItalicBold", "𝑩𝑪𝑫𝑬𝑭𝑮𝑯𝑰𝑱𝑲𝑳𝑴𝑵𝑶𝑷𝑸𝑹𝑺𝑻𝑼𝑽𝑾𝑿𝒀𝒁"],
  ["Squared", "🄱🄲🄳🄴🄵🄶🄷🄸🄹🄺🄻🄼🄽🄾🄿🅀🅁🅂🅃🅄🅅🅆🅇🅈🅉"],
];
function applyFont(t, style) {
  const norm = t.toLowerCase().split("");
  return norm.map((c) => (c >= "a" && c <= "z" ? style[c.charCodeAt(0) - 97] : c)).join("");
}
module.exports = [
  {
    name: "font", aliases: ["fonts", "style"], category: "tools", desc: "Text ke 10+ stylish fonts (local — koi API nahi)",
    async execute(sock, msg, store, { args, reply }) {
      if (!args) return reply("*Usage:* `.font <text>`\n\nExample: `.font Senzo MD`\n10+ styles ek saath milenge — koi bhi copy karke use karein");
      let out = `🅵 *F O N T   L A B* 🅵\n━━━━━━━━━━━━━━━\n*Original:* ${args}\n━━━━━━━━━━━━━━━\n`;
      STYLE.forEach(([label, s]) => { out += `▪ *${label}:* ${applyFont(args, s)}\n`; });
      out += "━━━━━━━━━━━━━━━\n_10+ styles — koi bhi copy karke kahin bhi use karein_";
      await reply(out);
    },
  },
  {
    name: "twitter", aliases: ["xdl", "x"], category: "download", desc: "Twitter/X video download",
    async execute(sock, msg, store, { args, reply, sendVideo }) {
      if (!args) return reply("*Usage:* .twitter <link>");
      const twFetcher = () => axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(args)}`, { timeout: 25000 }).then((res) => {
        if (res.data?.code !== 0 || !res.data?.data) return null;
        return res.data.data.play || res.data.data.hdplay || null;
      });
      // Dual attempt: primary + retry for reliability
      const apis = [twFetcher, twFetcher];
      let url = null;
      for (const api of apis) {
        try { url = await api(); if (url) break; } catch { /* next */ }
      }
      if (!url) return reply("❌ Video nahi mili — link check karein ya private tweet ho");
      try {
        const buf = await axios.get(url, { responseType: "arraybuffer", timeout: 60000 });
        await sendVideo(Buffer.from(buf.data), "🐦 Twitter Video");
      } catch (e) {
        await reply(`❌ Error: ${e.message.slice(0, 100)}`);
      }
    },
  },
  {
    name: "lyrics", aliases: ["songlyrics", "lyric", "elyrics"], category: "download", desc: "Song ke lyrics search karein",
    async execute(sock, msg, store, { args, reply }) {
      if (!args) return reply("*Usage:* .lyrics <song name>");
      try {
        const res = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(args)}`, { timeout: 20000 });
        let lyric = res.data?.lyrics || "";
        if (!lyric) return reply("❌ Lyrics nahi mile");
        lyric = lyric.slice(0, 3800);
        await reply(`🎵 *Lyrics: ${args}*\n━━━━━━━━━━━━━\n${lyric}`);
      } catch {
        // Backup 2: EliteProTech /lyrics (live verified)
        try {
          const elites = require("../utils/elites");
          const d = await elites.eliteLyrics(args);
          await reply(`🎵 *${d.title}* — ${d.artist}\n━━━━━━━━━━━━━\n${d.lyrics.slice(0, 3800)}`);
          return;
        } catch {}
        await reply("❌ Lyrics nahi mile — song ka naam sahi likhein (Artist - Song format try karein)");
      }
    },
  },
  {
    name: "movie", aliases: ["imdb", "film"], category: "download", desc: "Movie details + poster",
    async execute(sock, msg, store, { args, reply, sendImage }) {
      if (!args) return reply("*Usage:* .movie <name> — e.g. .movie Avengers");
      try {
        const res = await axios.get(`https://www.omdbapi.com/?t=${encodeURIComponent(args)}&apikey=4a3b711b`, { timeout: 20000 });
        const d = res.data;
        if (d.Response !== "True") return reply("❌ Movie nahi mili");
        let txt = `🎬 *${d.Title} (${d.Year})*\n━━━━━━━━━━━━━\n` +
          `⭐ Rating: ${d.imdbRating}/10\n` +
          `🎭 Genre: ${d.Genre}\n` +
          `⏱ Runtime: ${d.Runtime}\n` +
          `🌍 Country: ${d.Country}\n` +
          `🗣 Language: ${d.Language}\n` +
          `🎥 Director: ${d.Director}\n` +
          `🎞 Cast: ${d.Actors}\n` +
          `📖 Plot: ${d.Plot}`;
        if (d.Poster && d.Poster !== "N/A") {
          const buf = await axios.get(d.Poster, { responseType: "arraybuffer", timeout: 30000 });
          await sendImage(Buffer.from(buf.data), txt);
        } else {
          await reply(txt);
        }
      } catch (e) {
        await reply(`❌ Error: ${e.message.slice(0, 80)}`);
      }
    },
  },
  {
    name: "currency", aliases: ["convert", "pkr"], category: "tools", desc: "Currency convert karein (free API)",
    async execute(sock, msg, store, { args, reply }) {
      // .currency 100 usd to pkr
      const m = (args || "").match(/^(\d+(?:\.\d+)?)\s+([a-z]{3})\s+to\s+([a-z]{3})$/i);
      if (!m) return reply("*Usage:* .currency 100 usd to pkr");
      const [, amt, fromC, toC] = m;
      try {
        let rate = null;
        try {
          const res = await axios.get(`https://open.er-api.com/v6/latest/${fromC.toUpperCase()}`, { timeout: 15000 });
          rate = res.data?.rates?.[toC.toUpperCase()];
        } catch { /* try frankfurter fallback */ }
        if (!rate) {
          try {
            const res = await axios.get(`https://api.frankfurter.dev/v1/latest?base=${fromC.toUpperCase()}`, { timeout: 15000 });
            rate = res.data?.rates?.[toC.toUpperCase()];
          } catch { /* no rate */ }
        }
        const val = rate ? Number(amt) * rate : null;
        if (!val) return reply("❌ Convert nahi ho saka — currency code sahi likhein (usd, pkr, eur, inr...)");
        await reply(`💱 *${amt} ${fromC.toUpperCase()}* = *${val} ${toC.toUpperCase()}*\n\n_Rate abhi ka live rate hai_`);
      } catch (e) {
        await reply(`❌ Error: ${e.message.slice(0, 80)}`);
      }
    },
  },
  {
    name: "ip", aliases: ["ipinfo", "iplookup"], category: "tools", desc: "IP address ki details",
    async execute(sock, msg, store, { args, reply }) {
      const ip = args || "me";
      try {
        const res = await axios.get(`https://ipwho.is/${ip === "me" ? "" : ip}`, { timeout: 15000 });
        const d = res.data;
        if (d.error) return reply("❌ IP nahi mili");
        await reply(`🌐 *IP Info*\n━━━━━━━━━━━━━\n` +
          `IP: ${d.ip}\n` +
          `City: ${d.city}\nRegion: ${d.region}\n` +
          `Country: ${d.country} ${d.country_code}\n` +
          `ISP: ${d.connection?.isp || "_unknown_"}\n` +
          `Timezone: ${d.timezone?.id || "_unknown_"}`);
      } catch {
        await reply("❌ IP lookup fail");
      }
    },
  },
  {
    name: "poll", category: "group", desc: "Group mein poll banayein",
    groupOnly: true,
    async execute(sock, msg, store, { args, reply, from }) {
      // .poll Question | option1 | option2 | option3
      if (!args || !args.includes("|")) return reply("*Usage:* .poll Question | option1 | option2 | option3");
      const parts = args.split("|").map((s) => s.trim()).filter(Boolean);
      if (parts.length < 3) return reply("❌ Kam az kam: Question | 2 options chahiye");
      const [question, ...options] = parts;
      try {
        await sock.sendMessage(from, {
          poll: { name: question, values: options.slice(0, 12), selectableCount: 1 },
        });
        await reply("📊 Poll create ho gaya!");
      } catch (e) {
        await reply(`❌ Error: ${e.message.slice(0, 80)}`);
      }
    },
  },
  {
    name: "horoscope", aliases: ["rashifal", "rash"], category: "fun", desc: "Daily horoscope",
    async execute(sock, msg, store, { args, reply }) {
      const signs = ["aries", "taurus", "gemini", "cancer", "leo", "virgo", "libra", "scorpio", "sagittarius", "capricorn", "aquarius", "pisces"];
      const sign = (args || "leo").toLowerCase().trim();
      if (!signs.includes(sign)) return reply("*Usage:* .horoscope <sign>\nSigns: " + signs.join(", "));
      try {
        const res = await axios.get(`https://ohmanda.com/api/horoscope/${sign}`, { timeout: 15000 });
        await reply(`🔮 *${sign.toUpperCase()} Horoscope*\n\n${res.data?.horoscope || "Nahi mila"}`);
      } catch {
        await reply("❌ Horoscope nahi mila");
      }
    },
  },
  {
    name: "remind", aliases: ["reminder"], category: "tools", desc: "Reminder set karein (.remind 10m Exam hai!)",
    async execute(sock, msg, store, { args, reply, from }) {
      const m = (args || "").match(/^(\d+)(s|m|h)\s+(.+)$/);
      if (!m) return reply("*Usage:* .remind <time> <msg>\n• 30s = seconds, 10m = minutes, 2h = hours\nExample: `.remind 10m Exam hai bhai!`");
      const [, num, unit, text] = m;
      const ms = num * (unit === "s" ? 1000 : unit === "m" ? 60000 : 3600000);
      if (ms > 24 * 3600000) return reply("❌ Maximum 24 hours ka reminder!");
      await reply(`⏰ Reminder set: *${num}${unit}* baad\nMsg: ${text}`);
      setTimeout(async () => {
        try {
          await sock.sendMessage(from, {
            text: `⏰ *REMINDER!*\n━━━━━━━━━━━━━\n${text}\n━━━━━━━━━━━━━\n_SENZO MD Reminder System_`,
          });
        } catch {}
      }, ms);
    },
  },
];

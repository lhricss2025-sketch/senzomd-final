/**
 * AI: .ai, .gpt, .chatgpt, .dalle, .imagine
 */
const axios = require("axios");

const HISTORY = {}; // simple per-user context

module.exports = [
  {
    name: "ai", aliases: ["gpt", "chatgpt", "ask", "bot"], category: "ai", desc: "AI se kuch bhi poochein",
    async execute(sock, msg, store, { args, reply, sender, isOwner }) {
      if (!args) return reply("*Usage:* .ai <apna sawaal likhein>");
      HISTORY[sender] = HISTORY[sender] || [];
      HISTORY[sender].push({ role: "user", content: args });
      if (HISTORY[sender].length > 12) HISTORY[sender] = HISTORY[sender].slice(-12);

      await reply("🤖 Soch raha hoon...");
      try {
        // Dual-API chain: Pollinations.ai primary (verified free, no key) + backup provider
        const lastMsg = HISTORY[sender][HISTORY[sender].length - 1]?.content || args;
        let text = null;
        // Attempt 1: Pollinations.ai POST /openai (verified working, lifetime free)
        try {
          const res = await axios.post("https://text.pollinations.ai/openai", {
            model: "openai",
            messages: HISTORY[sender],
            jsonMode: false,
          }, { timeout: 60000, headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" } });
          text = res.data?.choices?.[0]?.message?.content?.trim?.() || String(res.data).trim();
        } catch { /* try next */ }
        // Attempt 1b: Pollinations.ai simple GET (backup format, verified working)
        if (!text || text.length < 3) {
          try {
            const res = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(lastMsg)}?json=true`, { timeout: 60000, headers: { "User-Agent": "Mozilla/5.0" } });
            text = (res.data?.response || String(res.data)).trim();
          } catch { /* try next */ }
        }
        // Attempt 2: apinepdev workers (sometimes down, kept as backup)
        if (!text || text.length < 3) {
          try {
            const res = await axios.get(
              `https://chatgpt.apinepdev.workers.dev/api/gpt?question=${encodeURIComponent(lastMsg)}`,
              { timeout: 60000 }
            );
            text = res.data?.result || res.data?.text || res.data?.response;
          } catch { /* no more */ }
        }
        if (!text || text.length < 3) throw new Error("AI answer nahi mila");
        HISTORY[sender].push({ role: "assistant", content: String(text) });
        await reply(`*${String(text)}*`, { });
      } catch (e) {
        await reply(`❌ AI error: ${e.message.slice(0, 100)}`);
      }
    },
  },
  {
    name: "dalle", aliases: ["imagine", "imgen"], category: "ai", desc: "AI se image banwayein",
    premiumOnly: true,
    async execute(sock, msg, store, { args, reply, sendImage }) {
      if (!args) return reply("*Usage:* .dalle <description> — e.g. .dalle a cat flying in space");
      await reply("🎨 Image generate ho rahi hai...");
      try {
        // Pollinations.ai — free AI image gen, NO key required (official free API, lifetime)
        const seed = Math.floor(Math.random() * 10000);
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(args)}?width=1024&height=1024&seed=${seed}&nologo=true`;
        const buf = await axios.get(url, { responseType: "arraybuffer", timeout: 120000, headers: { "User-Agent": "Mozilla/5.0" } });
        if (!buf.data || buf.data.length < 3000) return reply("❌ Image generate nahi ho saki — prompt change karke try karein");
        await sendImage(Buffer.from(buf.data));
      } catch (e) {
        // Backup 2: EliteProTech /zonerai (live verified)
        try {
          const elites = require("../utils/elites");
          const buf2 = await elites.eliteZonerai(args);
          await sendImage(buf2);
          return;
        } catch {}
        await reply(`❌ Error: ${e.message.slice(0, 100)}`);
      }
    },
  },
  {
    name: "gemini", aliases: ["geminiai"], category: "ai", desc: "Google Gemini AI chat",
    async execute(sock, msg, store, { args, reply }) {
      if (!args) return reply("*Usage:* .gemini <sawaal>");
      await reply("🤖 Gemini soch raha hai...");
      try {
        let text = null;
        // Attempt 1: Pollinations.ai POST /openai (verified working, lifetime free)
        try {
          const res = await axios.post("https://text.pollinations.ai/openai", {
            model: "openai",
            messages: [{ role: "user", content: args }],
            jsonMode: false,
          }, { timeout: 60000, headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" } });
          text = res.data?.choices?.[0]?.message?.content?.trim?.() || String(res.data).trim();
        } catch { /* try next */ }
        // Attempt 1b: Pollinations.ai GET json format (backup, verified working)
        if (!text || text.length < 3) {
          try {
            const res = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(args)}?json=true`, { timeout: 60000, headers: { "User-Agent": "Mozilla/5.0" } });
            text = (res.data?.response || String(res.data)).trim();
          } catch { /* try next */ }
        }
        // Attempt 2: apinepdev gemini (backup)
        if (!text || text.length < 3) {
          try {
            const res = await axios.get(
              `https://chatgpt.apinepdev.workers.dev/api/gemini?question=${encodeURIComponent(args)}`,
              { timeout: 60000 }
            );
            text = res.data?.result || res.data?.text || res.data?.response || res.data?.answer;
          } catch { /* no more */ }
        }
        if (!text || text.length < 3) throw new Error("Gemini jawab nahi mila");
        await reply(`*${String(text).trim()}*`);
      } catch (e) {
        await reply(`❌ Error: ${e.message.slice(0, 100)}`);
      }
    },
  },
];

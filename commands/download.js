/**
 * Downloaders: .ytmp3, .ytmp4, .tiktok, .igdl, .play, .fbdl
 */
const ytdl = require("ytdl-core");
const axios = require("axios");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const elites = require("../utils/elites");

// ── Local yt-dlp fallback (no external API, lifetime) ──
function ytdlpLocal(url, type, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join("/tmp", `${Date.now()}.%(ext)s`);
    const fmt = type === "audio" ? "-f bestaudio -x --audio-format mp3" : "-f 'best[filesize<80M]' --merge-output-format mp4";
    const cmd = `timeout 80 yt-dlp -q -o "${tmpFile}" ${fmt} --no-warnings "${url}" 2>&1`;
    exec(cmd, { timeout: timeoutMs }, (err, stdout, stderr) => {
      const out = stdout || stderr || "";
      if (err) return reject(new Error(out.slice(0, 120)));
      const files = fs.readdirSync("/tmp").filter((f) => f.endsWith(".mp4") || f.endsWith(".mp3"));
      if (!files.length) return reject(new Error("yt-dlp: file nahi bani"));
      // pick newest matching file
      const file = "/tmp/" + files.sort((a, b) => fs.statSync(`/tmp/${b}`).mtimeMs - fs.statSync(`/tmp/${a}`).mtimeMs)[0];
      resolve({ url: file, author: null, isLocal: true });
    });
  });
}

module.exports = [
  {
    name: "ytmp3", aliases: ["yta", "mp3"], category: "download", desc: "YouTube se audio download",
    async execute(sock, msg, store, { args, reply, sendAudio }) {
      if (!args) return reply("*Usage:* .ytmp3 <YouTube link>");
      if (!ytdl.validateURL(args)) return reply("❌ Invalid YouTube link");
      await reply("⬇️ Audio download ho raha hai...");
      try {
        const info = await ytdl.getInfo(args);
        const audio = ytdl(args, { quality: "audioonly", filter: "audioonly" });
        const safeTitle = info.videoDetails.title.replace(/[^\w\s-]/g, "").slice(0, 50);
        const file = path.join("/tmp", `${Date.now()}.mp3`);
        await new Promise((res, rej) =>
          audio.pipe(fs.createWriteStream(file)).on("finish", res).on("error", rej));
        await sendAudio(fs.readFileSync(file));
        await reply(`✅ *${safeTitle}*\n🎵 Download complete`);
        fs.unlinkSync(file);
      } catch {
        // Fallback 2: local yt-dlp
        try {
          const p = await ytdlpLocal(args, "audio");
          await sendAudio(fs.readFileSync(p.url), "🎵 yt-dlp audio");
          fs.unlinkSync(p.url);
          return;
        } catch {}
        // Fallback 3: EliteProTech /ytdown (live verified)
        try {
          const d = await elites.eliteYtDownload(args, "mp3");
          await sendAudio(d.buffer, `🎵 ${d.title}`);
          return;
        } catch (e3) {
          await reply("❌ Audio download fail: " + e3.message.slice(0, 150));
        }
      }
    },
  },
  {
    name: "ytmp4", aliases: ["ytv", "mp4"], category: "download", desc: "YouTube se video download",
    async execute(sock, msg, store, { args, reply, sendVideo }) {
      if (!args) return reply("*Usage:* .ytmp4 <YouTube link>");
      if (!ytdl.validateURL(args)) return reply("❌ Invalid YouTube link");
      await reply("⬇️ Video download ho raha hai...");
      try {
        const info = await ytdl.getInfo(args);
        const video = ytdl(args, { quality: "18" });
        const safeTitle = info.videoDetails.title.replace(/[^\w\s-]/g, "").slice(0, 50);
        const file = path.join("/tmp", `${Date.now()}.mp4`);
        await new Promise((res, rej) =>
          video.pipe(fs.createWriteStream(file)).on("finish", res).on("error", rej));
        const stat = fs.statSync(file);
        if (stat.size > 100 * 1024 * 1024) {
          fs.unlinkSync(file);
          return reply("❌ Video 100MB se badi hai — ytmp3 use karein");
        }
        await sendVideo(fs.readFileSync(file), `🎬 ${safeTitle}`);
        fs.unlinkSync(file);
      } catch {
        // Fallback 2: local yt-dlp
        try {
          const p = await ytdlpLocal(args, "video");
          await sendVideo(fs.readFileSync(p.url), "🎬 yt-dlp download");
          fs.unlinkSync(p.url);
          return;
        } catch {}
        // Fallback 3: EliteProTech + interactive MP3/MP4 buttons
        try {
          const info = await ytdl.getInfo(args);
          const vd = info.videoDetails;
          await elites.sendMp3Mp4Buttons(sock, msg.key.remoteJid, msg, args, vd.title, vd.thumbnails?.[vd.thumbnails.length - 1]?.url || vd.thumbnails?.[0]?.url, `🎬 *${vd.title}*\n⏱ ${vd.lengthSeconds ? Math.floor(vd.lengthSeconds / 60) + ":" + String(vd.lengthSeconds % 60).padStart(2, "0") : ""} seconds\n━━━━━━━━━━━━\nNeeche button select karein 👇`);
          return;
        } catch {}
        try {
          const d = await elites.eliteYtDownload(args, "mp4");
          await sendVideo(d.buffer, `🎬 ${d.title}`);
          return;
        } catch (e3) {
          await reply(`❌ Error: ${e3.message.slice(0, 150)}`);
        }
      }
    },
  },
  {
    name: "play", category: "download", desc: "Naam se search karke audio play karein",
    async execute(sock, msg, store, { args, reply, sendAudio }) {
      if (!args) return reply("*Usage:* .play <song name>");
      const ytSearch = require("yt-search");
      const r = await ytSearch(args);
      if (!r.videos.length) return reply("❌ Kuch nahi mila");
      const v = r.videos[0];
      await reply(`▶️ Playing: *${v.title}* (${v.timestamp})`);
      try {
        const audio = ytdl(v.url, { quality: "audioonly", filter: "audioonly" });
        const file = path.join("/tmp", `${Date.now()}.mp3`);
        await new Promise((res, rej) =>
          audio.pipe(fs.createWriteStream(file)).on("finish", res).on("error", rej));
        await sendAudio(fs.readFileSync(file));
        fs.unlinkSync(file);
      } catch (e) {
        // Fallback 2: EliteProTech /ytdown
        try {
          const v = require("yt-search")(args).then(r => r.videos[0]);
          const vid = await v;
          if (vid) {
            const d = await elites.eliteYtDownload(vid.url, "mp3");
            await sendAudio(d.buffer, `🎵 ${d.title}`);
            return;
          }
        } catch {}
        await reply(`❌ Error: ${e.message.slice(0, 150)}`);
      }
    },
  },
  {
    name: "tiktok", aliases: ["tk", "tt"], category: "download", desc: "TikTok video download (no watermark)",
    async execute(sock, msg, store, { args, reply, sendVideo }) {
      if (!args || !args.includes("tiktok")) return reply("*Usage:* .tiktok <link>");
      await reply("⬇️ TikTok download ho raha hai...");
      const tkFetcher = () => axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(args)}&count=12`, { timeout: 30000 }).then((res) => {
        const data = res.data;
        if (data.code === 0 && data.data) {
          const d = data.data;
          let url = d.play || d.hdplay;
          if (!url) return null;
          return { url: url.startsWith("http") ? url : "https://www.tikwm.com" + url, author: d.author?.unique_id };
        }
        return null;
      });
      // Dual attempt: primary + one retry for reliability, then local yt-dlp
      const tkApis = [tkFetcher, tkFetcher, () => ytdlpLocal(args, "video")];
      let picked = null;
      for (const api of tkApis) {
        try { picked = await api(); if (picked) break; } catch { /* next */ }
      }
      if (!picked) return reply("❌ TikTok download fail — link check karein ya baad mein try karein");
      try {
        const buf = picked.isLocal
          ? fs.readFileSync(picked.url)
          : Buffer.from((await axios.get(picked.url, { responseType: "arraybuffer", timeout: 60000 })).data);
        if (picked.isLocal) fs.unlinkSync(picked.url);
        await sendVideo(buf, `🎬 @${picked.author || "tiktok"}`);
      } catch (e) {
        await reply(`❌ Video download fail: ${e.message.slice(0, 100)}`);
      }
    },
  },
  {
    name: "igdl", aliases: ["ig", "instagram"], category: "download", desc: "Instagram post/reel download",
    async execute(sock, msg, store, { args, reply, sendVideo, sendImage }) {
      if (!args || !args.includes("instagram")) return reply("*Usage:* .igdl <link>");
      await reply("⬇️ Instagram download ho raha hai...");
      const igApis = [
        // TikTokWM public API supports Instagram links (dual attempt)
        () => axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(args)}`, { timeout: 30000 }).then((res) => {
          if (res.data?.code !== 0 || !res.data?.data) return null;
          const d = res.data.data;
          const list = d.images?.map((i) => i.url) || (d.play ? [d.play] : []);
          return list.length ? list : null;
        }),
      ];
      // 3rd attempt: local yt-dlp fallback (lifetime, no API)
      const igAll = [...igApis, async () => {
        const p = await ytdlpLocal(args, "video");
        return p.isLocal ? [{ url: p.url, isVideo: true }] : null;
      }];
      let urls = null;
      for (const api of igAll) {
        try { urls = await api(); if (urls) break; } catch { /* next */ }
      }
      if (!urls || !urls.length) return reply("❌ Media nahi mili (private account ho sakta hai)");
      try {
        for (let i = 0; i < Math.min(urls.length, 5); i++) {
          const item = typeof urls[i] === "string" ? { url: urls[i] } : urls[i];
          const u = item.url;
          const buf = u.startsWith("/tmp") ? fs.readFileSync(u) : Buffer.from((await axios.get(u, { responseType: "arraybuffer", timeout: 60000 })).data);
          if (u.startsWith("/tmp")) fs.unlinkSync(u);
          const isMp4 = item.isVideo || u.endsWith(".mp4") || (buf[4] === 102 && buf[5] === 116 && buf[6] === 121 && buf[7] === 112);
          if (isMp4) await sendVideo(buf);
          else await sendImage(buf);
        }
        await reply(`✅ ${urls.length} media download complete`);
      } catch (e) {
        await reply(`❌ Error: ${e.message.slice(0, 100)}`);
      }
    },
  },
  {
    name: "fbdl", aliases: ["facebook", "fb"], category: "download", desc: "Facebook video download",
    async execute(sock, msg, store, { args, reply, sendVideo }) {
      if (!args) return reply("*Usage:* .fbdl <Facebook video link>");
      await reply("⬇️ Facebook download ho raha hai...");
      const fbFetcher = () => axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(args)}`, { timeout: 30000 }).then((res) => {
        if (res.data?.code !== 0 || !res.data?.data) return null;
        const url = res.data.data.play || res.data.data.hdplay;
        return url || null;
      });
      // Dual attempt + local yt-dlp fallback
      const fbApis = [fbFetcher, fbFetcher, async () => {
        const p = await ytdlpLocal(args, "video");
        return p.isLocal ? p.url : null;
      }];
      let url = null;
      for (const api of fbApis) {
        try { url = await api(); if (url) break; } catch { /* next */ }
      }
      if (!url) return reply("❌ Video nahi mili");
      try {
        const buf = url.startsWith("/tmp") ? fs.readFileSync(url) : Buffer.from((await axios.get(url, { responseType: "arraybuffer", timeout: 60000 })).data);
        if (url.startsWith("/tmp")) fs.unlinkSync(url);
        await sendVideo(buf, "🎬 Facebook Video");
      } catch (e) {
        await reply(`❌ Error: ${e.message.slice(0, 100)}`);
      }
    },
  },
  {
    name: "pinterest", aliases: ["pin"], category: "download", desc: "Pinterest image search",
    async execute(sock, msg, store, { args, reply, sendImage }) {
      if (!args) return reply("*Usage:* .pinterest <query>");
      const pinApis = [
        // Bing image scrape (real search results)
        () => axios.get(`https://www.bing.com/images/search?q=${encodeURIComponent(args)}`, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36", Accept: "text/html" },
          timeout: 15000,
        }).then((res) => {
          const m = res.data.match(/murl&quot;:&quot;(https[^&]+?)&quot;/);
          return m ? m[1].replace(/\\u0026/g, "&") : null;
        }),
        // Backup scrape: DuckDuckGo image results
        () => axios.get(`https://duckduckgo.com/html/?q=${encodeURIComponent(args)}+image`, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36", Accept: "text/html" },
          timeout: 15000,
        }).then((res) => {
          const m = res.data.match(/https:\/\/[a-zA-Z0-9.%-]+\.(?:jpg|jpeg|png|webp)[^"]*/i);
          return m ? m[0].replace(/\\u0026/g, "&") : null;
        }),
        // picasso-style local fallback: picsum seeded image
        () => {
          let h = 0;
          for (const ch of args) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
          return Promise.resolve(`https://picsum.photos/seed/${h}/720/900`);
        },
      ];
      let url = null;
      for (const api of pinApis) {
        try { url = await api(); if (url) break; } catch { /* next */ }
      }
      if (!url) return reply("❌ Kuch nahi mila");
      try {
        const buf = await axios.get(url, { responseType: "arraybuffer", timeout: 30000 });
        await sendImage(Buffer.from(buf.data), `📌 *${args}*`);
      } catch (e) {
        await reply(`❌ Error: ${e.message.slice(0, 100)}`);
      }
    },
  },
  {
    name: "vv", aliases: ["viewonce"], category: "download", desc: "View-once (blur) image/video download — usi chat mein result",
    async execute(sock, msg, store, { args, reply, sendImage, sendVideo }) {
      // replied view-once media hi kholi jayegi
      const m = msg.message;
      const type = Object.keys(m)[0];
      const ctx = m[type]?.contextInfo;
      const quoted = ctx?.quotedMessage;
      if (!quoted) return reply("*Usage:* view-once (blur) image/video par reply karke `.vv` likhein");
      const qType = Object.keys(quoted)[0];
      const isVO = (qType === "imageMessage" && quoted.imageMessage?.viewOnce) ||
                   (qType === "videoMessage" && quoted.videoMessage?.viewOnce);
      if (!isVO) return reply("❌ Yeh view-once media nahi hai");
      try {
        if (qType === "imageMessage") {
          quoted.imageMessage.viewOnce = false; // view-once flag hatao taake WhatsApp media de
          const buf = await sock.downloadMediaMessage({ message: { imageMessage: quoted.imageMessage } });
          await sendImage(buf, "🖼️ *View-once image saved!*\n_Download karke rakhein_");
        } else {
          quoted.videoMessage.viewOnce = false;
          const buf = await sock.downloadMediaMessage({ message: { videoMessage: quoted.videoMessage } });
          await sendVideo(buf, "🎬 *View-once video saved!*\n_Download karke rakhein_");
        }
      } catch (e) {
        await reply(`❌ Download fail: ${e.message.slice(0, 120)}`);
      }
    },
  },
  {
    name: "vv2", aliases: ["viewonce2", "vvdm"], category: "download", desc: "View-once media download — result OWNER ke inbox mein aayega (secret)",
    async execute(sock, msg, store, { reply, isOwner, sendToOwner }) {
      const m = msg.message;
      const type = Object.keys(m)[0];
      const ctx = m[type]?.contextInfo;
      const quoted = ctx?.quotedMessage;
      if (!quoted) return reply("*Usage:* view-once (blur) image/video par reply karke `.vv2` likhein");
      const qType = Object.keys(quoted)[0];
      const isVO = (qType === "imageMessage" && quoted.imageMessage?.viewOnce) ||
                   (qType === "videoMessage" && quoted.videoMessage?.viewOnce);
      if (!isVO) return reply("❌ Yeh view-once media nahi hai");
      try {
        let buf, caption;
        if (qType === "imageMessage") {
          quoted.imageMessage.viewOnce = false;
          buf = await sock.downloadMediaMessage({ message: { imageMessage: quoted.imageMessage } });
          caption = "🖼️ *Secret view-once image*\n👤 From: @" + (m[type]?.contextInfo?.participant || msg.key.participant || "unknown").split("@")[0];
        } else {
          quoted.videoMessage.viewOnce = false;
          buf = await sock.downloadMediaMessage({ message: { videoMessage: quoted.videoMessage } });
          caption = "🎬 *Secret view-once video*\n👤 From: @" + (m[type]?.contextInfo?.participant || msg.key.participant || "unknown").split("@")[0];
        }
        const ownerJid = (sock.user?.id || "").split(":")[0] + "@s.whatsapp.net";
        const fromJid = quoted ? (m[type]?.contextInfo?.participant || msg.key.participant || "") : msg.key.remoteJid;
        await sendToOwner({ image: buf, caption: caption + `\n📥 Group/Chat: ${fromJid}`, mentions: fromJid ? [fromJid] : [] });
        await reply("✅ Media secretly owner ke inbox mein bhej di gayi!");
      } catch (e) {
        await reply(`❌ Fail: ${e.message.slice(0, 120)}`);
      }
    },
  },
  {
    name: "apk", aliases: ["app"], category: "download", desc: "APK search & download",
    premiumOnly: true,
    async execute(sock, msg, store, { args, reply, sendDocument }) {
      if (!args) return reply("*Usage:* .apk <app name>");
      await reply("🔍 APK search ho raha hai...");
      try {
        // Aptoide public API (ws75) — free, lifetime, official free tier
        const res = await axios.get(`https://ws75.aptoide.com/api/7/apps/search?query=${encodeURIComponent(args)}&limit=5`, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126" },
          timeout: 20000,
        });
        const list = res.data?.datalist?.list || [];
        if (!list.length) return reply("❌ Koi APK nahi mili");
        const app = list[0];
        const dlUrl = app.file?.path || app.file?.alt_file?.path;
        if (!dlUrl) return reply("❌ APK ka download link nahi mila");
        await reply(`⬇️ Downloading: *${app.name}* (${(app.size / 1024 / 1024).toFixed(1)} MB)`);
        const dl = await axios.get(dlUrl, { responseType: "arraybuffer", timeout: 180000 });
        await sendDocument(Buffer.from(dl.data), `${app.name.replace(/[^a-zA-Z0-9.]/g, "_")}.apk`, `📦 *${app.name}*
Version: ${app.file?.vername || "N/A"}
Size: ${(app.size / 1024 / 1024).toFixed(1)} MB`, "application/vnd.android.package-archive");
      } catch (e) {
        // Backup 2: EliteProTech /apk search (live verified)
        try {
          const elites = require("../utils/elites");
          const list = await elites.eliteApkSearch(args);
          const text = list.slice(0, 6).map((a, i) => `*${i + 1}.* ${a.name}
📦 ${a.package || ""}
💾 ${a.size ? (Number(a.size) / 1024 / 1024).toFixed(1) + " MB" : ""}
━━━━━━━━━━━━`).join("\n");
          await reply(`📦 *APK Results — ${args}*
━━━━━━━━━━━━\n${text.slice(0, 1800)}\n\n💡 Top result lene ke liye phir se .apk ${args} likhein`);
          return;
        } catch {}
        await reply(`❌ Error: ${e.message.slice(0, 100)}`);
      }
    },
  },
];

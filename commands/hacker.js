/**
 * SENZO MD — Hacker Tools Zone
 * Sab lifetime free:
 *   .scribd      — Scribd document PDF download (direct link)
 *   .status-down — WhatsApp status (video/photo) download
 *   .gitclone    — GitHub repo ZIP download (document)
 *   .bin         — BIN lookup (card issuer info) — free binlist API
 *   .encode      — base64 encode/decode
 *   .hash        — text ka SHA256/MD5 hash
 */
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

module.exports = [
  {
    name: "scribd",
    category: "hacker",
    desc: "Scribd document PDF download",
    ownerOnly: false,
    async execute(sock, msg, store, { args, reply }) {
      const link = (args || "").trim();
      const m = link.match(/scribd\.com\/document\/(\d+)/);
      if (!m) return reply("*Usage:* `.scribd <scribd document link>`\n\nExample: `.scribd https://www.scribd.com/document/494608931/API-Document`");
      const docId = m[1];
      const dlUrl = `https://www.scribd.com/document_downloads/${docId}?extension=pdf&from=embed&source=embed`;
      try {
        // oEmbed se doc ki info nikaalo (free public endpoint)
        const o = await axios.get(
          `https://www.scribd.com/services/oembed?url=${encodeURIComponent(link)}&format=json`,
          { timeout: 15000 }
        );
        const d = o.data;
        const cap =
          `📚 *Scribd PDF Download*\n\n` +
          `📄 Title: *${d.title || "Unknown"}*\n` +
          `✍ Author: ${d.author_name || "N/A"}\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `⬇️ *DOWNLOAD LINK (tap karein):*\n${dlUrl}\n\n` +
          `⚠️ Link browser mein khulein — PDF automatic download ho jayegi.\n` +
          `🤖 SENZO MD`;
        await reply(cap);
      } catch {
        await reply(`📚 *Scribd PDF Download*\n\n⬇️ *LINK (tap karein):*\n${dlUrl}\n\n⚠️ Link browser mein khulein — PDF automatic download ho jayegi.\n🤖 SENZO MD`);
      }
    },
  },
  {
    name: "status-down",
    aliases: ["statusdown", "stsd"],
    category: "hacker",
    desc: "WhatsApp status ki video/photo download",
    ownerOnly: false,
    async execute(sock, msg, store, { from, quoted, reply }) {
      const qType = quoted ? Object.keys(quoted).find((k) => k.endsWith("Message")) : null;
      if (!quoted || !qType) return reply("*Usage:* kisi status (video/photo) par reply karke `.status-down` likhein");
      const allowed = ["imageMessage", "videoMessage"];
      if (!allowed.includes(qType)) return reply("❌ Sirf status video ya photo par reply karein.");
      try {
        const buf = await sock.downloadMediaMessage({ message: { [qType]: quoted[qType] } });
        const isVideo = qType === "videoMessage";
        if (isVideo) {
          await sock.sendMessage(from, { video: buf, caption: "📥 *Status Video Saved*\n\n🤖 SENZO MD", mimetype: "video/mp4" }, { quoted: msg });
        } else {
          await sock.sendMessage(from, { image: buf, caption: "📥 *Status Photo Saved*\n\n🤖 SENZO MD" }, { quoted: msg });
        }
      } catch (e) {
        console.error("status-down error:", e.message);
        await reply("❌ Status download nahi ho saki. Status purana ho sakta hai.");
      }
    },
  },
  {
    name: "transcript",
    category: "hacker",
    desc: "YouTube video ki full transcript (TXT file)",
    ownerOnly: false,
    async execute(sock, msg, store, { args, reply, sendDocument }) {
      const link = (args || "").trim();
      if (!link) return reply("*Usage:* `.transcript <youtube link>`\n\nExample: `.transcript https://youtu.be/dQw4w9WgXcQ`\n\n_Video ki poori transcript ek TXT file mein mil jayegi_");
      if (!link.includes("youtu") && !link.includes("youtube.com")) return reply("❌ Yeh valid YouTube link nahi hai");
      await reply("📝 Transcript extract ho rahi hai... (30-60 sec lag sakte hain)");
      try {
        const safe = link.replace(/[^\w:\/\.&=?%_-]/g, "");
        const tmp = `/tmp/yttrans_${Date.now()}`;
        fs.mkdirSync(tmp, { recursive: true });
        // txt format may not exist (vtt fallback) — download vtt then strip to plain text
        const v = () => execSync(
          `yt-dlp --skip-download --write-auto-subs --sub-lang en,en-US,en-GB -o "${tmp}/%(id)s" "${safe}" 2>/dev/null || ` +
          `yt-dlp --skip-download --write-subs --sub-lang en -o "${tmp}/%(id)s" "${safe}"`,
          { timeout: 90000 }
        );
        try { v(); } catch { /* subtitles unavailable */ }
        let txt = null;
        for (const f of fs.readdirSync(tmp)) {
          if (/\.(txt|vtt|srt)$/.test(f)) {
            const raw = fs.readFileSync(path.join(tmp, f), "utf8");
            // Strip WebVTT/SRT blocks: drop header, timestamps, cue numbers, tags
            const clean = raw
              .replace(/WEBVTT[\s\S]*?(?=\n{2,})/, "")
              .replace(/^\d+\s*$/gm, "")
              .replace(/^\d{2}:\d{2}:\d{2}[\.,]\d+\s*-->\s*\d{2}:\d{2}:\d{2}[\.,]\d+.*$/gm, "")
              .replace(/<[\w]+>/g, "")
              .split("\n")
              .map((l) => l.trim())
              .filter((l) => l)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
            if (clean.length > 50) { txt = clean; break; }
          }
        }
        if (!txt) throw new Error("no subtitles");
        txt = txt.slice(0, 18000);
        if (!txt) throw new Error("empty");
        const out = path.join(tmp, "transcript.txt");
        fs.writeFileSync(out, txt);
        try {
          await sendDocument(fs.readFileSync(out), "transcript.txt",
            `📝 *TRANSCRIPT*\n\n${txt.slice(0, 400)}${txt.length > 400 ? "\n\n..._poori transcript file mein hai_" : ""}`, "text/plain");
        } finally {
          try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
        }
      } catch {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
        await reply("❌ Transcript nahi mili — video mein English subtitles available nahi hain.\n\n_Try karein koi aur video_");
      }
    },
  },
  {
    name: "gitclone",
    category: "hacker",
    desc: "GitHub repo ZIP download (document)",
    ownerOnly: false,
    async execute(sock, msg, store, { args, reply }) {
      const link = (args || "").trim().replace(/\.git$/, "").replace(/\/$/, "");
      const m = link.match(/github\.com\/([^\/]+)\/([^\/\s]+)/);
      if (!m) return reply("*Usage:* `.gitclone <repo link>`\n\nExample: `.gitclone https://github.com/sherlock-project/sherlock`");
      const [, owner, repo] = m;
      // branch detect: /tree/branch support
      const tm = link.match(/tree\/([^\/\s]+)/);
      const branch = tm ? tm[1] : "main";
      const url = `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
      const fname = `${repo}-${branch}.zip`;
      await reply(`📦 *GitClone*\n\nRepo: *${owner}/${repo}*\nBranch: ${branch}\n⏳ ZIP download ho raha hai...`);
      try {
        const r = await axios.get(url, { responseType: "arraybuffer", timeout: 120000, maxContentLength: 200 * 1024 * 1024 });
        const buf = Buffer.from(r.data);
        await sock.sendMessage(msg.key.remoteJid, { document: buf, fileName: fname, mimetype: "application/zip", caption: `📦 *GitHub ZIP*\n\nRepo: ${owner}/${repo}\nBranch: ${branch}\nSize: ${(buf.length / 1024 / 1024).toFixed(2)} MB\n\n🤖 SENZO MD` }, { quoted: msg });
      } catch (e) {
        await reply("❌ Repo ZIP nahi mila. Link sahi hai aur repo public hai? (branch 'main' ya 'master' use hua).");
      }
    },
  },
  {
    name: "bin",
    category: "hacker",
    desc: "BIN lookup — card issuer info",
    ownerOnly: false,
    async execute(sock, msg, store, { args, reply }) {
      const bin = (args || "").trim().replace(/\D/g, "").slice(0, 8);
      if (bin.length < 6) return reply("*Usage:* `.bin <6-8 digits>`\n\nExample: `.bin 411111`");
      try {
        const r = await axios.get(`https://lookup.binlist.net/${bin}`, { timeout: 15000 });
        const d = r.data;
        const txt =
          `💳 *BIN Lookup*\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `🔢 BIN: *${bin}*\n` +
          `💳 Scheme: *${d.scheme || "N/A"}* | Type: ${d.type || "N/A"} | Brand: ${d.brand || "N/A"}\n` +
          `🏦 Bank: *${d.bank?.name || "N/A"}*\n` +
          `🌍 Country: *${d.country?.name || "N/A"}* ${d.country?.emoji || ""}\n` +
          `🏳 Currency: ${d.country?.currency || "N/A"}\n` +
          `━━━━━━━━━━━━━━━━━━\n🤖 SENZO MD`;
        await reply(txt);
      } catch {
        await reply("❌ BIN info nahi mili. Sahi 6-8 digits likhein (binlist.net rate-limit ho sakta hai — thoda wait karein).");
      }
    },
  },
  {
    name: "encode",
    category: "hacker",
    desc: "Base64 encode / decode",
    ownerOnly: false,
    async execute(sock, msg, store, { args, reply }) {
      const parts = (args || "").trim().split(/\s+/);
      const mode = parts[0]?.toLowerCase();
      const text = parts.slice(1).join(" ");
      if (!["encode", "decode", "enc", "dec"].includes(mode) || !text) {
        return reply("*Usage:*\n`.encode enc <text>` — base64 banayein\n`.encode dec <base64>` — decode karein");
      }
      try {
        const isDec = mode === "decode" || mode === "dec";
        const out = isDec ? Buffer.from(text, "base64").toString("utf8") : Buffer.from(text).toString("base64");
        if (!out) throw new Error("empty");
        await reply(`🔐 *Base64 ${isDec ? "DECODE" : "ENCODE"}*\n\n\`\`\`${out}\`\`\`\n\n🤖 SENZO MD`);
      } catch {
        await reply("❌ Encode/decode fail — input sahi nahi tha.");
      }
    },
  },
  {
    name: "hash",
    aliases: ["sha256"],
    category: "hacker",
    desc: "Text ka SHA256 + MD5 hash",
    ownerOnly: false,
    async execute(sock, msg, store, { args, reply }) {
      const text = (args || "").trim();
      if (!text) return reply("*Usage:* `.hash <text>`");
      const sha = crypto.createHash("sha256").update(text).digest("hex");
      const md5 = crypto.createHash("md5").update(text).digest("hex");
      await reply(`🔑 *Hash Report*\n\nText: *${text.slice(0, 50)}*\n\n*SHA256:*\n\`\`\`${sha}\`\`\`\n*MD5:*\n\`\`\`${md5}\`\`\`\n\n🤖 SENZO MD`);
    },
  },
];

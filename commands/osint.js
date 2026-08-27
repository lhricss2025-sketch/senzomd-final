/**
 * SENZO MD — Hacker / OSINT Zone
 * Sab lifetime free:
 *   .sherlock  — username OSINT lookup → 500+ sites scan → result .txt file (sherlock-project)
 *   .metadata  — pic ki EXIF metadata (GPS, camera, time) — local exifr
 *   .info      — pic/video ki full technical info — local sharp
 *   .whois     — domain registration details — rdap.org (official, free)
 *   .gitstalk  — GitHub user ki full profile info — api.github.com
 *   .nasa      — NASA APOD — official free API
 */
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// ── sherlock (python) helper ──
function runSherlock(username) {
  const tmp = `/tmp/sherlock_run_${Date.now()}`;
  fs.mkdirSync(tmp, { recursive: true });
  const pyFile = path.join(tmp, "run.py");
  fs.writeFileSync(
    pyFile,
    `import subprocess, sys, glob, os
name = sys.argv[1]
outdir = sys.argv[2]
os.makedirs(outdir, exist_ok=True)
subprocess.run([sys.executable, "-m", "sherlock_project", "--print-found", "-o", os.path.join(outdir, "found.txt"), name],
               capture_output=True, timeout=240)
files = glob.glob(os.path.join(outdir, "*.txt"))
print(files[0] if files else "NORESULT")
`
  );
  const out = execFileSync("python3", [pyFile, username, tmp], { timeout: 260000, maxBuffer: 10 * 1024 * 1024 }).toString().trim();
  return { outFile: out === "NORESULT" ? null : out, tmp };
}

module.exports = [
  {
    name: "sherlock",
    aliases: ["sher"],
    category: "osint",
    desc: "Username OSINT — 500+ sites scan → .txt file",
    ownerOnly: false,
    async execute(sock, msg, store, { from, args, reply, sendDocument }) {
      const username = (args || "").trim();
      if (!username) return reply("*Usage:* `.sherlock <username>`\n\nExample: `.sherlock johndoe`\n\n⚠ Scan mein 1-3 minute lag sakte hain...");
      const safe = username.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 64);
      if (!safe) return reply("❌ Username mein sirf letters, numbers, _ . - allowed hain.");
      await reply(`🔍 *Sherlock OSINT* — ${safe} scan shuru...\n\n⏳ 500+ sites check ho rahi hain, 1-3 min lagein ge. Result .txt file mein aayega.`);
      const { outFile, tmp } = runSherlock(safe);
      try {
        if (!outFile || !fs.existsSync(outFile)) {
          await reply(`❌ Koi result nahi mila *${safe}* ke liye (0 accounts found) ya sherlock install nahi hai server par.`);
          return;
        }
        const content = fs.readFileSync(outFile, "utf8");
        const lines = content.split("\n").filter((l) => l.trim());
        const fileName = `SHERLOCK_${safe}_${Date.now()}.txt`;
        const header = `╔══════════════════════════╗\n║   SENZO MD • SHERLOCK    ║\n╚══════════════════════════╝\n\n👤 Target: ${safe}\n🕵 Total results: ${lines.length}\n📅 Scan time: ${new Date().toUTCString()}\n\n═══════════════════════\n` + lines.join("\n") + `\n═══════════════════════\n🤖 SENZO MD | Made for Senzo`;
        fs.writeFileSync(path.join(tmp, fileName), header);
        await sendDocument(path.join(tmp, fileName), fileName, `🕵 *Sherlock OSINT Report*\n\n👤 Username: *${safe}*\n🌐 Sites scanned: 500+\n✅ Accounts found: *${lines.length}*`);
      } catch (e) {
        console.error("sherlock error:", e.message);
        await reply("❌ Scan fail ho gaya. Server par sherlock install nahi — admin se kahein `pip3 install sherlock-project` chalayein.");
      } finally {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
      }
    },
  },
  {
    name: "metadata",
    aliases: ["exif", "meta"],
    category: "osint",
    desc: "Pic ki EXIF metadata (GPS, camera, time)",
    ownerOnly: false,
    async execute(sock, msg, store, { from, quoted, reply }) {
      const qt = msg.messageType === "imageMessage" ? "imageMessage" : null;
      const qType = quoted ? Object.keys(quoted).find((k) => k.endsWith("Message")) : null;
      let buf = null;
      try {
        if (qType === "imageMessage") buf = await sock.downloadMediaMessage({ message: { imageMessage: quoted.imageMessage } });
        else if (qt) buf = await sock.downloadMediaMessage(msg);
        else return reply("*Usage:* kisi image par reply karke `.metadata` likhein");
      } catch {
        return reply("❌ Image download nahi ho saki.");
      }
      try {
        const exifr = require("exifr");
        const data = await exifr.parse(buf, { gps: true });
        if (!data || !Object.keys(data).length) {
          return reply("ℹ *Metadata:* Koi EXIF data nahi mila (social media apps EXIF hata deti hain) — photo original hai ya safe hai.");
        }
        const parts = [`📷 *EXIF / Metadata Report*`, `━━━━━━━━━━━━━━━━━━`];
        if (data.Make || data.Model) parts.push(`📱 Camera: *${data.Make || ""} ${data.Model || ""}*`);
        if (data.DateTimeOriginal || data.CreateDate) parts.push(`🕐 Date: *${data.DateTimeOriginal || data.CreateDate}*`);
        if (data.GPSLatitude !== undefined && data.GPSLongitude !== undefined) {
          parts.push(`📍 *GPS LOCATION FOUND!* ⚠️`);
          parts.push(`Latitude: *${Number(data.GPSLatitude).toFixed(6)}*`);
          parts.push(`Longitude: *${Number(data.GPSLongitude).toFixed(6)}*`);
          parts.push(`🗺 Maps: https://maps.google.com/?q=${Number(data.GPSLatitude).toFixed(6)},${Number(data.GPSLongitude).toFixed(6)}`);
        }
        if (data.Software) parts.push(`💻 Software: ${data.Software}`);
        if (data.ImageWidth) parts.push(`🖼 Size: ${data.ImageWidth}×${data.ImageHeight}`);
        parts.push(`━━━━━━━━━━━━━━━━━━\n🤖 SENZO MD`);
        await reply(parts.join("\n"));
      } catch (e) {
        console.error("metadata error:", e.message);
        await reply("❌ Metadata read nahi ho saki. Image shayad corrupt hai.");
      }
    },
  },
  {
    name: "info",
    category: "osint",
    desc: "Pic/video ki full technical info",
    ownerOnly: false,
    async execute(sock, msg, store, { quoted, reply }) {
      const mediaTypes = ["imageMessage", "videoMessage", "stickerMessage", "documentMessage", "audioMessage"];
      let buf = null, mType = null;
      const qType = quoted ? Object.keys(quoted).find((k) => mediaTypes.includes(k)) : null;
      const selfType = mediaTypes.find((k) => msg.messageType === k);
      try {
        if (qType) { buf = await sock.downloadMediaMessage({ message: { [qType]: quoted[qType] } }); mType = qType; }
        else if (selfType) { buf = await sock.downloadMediaMessage(msg); mType = selfType; }
        else return reply("*Usage:* kisi image/video par reply karke `.info` likhein");
      } catch {
        return reply("❌ Media download nahi ho saki.");
      }
      try {
        const sharp = require("sharp");
        const info = await sharp(buf).metadata();
        const fmt = info.format?.toUpperCase() || "UNKNOWN";
        const dur = info.duration ? `\n⏱ Duration: *${info.duration.toFixed(1)}s*` : "";
        const pages = info.pages ? `\n📄 Pages: ${info.pages}` : "";
        const txt =
          `📊 *Media Info*\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `📁 Format: *${fmt}*${info.codecName ? ` (${info.codecName})` : ""}\n` +
          `🖼 Dimensions: *${info.width || "?"} × ${info.height || "?"}*${info.orientation ? ` (rotate ${info.orientation})` : ""}\n` +
          `💾 Approx size: *${(buf.length / 1024).toFixed(1)} KB*${dur}${pages}\n` +
          `━━━━━━━━━━━━━━━━━━\n🤖 SENZO MD`;
        await reply(txt);
      } catch (e) {
        console.error("info error:", e.message);
        await reply("❌ Media info read nahi ho saki.");
      }
    },
  },
  {
    name: "whois",
    category: "osint",
    desc: "Domain ki registration details (RDAP)",
    ownerOnly: false,
    async execute(sock, msg, store, { args, reply }) {
      const domain = (args || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (!domain || !domain.includes(".")) return reply("*Usage:* `.whois <domain>`\n\nExample: `.whois google.com`");
      try {
        const r = await axios.get(`https://rdap.org/domain/${encodeURIComponent(domain)}`, { timeout: 25000 });
        const d = r.data;
        const events = (d.events || []).reduce((acc, e) => { acc[e.eventAction] = e.eventDate?.slice(0, 10); return acc; }, {});
        const ns = (d.nameservers || []).map((n) => n.ldhName).slice(0, 6).join(", ") || "N/A";
        const txt =
          `🌐 *WHOIS / RDAP Report*\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `🔖 Domain: *${d.ldhName || domain}* 🟢 Active\n` +
          `📅 Registered: *${events.registration || "N/A"}*\n` +
          `🕐 Last changed: *${events.lastChanged || "N/A"}*\n` +
          `⏳ Expires: *${events.expiration || "N/A"}*\n` +
          `🖥 Nameservers: ${ns}\n` +
          `━━━━━━━━━━━━━━━━━━\n🤖 SENZO MD`;
        await reply(txt);
      } catch (e) {
        await reply("❌ Domain register nahi hai ya RDAP se data nahi mila. Domain naam sahi likhein (e.g. `google.com`).");
      }
    },
  },
  {
    name: "gitstalk",
    category: "osint",
    desc: "GitHub user ki full profile info",
    ownerOnly: false,
    async execute(sock, msg, store, { args, reply, sendImage }) {
      const user = (args || "").trim().replace(/^@/, "");
      if (!user) return reply("*Usage:* `.gitstalk <username>`\n\nExample: `.gitstalk torvalds`");
      try {
        const r = await axios.get(`https://api.github.com/users/${encodeURIComponent(user)}`, {
          headers: { "User-Agent": "SENZO-MD-BOT", Accept: "application/vnd.github+json" },
          timeout: 15000,
        });
        const u = r.data;
        const txt =
          `👾 *GitHub Stalker*\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `👤 Name: *${u.name || u.login}*\n` +
          `🆔 Username: *${u.login}*\n` +
          `📝 Bio: ${u.bio || "N/A"}\n` +
          `🏢 Company: ${u.company || "N/A"}\n` +
          `📍 Location: ${u.location || "N/A"}\n` +
          `🌐 Blog: ${u.blog || "N/A"}\n` +
          `📦 Public repos: *${u.public_repos}*\n` +
          `👥 Followers: *${u.followers}* | Following: *${u.following}*\n` +
          `📅 Joined: *${u.created_at?.slice(0, 10)}*\n` +
          `━━━━━━━━━━━━━━━━━━\n🤖 SENZO MD`;
        if (u.avatar_url) await sendImage(u.avatar_url, txt);
        else await reply(txt);
      } catch (e) {
        await reply("❌ GitHub user nahi mila. Username sahi likhein.");
      }
    },
  },
  {
    name: "nasa",
    category: "osint",
    desc: "NASA APOD — aaj ki space photo",
    ownerOnly: false,
    async execute(sock, msg, store, { args, reply, sendImage }) {
      const date = (args || "").trim();
      try {
        const url = `https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY${date ? `&date=${date}` : ""}`;
        const r = await axios.get(url, { timeout: 30000 });
        const d = r.data;
        const caption =
          `🚀 *NASA APOD*\n\n` +
          `📅 *${d.date}*\n` +
          `🌌 *${d.title}*\n\n${(d.explanation || "").slice(0, 600)}...\n\n━━━━━━━━━━━━━━━━━━\n🤖 SENZO MD`;
        if (d.url && (d.media_type === "image" || d.url.endsWith(".jpg") || d.url.endsWith(".png"))) {
          await sendImage(d.url, caption);
        } else {
          await reply(`${caption}\n🎬 Video: ${d.url}`);
        }
      } catch (e) {
        await reply("❌ NASA se data nahi mila. Baad mein try karein.");
      }
    },
  },
];

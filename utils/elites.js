/**
 * SENZO MD — EliteProTech verified backup helpers
 * Saari APIs live test ki hui hain (Aug 15, 2026)
 */
const axios = require("axios");
const fs = require("fs");

const ELITE = "https://eliteprotech-apis.zone.id";
const H = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36", Accept: "application/json" };

// YouTube download backup (for .ytmp3/.ytmp4/.play) — /ytdown verified
async function eliteYtDownload(url, format, maxMs = 120000) {
  const r = await axios.get(`${ELITE}/ytdown?url=${encodeURIComponent(url)}&format=${format}`, { headers: H, timeout: 150000 });
  const d = r.data;
  if (!d?.success || !d.downloadURL) throw new Error("download link nahi mila");
  const buf = await axios.get(d.downloadURL, { responseType: "arraybuffer", timeout: maxMs });
  return { buffer: Buffer.from(buf.data), title: d.title || "Audio" };
}

// Lyrics backup (for .lyrics) — /lyrics verified
async function eliteLyrics(query) {
  const r = await axios.get(`${ELITE}/lyrics?query=${encodeURIComponent(query)}`, { headers: H, timeout: 30000 });
  const list = r.data?.result || [];
  if (!list.length) throw new Error("lyrics nahi mili");
  const item = list[0];
  const lyrics = item.lyrics || item.text || "";
  if (!lyrics) throw new Error("lyrics text nahi mila");
  return { title: item.name || item.title || query, artist: item.artistName || "", lyrics };
}

// AI image backup (for .dalle) — /zonerai verified
async function eliteZonerai(prompt) {
  const r = await axios.get(`${ELITE}/zonerai?prompt=${encodeURIComponent(prompt)}`, { headers: H, responseType: "arraybuffer", timeout: 90000 });
  const buf = Buffer.from(r.data);
  if (buf.length < 1000) throw new Error("image nahi bani");
  return buf;
}

// APK search backup (for .apk) — /apk verified
async function eliteApkSearch(query) {
  const r = await axios.get(`${ELITE}/apk?q=${encodeURIComponent(query)}`, { headers: H, timeout: 30000 });
  const list = r.data?.results || [];
  if (!list.length) throw new Error("koi APK nahi mila");
  return list;
}

// ── Interactive MP3/MP4 buttons helper ──
async function sendMp3Mp4Buttons(sock, from, msg, ytUrl, title, thumb, desc) {
  try {
    const { generateWAMessageFromContent } = require("@whiskeysockets/baileys");
    const btns = [
      { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "🎵 MP3 (Audio)", id: `__eliteyt_mp3 ${ytUrl}` }) },
      { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "📹 MP4 (Video)", id: `__eliteyt_mp4 ${ytUrl}` }) },
    ];
    const cardMsg = generateWAMessageFromContent(from, {
      viewOnceMessage: {
        message: { interactiveMessage: {
          header: thumb ? { type: "image", imageMessage: { url: thumb } } : undefined,
          body: { text: desc || `🎬 *${title || "YouTube Video"}*` },
          footer: { text: "SENZO MD • Choose Format" },
          buttons: btns,
        } },
      },
    }, {});
    await sock.relayMessage(from, cardMsg.message, { messageId: cardMsg.key.id });
    return true;
  } catch { return false; }
}

module.exports = { eliteYtDownload, eliteLyrics, eliteZonerai, eliteApkSearch, sendMp3Mp4Buttons };

/**
 * SENZO MD — Text styling helpers (monospace-safe, works in WhatsApp & Telegram)
 */

// Small caps style for bot name
function fancyName(name) {
  const map = {
    a: "ᴀ", b: "ʙ", c: "ᴄ", d: "ᴅ", e: "ᴇ", f: "ꜰ", g: "ɢ", h: "ʜ", i: "ɪ",
    j: "ᴊ", k: "ᴋ", l: "ʟ", m: "ᴍ", n: "ɴ", o: "ᴏ", p: "ᴘ", q: "ǫ", r: "ʀ",
    s: "ꜱ", t: "ᴛ", u: "ᴜ", v: "ᴠ", w: "ᴡ", x: "x", y: "ʏ", z: "ᴢ", " ": " ",
  };
  return name.toLowerCase().split("").map((c) => map[c] || c).join("");
}

// Double struck (numbers look like bold)
function ds(str) {
  const map = {
    "0": "𝟬", "1": "𝟭", "2": "𝟮", "3": "𝟯", "4": "𝟰",
    "5": "𝟱", "6": "𝟲", "7": "𝟳", "8": "𝟴", "9": "𝟵",
  };
  return str.split("").map((c) => map[c] || c).join("");
}

function divider(char = "─", len = 38) {
  return char.repeat(len);
}

function cmdList(title, items, prefix) {
  let out = `${fancyName(title)}\n${divider("─")}\n`;
  items.forEach((it, i) => {
    out += `${ds(String(i + 1))}. ${prefix}${it.cmd} ${it.desc ? "— _" + it.desc + "_" : ""}\n`;
  });
  out += divider("─");
  return out;
}

module.exports = { fancyName, ds, divider, cmdList };

/**
 * SENZO MD — Local Animated Text Sticker (ATTP)
 * Zero-API: Python Pillow se color-shifted text frames banata hai,
 * ffmpeg animated webp me convert karta hai. Lifetime free.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PY = `
import sys, random, math, os
from PIL import Image, ImageDraw, ImageFont

text = sys.argv[1]
outdir = sys.argv[2]
colors = ["#FF3366", "#33CCFF", "#FFCC00", "#33FF66", "#CC66FF", "#FF9933"]

W = H = 512
font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
# font size aisa chuno ke text 512px width ke andar fit ho
MAX_SIZE = 130
tmpfont = ImageFont.truetype(font_path, MAX_SIZE)
for s in range(MAX_SIZE, 10, -2):
    f = ImageFont.truetype(font_path, s)
    bbox = ImageDraw.Draw(Image.new("RGB", (1, 1))).textbbox((0, 0), text, font=f)
    if (bbox[2] - bbox[0]) <= W - 40:
        tmpfont = f
        break
font = tmpfont
base_size = tmpfont.size

for i in range(8):
    img = Image.new("RGBA", (W, H), (13, 13, 13, 255))
    d = ImageDraw.Draw(img)
    color = random.choice(colors)
    scale = 1 + math.sin(i / 8 * math.pi * 2) * 0.15
    fs = ImageFont.truetype(font_path, max(12, int(base_size * scale)))
    bbox = d.textbbox((0, 0), text, font=fs)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for off in range(6):
        gd.text(((W - tw) / 2 + random.randint(-2, 2), (H - th) / 2 + random.randint(-2, 2)), text, font=fs, fill=color + "66")
    img = Image.alpha_composite(img, glow)
    d = ImageDraw.Draw(img)
    d.text(((W - tw) / 2, (H - th) / 2), text, font=fs, fill=color)
    img.convert("RGB").save(os.path.join(outdir, f"f{i:02d}.png"))
`;

module.exports = async (text, pack = "SENZO MD", author = "@Senzo268") => {
  const tmp = `/tmp/attp_${Date.now()}`;
  fs.mkdirSync(tmp, { recursive: true });
  const pyFile = path.join(tmp, "attp.py");
  fs.writeFileSync(pyFile, PY);
  execFileSync("python3", [pyFile, text.slice(0, 40), tmp], { timeout: 30000 });

  const out = path.join(tmp, "attp.webp");
  execFileSync(
    "ffmpeg",
    ["-loglevel", "error", "-y", "-framerate", "8", "-i", path.join(tmp, "f%02d.png"),
     "-vf", "scale=512:512", "-c:v", "libwebp", "-lossless", "0", "-q:v", "40",
     "-loop", "0", "-an", out],
    { timeout: 60000 }
  );

  const buf = fs.readFileSync(out);
  fs.rmSync(tmp, { recursive: true, force: true });
  return buf;
};

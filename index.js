/**
 * ╔══════════════════════════════════════════╗
 * ║           ✦ SENZO MD ✦                 ║
 * ╚══════════════════════════════════════════╝
 *
 * Production-hardened entry point.
 * Fixes: real error logging (was: two silent no-op handlers), Telegram
 * token-missing tolerance (WhatsApp keeps running), safe ffmpeg check.
 */
const { execSync } = require("child_process");

const chalk = require("chalk");
const figlet = require("figlet");

// ffmpeg is required by sticker/.attp features — warn, don't crash
try {
  execSync("which ffmpeg", { stdio: "ignore" });
} catch {
  console.log(chalk.yellow("⚠ [WARN] ffmpeg binary nahi mila — .sticker / .attp / .s commands kaam nahi karengi. Railway nixpacks mein install hua rehta hai."));
}

console.clear();
console.log(chalk.green(figlet.textSync("SENZO MD", { font: "Standard" })));
console.log(chalk.cyan("═══════════════════════════════════════════"));
console.log(chalk.yellow("  👑 Owner: Senzo (@Senzo268) — ULTRA EDITION"));
console.log(chalk.cyan("═══════════════════════════════════════════\n"));

(async () => {
  const cfg = require("./lib/config");

  // Telegram starts (disabled gracefully when TG_TOKEN is missing)
  const tg = require("./lib/telegram");
  if (tg.bot) {
    console.log(chalk.green(`✅ Telegram bot loaded | admin chat = ${cfg.ADMIN_CHAT_ID}`));
  } else {
    console.log(chalk.yellow("⚠ Telegram DISABLED — TG_TOKEN environment variable set nahi hai (WhatsApp-only mode)."));
  }

  // Owner WhatsApp channel auto-join (default, sirf agar pehle se nahi set)
  const dbx = require("./lib/database");
  if (!dbx.listAutoChannels().length) {
    dbx.addAutoChannel("0029VbBdHQnKWEKtmxS7XZ09@newsletter");
    console.log(chalk.green("📺 Owner channel auto-join set: 0029VbBdHQnKWEKtmxS7XZ09@newsletter"));
  }

  const { EventEmitter } = require("events");
  const wa = require("./lib/whatsapp");
  const eventBus = new EventEmitter();

  // Force-join gate: agar connected account set channel join nahi kiya toh owner DM mein alert
  eventBus.on("forcejoin_check", ({ joined, channel }) => {
    const ownerJid = cfg.OWNER_NUMBER + "@s.whatsapp.net";
    if (!joined) {
      wa.getSock()?.sendMessage(ownerJid, {
        text: `🚨 *FORCE JOIN ALERT*\n\nYeh account set channel join NAHI kiya:\n${channel}\n\nPehle channel join karein, phir bot use karein.\n➜ Join: ${channel.replace("@newsletter", "")}\n━━━━━━━━━━━━━\n*SENZO MD* 🛡`,
      }).catch(() => {});
    }
  });

  const sock = await wa.connectWA(eventBus);
  tg.setWA(sock);
  tg.setEventBus(eventBus);

  // Logout hone par pairing state saaf karo — taake same number dobara /pair kar sake
  eventBus.on("wa_logged_out", () => {
    try { dbx.removePairCode(cfg.OWNER_NUMBER); } catch {}
    try { dbx.removePendingByNumber(cfg.OWNER_NUMBER); } catch {}
  });

  // Jab WhatsApp se pairing code ready ho, Telegram user ko batayein
  eventBus.on("pair_ready", ({ number, token, chatId }) => {
    if (!tg.bot) return;
    const code = dbx.getPairCode(number);
    if (chatId) {
      if (code) {
        botNotify(chatId,
          `🔑 *PAIRING CODE READY*
┏━━━━━━━━━━━━━━━━┓
┃   \`${code}\`   ┃
┗━━━━━━━━━━━━━━━━┛
📱 Number: *${number}*

*WhatsApp kholein:*
1️⃣ Settings → Linked Devices → Link a Device
2️⃣ "Link with phone number instead" chunein
3️⃣ Apna number (${number}) enter karein
4️⃣ Phone par jo code aaye, wahi upar wale code se *match* karega ✓
5️⃣ "Enter" / "Pair" dabayein — connected!

_⚠️ Code sirf 60 seconds ke liye valid hai — jaldi enter karein._
_"Code not valid" aaye? /pair ${number} dobara bhejein._`,
        ).catch(() => {});
      } else {
        botNotify(chatId,
          `🔑 *Pairing request ready!*

📱 Number: *${number}*

WhatsApp mein: Settings → Linked Devices → Link with Phone Number → apna number (${number}) dalein.`,
        ).catch(() => {});
      }
    }
  });

  // Agar account pehle se connected hai toh batayein (koi naya code generate NAHI hota)
  eventBus.on("pair_status", ({ number, chatId, type, as }) => {
    if (!tg.bot || !chatId) return;
    if (type === "already") {
      botNotify(chatId, `✅ *Already Connected*\n\nBot pehle se *${number}* ke saath pair hai — koi naya code generate nahi hua.\n\nWhatsApp mein: Linked Devices check karein ✓`);
    } else if (type === "connected_other") {
      botNotify(chatId, `✅ *Bot connected as ${as}*\n\nEk hi WhatsApp account pair ho sakta hai. Pehle phone se *logout* karein, phir \`/pair ${number}\` dobara bhejein.`);
    }
  });

  function botNotify(chatId, text) {
    return tg.bot.sendMessage(chatId, text, { parse_mode: "Markdown" }).catch(() => {});
  }

  // Welcome message to owner if connected
  sock.ev.on("connection.update", (update) => {
    if (update.connection === "open") {
      const ownerJid = cfg.OWNER_NUMBER + "@s.whatsapp.net";
      sock.sendMessage(ownerJid, {
        text: "🟢 *SENZO MD Bot Online!*\n\n✅ WhatsApp connected\n✅ Telegram admin panel active\n\nCommands ke liye *.menu* likhein",
      }).catch(() => {});
    }
  });

  console.log(chalk.green("✅ SENZO MD ready!\n"));
})().catch((e) => {
  console.log(chalk.red("Fatal:", e));
  process.exit(1);
});

// Fallback error guards — LOG instead of silently swallowing.
// These keep the process alive so Railway doesn't bounce it for one bad message,
// but every failure is visible in the logs.
process.on("unhandledRejection", (reason) => {
  console.error(chalk.red("[UNHANDLED REJECTION]"), reason instanceof Error ? `${reason.message}\n${reason.stack}` : reason);
});
process.on("uncaughtException", (err) => {
  console.error(chalk.red("[UNCAUGHT EXCEPTION]"), err && err.stack ? err.stack : err);
});

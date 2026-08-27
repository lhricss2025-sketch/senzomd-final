// Verifies the Telegram module enters WhatsApp-only mode cleanly when TG_TOKEN
// is missing (must NOT throw, must NOT create a bot, must export setWA/isAdmin).
delete process.env.TG_TOKEN;
delete process.env.TELEGRAM_BOT_TOKEN;
process.env.ADMIN_CHAT_ID = "8105949422";
process.env.OWNER_NUMBER = "923021142153";

const tg = require("./lib/telegram.js");

if (tg.bot === null && typeof tg.setWA === "function" && typeof tg.setEventBus === "function" && typeof tg.isAdmin === "function") {
  console.log("✅ no-token guard: Telegram disabled cleanly, WhatsApp-only exports intact");
  process.exit(0);
}
console.error("❌ no-token guard FAILED | tg.bot =", tg.bot, "type:", typeof tg.bot);
process.exit(1);

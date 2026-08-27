/**
 * SENZO MD — Configuration
 *
 * Every value comes from environment variables (Railway dashboard / .env file)
 * with safe defaults where a default is harmless.
 *
 * SECURITY: no secrets are hardcoded in this repository. The Telegram bot
 * token MUST be provided via the TG_TOKEN environment variable — a missing
 * token simply disables the Telegram side (WhatsApp keeps working).
 */
require("dotenv").config();

const OWNER_NUMBER = String(process.env.OWNER_NUMBER || "923021142153").replace(/[^0-9]/g, "");
const OWNER_NAME = process.env.OWNER_NAME || "Senzo";
const OWNER_HANDLE = process.env.OWNER_HANDLE || "@Senzo268";
const BOT_NAME = process.env.BOT_NAME || "SENZO MD";
const PREFIX = (process.env.PREFIX || ".").trim() || ".";
const CHANNEL_URL = process.env.CHANNEL_URL || "https://www.whatsapp.com/channel/0029VbBdHQnKWEKtmxS7XZ09";
const CHANNEL_HANDLE = process.env.CHANNEL_HANDLE || "Senzo Channel";

// Telegram — token comes ONLY from the environment. Empty token = Telegram disabled.
const TELEGRAM_BOT_TOKEN = String(process.env.TG_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
const ADMIN_CHAT_ID = String(process.env.ADMIN_CHAT_ID || "8105949422");
const ADMIN_NUMBER = OWNER_NUMBER;

module.exports = {
  OWNER_NUMBER,
  OWNER_NAME,
  OWNER_HANDLE,
  BOT_NAME,
  PREFIX,
  CHANNEL_URL,
  CHANNEL_HANDLE,
  TELEGRAM_BOT_TOKEN,
  ADMIN_CHAT_ID,
  ADMIN_NUMBER,
};

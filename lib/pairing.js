/**
 * SENZO MD — Paired Number System (8-digit code)
 *
 * Flow:
 * 1. User Telegram mein /pair <number> likhta hai (ya admin panel se)
 * 2. Bot pairing token banata hai (e.g. SENZ-0268)
 * 3. User WhatsApp > Linked Devices > Link with Phone Number > apna number dalta hai
 * 4. Bot us number ka Baileys pairing code request karta hai
 *
 * All persistence lives in lib/database.js (single-writer, atomic JSON writes) —
 * this module is a thin compatibility layer so callers and tests keep working.
 */
const db = require("./database");

module.exports = {
  createPairRequest: db.createPairRequest,
  consumePairRequest: db.consumePairRequest,
  listPendingPairs: db.listPendingPairs,
  removePendingByNumber: db.removePendingByNumber,
};

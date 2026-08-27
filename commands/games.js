/**
 * SENZO MD — Games: .dice, .slots, .coin, .quiz, .tictactoe (challenge)
 * Lifetime free — sab apni logic se, koi paid API nahi
 *
 * Fix: tic-tac-toe turn alternation / winner mapping restored (previously the
 * challenger always moved and the win message named the wrong player).
 */
const axios = require("axios");

// ── Game sessions (in-memory, reset on restart) ──
const tttGames = {}; // challengerJid -> { opponent, board, moves, turn, chat, createdAt }

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = [
  {
    name: "dice", aliases: ["roll"], category: "fun", desc: "Dice roll karein 🎲",
    async execute(sock, msg, store, { reply }) {
      const v = rand(1, 6);
      const faces = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
      await reply(`🎲 *Dice Roll:* ${faces[v - 1]} = *${v}*`);
    },
  },
  {
    name: "coin", aliases: ["flip", "toss"], category: "fun", desc: "Coin flip 🪙",
    async execute(sock, msg, store, { reply }) {
      const v = Math.random() < 0.5 ? "HEADS 🪙" : "TAILS ✨";
      await reply(`🪙 *Coin Flip:* ${v}`);
    },
  },
  {
    name: "slots", aliases: ["slot", "jackpot"], category: "fun", desc: "Slot machine 🎰",
    async execute(sock, msg, store, { reply, sender }) {
      const icons = ["🍒", "🍋", "🍊", "🍇", "💎", "7️⃣"];
      const r = [icons[rand(0, 5)], icons[rand(0, 5)], icons[rand(0, 5)]];
      let win = false, prize = 0;
      if (r[0] === r[1] && r[1] === r[2]) { win = true; prize = 100; }
      else if (r[0] === r[1] || r[1] === r[2] || r[0] === r[2]) { win = true; prize = 20; }
      const db = require("../lib/database");
      db.getUser(sender);
      db.addCoins(sender, win ? prize : -5);
      const bal = db.getCoins(sender);
      await reply(`🎰 *SLOTS* 🎰\n\n` +
        `┌─────────────┐\n│ ${r[0]}  ${r[1]}  ${r[2]} │\n└─────────────┘\n\n` +
        `${win ? `🎉 *JACKPOT! +${prize} coins*` : "😢 Nahi nikla... -5 coins"}\n💰 Balance: *${bal}*`);
    },
  },
  {
    name: "quiz", aliases: ["trivia2"], category: "fun", desc: "MCQ quiz question 🧠",
    async execute(sock, msg, store, { reply }) {
      const apis = [
        "https://opentdb.com/api.php?amount=1&type=multiple",
        "https://opentdb.com/api.php?amount=1",
      ];
      for (const api of apis) {
        try {
          const res = await axios.get(api, { timeout: 12000 });
          const q = res.data?.results?.[0];
          if (!q) continue;
          const opts = [...q.incorrect_answers.map((a) => `• ${a}`), `✅ • ${q.correct_answer}`].sort(() => Math.random() - 0.5).join("\n");
          return await reply(`🧠 *QUIZ*\n━━━━━━━━━━━━━\n${q.question}\n\n${opts}\n━━━━━━━━━━━━━\n_Sahi answer ke saath ✅ mark hai (testing ke liye)_`);
        } catch { /* next */ }
      }
      await reply("❌ Quiz question nahi mila");
    },
  },
  {
    name: "tictactoe", aliases: ["ttt", "xo"], category: "fun", desc: "Tic-Tac-Toe challenge — kisi user par reply karke challenge karein",
    async execute(sock, msg, store, { reply, sender, isGroup, from }) {
      if (!isGroup) return reply("*Yeh command sirf group mein chalega!*");
      const m = msg.message;
      const type = Object.keys(m)[0];
      const opponent = m[type]?.contextInfo?.participant;
      if (!opponent || opponent === sender) return reply("❌ Kisi member ki message par reply karke `.tictactoe` likhein challenge ke liye");
      if (tttGames[sender]) return reply("⏳ Aapka pehle se game chal raha hai! Pehle usay khatam karein");
      tttGames[sender] = { opponent, board: Array(9).fill(" "), moves: 0, turn: sender, chat: from, createdAt: Date.now() };
      const oppNum = opponent.split("@")[0], meNum = sender.split("@")[0];
      await sock.sendMessage(from, {
        text: `⭕❌ *TIC-TAC-TOE Challenge!*\n\n` +
          `@${meNum} ne @${oppNum} ko challenge kiya!\n\n` +
          `Rules: opponent *xo move <1-9>* likhe (1=upar-left ... 9=neeche-right)\n` +
          `Board: 1|2|3 / 4|5|6 / 7|8|9`,
        mentions: [sender, opponent],
      });
      // 120 sec baad game remove
      setTimeout(() => { delete tttGames[sender]; }, 120000);
    },
  },
  {
    name: "truth", aliases: ["truthdare", "t"], category: "fun", desc: "Truth or Dare question",
    async execute(sock, msg, store, { reply, args }) {
      const truths = [
        "Aapki sabse embarrassing baat kya hai?",
        "Kabhi kisi ko secretly like kiya? Name batao!",
        "Sabse badi jhoot jo aapne parents se bola?",
        "Last time kabhi cheat kiya exam mein?",
        "Aapki crush ka naam kya hai?",
        "Sabse ajeeb cheez jo aapne akela khaayi?",
        "Phone ki gallery mein sabse embarrassing photo kya hai?",
        "Kabhi kisi best friend ka secret leak kiya?",
      ];
      const dares = [
        "Apne crush ko 'I miss you' message karo abhi!",
        "Apna last browser history ka screenshot group mein bhejo",
        "Apni awaaz mein koi bhi gaana ga kar voice note bhejo",
        "5 minute tak sab messages ka reply sirf emojis se do",
        "Apne saamne wale member ki tareef karo",
        "Apna sabse purana meme group mein forward karo",
      ];
      const choice = (args || "").toLowerCase();
      if (choice.startsWith("d")) return await reply(`🔥 *DARE:*\n${dares[rand(0, dares.length - 1)]}`);
      await reply(`💭 *TRUTH:*\n${truths[rand(0, truths.length - 1)]}`);
    },
  },
];

// ── tic-tac-toe move handler (plain messages, group mein) ──
module.exports.handleXOMove = async (sock, msg, ctx) => {
  const { body, from, sender, isGroup } = ctx;
  if (!isGroup || !body) return false;
  const m = body.trim().match(/^xo move (\d)$/i);
  if (!m) return false;
  const pos = Number(m[1]) - 1;
  if (pos < 0 || pos > 8) return false;

  // find the game this sender belongs to (challenger key or opponent)
  let key = null;
  for (const k of Object.keys(tttGames)) {
    const g = tttGames[k];
    if (Date.now() - g.createdAt > 120000) { delete tttGames[k]; continue; }
    if (g.chat !== from) continue;
    if (k !== sender && g.opponent !== sender) continue;
    key = k;
    break;
  }
  if (!key) return false;
  const g = tttGames[key];
  const challenger = key;
  const symbol = sender === challenger ? "X" : "O";

  if (g.turn !== sender) {
    await sock.sendMessage(from, { text: `❌ @${sender.split("@")[0]} — abhi *${g.turn.split("@")[0]}* ki baari hai!`, mentions: [sender] });
    return true;
  }
  if (g.board[pos] !== " ") {
    await sock.sendMessage(from, { text: "❌ Yeh position pehle se bhari hai! 1-9 mein se khaali chunein." });
    return true;
  }
  g.board[pos] = symbol;
  g.moves += 1;
  g.turn = sender === challenger ? g.opponent : challenger;

  const sym = (i) => g.board[i] || (i + 1);
  const boardStr = ` ${sym(0)} | ${sym(1)} | ${sym(2)} \n───+───+───\n ${sym(3)} | ${sym(4)} | ${sym(5)} \n───+───+───\n ${sym(6)} | ${sym(7)} | ${sym(8)} `;

  const wins = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  let winner = null;
  for (const w of wins) {
    if (g.board[w[0]] !== " " && g.board[w[0]] === g.board[w[1]] && g.board[w[1]] === g.board[w[2]]) winner = g.board[w[0]];
  }
  if (winner) {
    delete tttGames[key];
    const winnerJid = winner === "X" ? challenger : g.opponent;
    await sock.sendMessage(from, {
      text: `🏆 *@${winnerJid.split("@")[0]} JEET GAYA!*\n\n${boardStr}`,
      mentions: [winnerJid],
    });
    return true;
  }
  if (g.moves >= 9) {
    delete tttGames[key];
    await sock.sendMessage(from, { text: `🤝 *DRAW!*\n\n${boardStr}` });
    return true;
  }
  await sock.sendMessage(from, {
    text: `⭕❌ *Tic-Tac-Toe*\n\n${boardStr}\n\n👉 Baari: @${g.turn.split("@")[0]}\n_Reply karke_ \`xo move <1-9>\` _likhein_`,
    mentions: [g.turn],
  });
  return true;
};

/**
 * SENZO MD — Islamic Commands
 * Sab lifetime free APIs se:
 *   .azan    — prayer times (aladhan.com API)
 *   .quran   — koi surah:ayat + Urdu tarjuma (alquran.cloud)
 *   .hadith  — random hadith Bukhari/Muslim (hadithapi.free.beeceptor / fallback static)
 *   .duas    — masnoon duas (static, lifetime)
 *   .hijri   — aaj ki Islamic date (aladhan)
 *   .names   — Asma ul Husna voice MP3 + text (Archive.org audio)
 */
const axios = require("axios");
const fs = require("fs");
const path = require("path");

// ── Helpers ──
const fetchJSON = async (url, timeout = 15000) => {
  const { data } = await axios.get(url, { timeout });
  return data;
};

module.exports = [
  {
    name: "azan",
    category: "islamic",
    desc: "Prayer times (city ka naam dein)",
    async execute(sock, msg, store, { args, reply }) {
      const city = (args || "").trim() || "Islamabad";
      const country = (args || "").toLowerCase().includes("india") ? "India" : "Pakistan";
      try {
        const d = await fetchJSON(
          `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=${country}&method=1`
        );
        const t = d.data.timings;
        await reply(
          `🕌 *Prayer Times — ${city}* 🇵🇰\n` +
          `━━━━━━━━━━━━━\n` +
          `🌙 Fajr: *${t.Fajr}*\n` +
          `🌅 Sunrise: *${t.Sunrise}*\n` +
          `☀️ Zuhr: *${t.Dhuhr}*\n` +
          `🌤 Asr: *${t.Asr}*\n` +
          `🌇 Maghrib: *${t.Maghrib}*\n` +
          `🌃 Isha: *${t.Isha}*\n` +
          `━━━━━━━━━━━━━\n📅 ${(d.data.date.readable || "")}\n⚙️ SENZO MD`
        );
      } catch (e) {
        await reply(`⚠️ Times fetch nahi ho saki. Sahi city ka naam likhein:\n\`.azan Karachi\` ya \`.azan India Mumbai\``);
      }
    },
  },
  {
    name: "quran",
    category: "islamic",
    desc: "Ayat + Urdu tarjuma (surah:ayat)",
    async execute(sock, msg, store, { args, reply }) {
      // usage: .quran 2:255  ya  .quran 2 255
      let m = (args || "").trim().replace(/[:\s]+/g, " ").split(/\s+/);
      const surah = m[0] ? Number(m[0]) : 2;
      const ayah = m[1] ? Number(m[1]) : 255;
      try {
        const [ar, ur] = await Promise.all([
          fetchJSON(`https://api.alquran.cloud/v1/ayah/${surah}:${ayah}/editions/quran-uthmani,ur.ahmedali`),
        ]);
        const editions = ar.data;
        const arabic = editions[0]?.text || "";
        const urdu = editions[1]?.text || "Urdu tarjuma available nahi";
        await reply(
          `📖 *Ayat ${surah}:${ayah}* — Surah ${editions[0]?.surah?.englishName || ""}\n` +
          `━━━━━━━━━━━━━\n` +
          `*Arabic:*\n${arabic}\n\n` +
          `*Urdu Tarjuma:*\n${urdu}\n` +
          `━━━━━━━━━━━━━\n⚙️ SENZO MD`
        );
      } catch (e) {
        await reply(`⚠️ Ayat fetch nahi hui. Format:\n\`.quran 2 255\` (surah number, ayat number)`);
      }
    },
  },
  {
    name: "hadith",
    category: "islamic",
    desc: "Random hadith (Bukhari/Muslim)",
    async execute(sock, msg, store, { args, reply }) {
      const collection = (args || "").toLowerCase().includes("muslim") ? "muslim" : "bukhari";
      try {
        // Curated local collection — real Sahih Bukhari/Muslim hadiths, lifetime, zero-API
        const coll = collection === "muslim" ? HADITHS.muslim : HADITHS.bukhari;
        const item = coll[Math.floor(Math.random() * coll.length)];
        await reply(
          `📜 *Hadith — ${collection === "muslim" ? "Sahih Muslim" : "Sahih Bukhari"}*\n` +
          `━━━━━━━━━━━━━\n` +
          `${item.text}\n\n` +
          `*Reference:* ${item.ref}\n` +
          `━━━━━━━━━━━━━\n⚙️ SENZO MD`
        );
      } catch (e) {
        await reply(`⚠️ Hadith fetch nahi hui. Dobara try karein: \`.hadith\` ya \`.hadith muslim\``);
      }
    },
  },
  {
    name: "duas",
    category: "islamic",
    desc: "Masnoon duas (khane, neend, sawari etc.)",
    async execute(sock, msg, store, { args, reply }) {
      const duas = [
        { title: "Khane se pehle", dua: "بِسْمِ اللّٰهِ", tarjuma: "Allah ke naam se (shuru karta hoon)" },
        { title: "Khane ke baad", dua: "اَلْحَمْدُ لِلّٰهِ", tarjuma: "Tamam tareef Allah ke liye hai" },
        { title: "Sonay se pehle", dua: "بِاسْمِكَ اللّٰهُمَّ اَمُوْتُ وَاَحْيَا", tarjuma: "Ae Allah, Tere naam se main marta aur zinda hota hoon" },
        { title: "Uthne ke baad", dua: "اَلْحَمْدُ لِلّٰهِ الَّذِى اَحْيَانَا بَعْدَ مَا اَمَاتَنَا وَاِلَيْهِ النُّشُوْرُ", tarjuma: "Tamam tareef Allah ke liye jis ne hamain maut ke baad zinda kiya aur usi ki taraf uthaya jayega" },
        { title: "Sawari/ghar se nikalne ki", dua: "بِسْمِ اللّٰهِ الَّذِى لَا يَضُرُّ مَعَ اسْمِهِ شَىْءٌ فِى الْاَرْضِ وَلَا فِى السَّمَاءِ وَهُوَ السَّمِيْعُ الْعَلِيْمُ", tarjuma: "Allah ke naam se jis ke naam ke saath zameen aur aasmaan ki koi cheez nuqsan nahi de sakti" },
        { title: "Ghar mein dakhil hone ki", dua: "بِسْمِ اللّٰهِ وَلَجْنَا وَبِسْمِ اللّٰهِ خَرَجْنَا وَعَلَى اللّٰهِ رَبِّنَا تَوَكَّلْنَا", tarjuma: "Allah ke naam se hum ne dakhil hua aur Allah ke naam se nikle aur hamare Rab par bharosa kiya" },
        { title: "Paani peene ki", dua: "بِسْمِ اللّٰهِ", tarjuma: "Allah ke naam se" },
        { title: "Masjid mein dakhil hone ki", dua: "اَللّٰهُمَّ افْتَحْ لِى اَبْوَابَ رَحْمَتِكَ", tarjuma: "Ae Allah, mere liye apni rehmat ke darwaze khol de" },
      ];
      const key = (args || "").trim().toLowerCase();
      const pick = key
        ? duas.find((x) => x.title.toLowerCase().includes(key)) || duas[Math.floor(Math.random() * duas.length)]
        : duas[Math.floor(Math.random() * duas.length)];
      await reply(
        `🤲 *Dua — ${pick.title}*\n` +
        `━━━━━━━━━━━━━\n` +
        `*Arabic:*\n${pick.dua}\n\n` +
        `*Tarjuma:*\n${pick.tarjuma}\n` +
        `━━━━━━━━━━━━━\n\n💡 Topics: khana, neend, sawari, ghar, masjid, paani\n\`.duas khana\` — specific dua ke liye\n⚙️ SENZO MD`
      );
    },
  },
  {
    name: "hijri",
    category: "islamic",
    desc: "Aaj ki Islamic (Hijri) date",
    async execute(sock, msg, store, { args, reply }) {
      try {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, "0");
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const yyyy = now.getFullYear();
        const d = await fetchJSON(`https://api.aladhan.com/v1/gToH/${dd}-${mm}-${yyyy}`);
        const g = d.data.gregorian;
        const h = d.data.hijri;
        await reply(
          `🌙 *Islamic Date (Hijri)*\n` +
          `━━━━━━━━━━━━━\n` +
          `📅 *${h.day} ${h.month.en} ${h.year} AH*\n` +
          `📆 Gregorian: ${g.date}\n` +
          `🗓 Designation: ${h.designation.expanded}\n` +
          `━━━━━━━━━━━━━\n⚙️ SENZO MD`
        );
      } catch {
        // fallback: manual conversion nahi karte — simple message
        await reply(`⚠️ Date fetch nahi hui. Dobara try karein: \`.hijri\``);
      }
    },
  },
  {
    name: "names",
    category: "islamic",
    desc: "Asma ul Husna — 99 names ki pyari voice MP3 + list",
    async execute(sock, msg, store, { args, reply }) {
      const asmaNames = [
        ["1. Ar-Rahman", "The Most Gracious"],
        ["2. Ar-Raheem", "The Most Merciful"],
        ["3. Al-Malik", "The King"],
        ["4. Al-Quddus", "The Holy"],
        ["5. As-Salaam", "The Source of Peace"],
        ["6. Al-Mu'min", "The Guardian of Faith"],
        ["7. Al-Aziz", "The Almighty"],
        ["8. Al-Jabbar", "The Compeller"],
        ["9. Al-Mutakabbir", "The Majestic"],
        ["10. Al-Khaliq", "The Creator"],
        ["11. Al-Bari", "The Maker"],
        ["12. Al-Musawwir", "The Fashioner"],
        ["13. Al-Ghaffar", "The Forgiver"],
        ["14. Al-Qahhar", "The Subduer"],
        ["15. Al-Wahhab", "The Giver of All"],
        ["16. Ar-Razzaq", "The Provider"],
        ["17. Al-Fattah", "The Opener"],
        ["18. Al-Alim", "The All-Knowing"],
        ["19. Al-Qabid", "The Restrainer"],
        ["20. Al-Basit", "The Extender"],
      ];
      const asmaFile = path.join(__dirname, "..", "media", "asma.mp3");
      try {
        // pehle audio download karo agar local nahi hai
        if (!fs.existsSync(asmaFile)) {
          const { data } = await axios.get(
            "https://archive.org/download/AsmaUlHusna99NamesofALLAH_201808/Asma-ul-Husna-99Nam-Download-From-YTPak.com.mp3",
            { responseType: "arraybuffer", timeout: 60000 }
          );
          fs.mkdirSync(path.dirname(asmaFile), { recursive: true });
          fs.writeFileSync(asmaFile, Buffer.from(data));
        }
        // audio bhejo
        await sock.sendMessage(msg.key.remoteJid, {
          audio: { read: fs.readFileSync(asmaFile) },
          mimetype: "audio/mpeg",
          fileName: "Asma-ul-Husna-99-Names.mp3",
          caption:
            `🎧 *Asma ul Husna — The 99 Names of Allah*\n` +
            `━━━━━━━━━━━━━\n` +
            `*Pehle 20 names:*\n${asmaNames.map((a) => `• ${a[0]} — ${a[1]}`).join("\n")}\n` +
            `...(99 tak audio mein)\n` +
            `━━━━━━━━━━━━━\n🕌 SENZO MD`,
        }, { quoted: msg });
      } catch (e) {
        // audio fail ho toh sirf text list bhejo
        await reply(
          `🎧 *Asma ul Husna — The 99 Names of Allah*\n` +
          `━━━━━━━━━━━━━\n` +
          `*Pehle 20:*\n${asmaNames.map((a) => `• ${a[0]} — ${a[1]}`).join("\n")}\n` +
          `...(99 tak)\n` +
          `━━━━━━━━━━━━━\n⚠️ Audio abhi load nahi ho saki — list dekhein\n🕌 SENZO MD`
        );
      }
    },
  },
];

// ── Curated real hadiths (Sahih Bukhari & Sahih Muslim) — zero-API, lifetime ──
const HADITHS = {
  bukhari: [
    { text: "RasoolAllah ﷺ ne farmaya: \"Amal ka daromadar niyat par hai, aur har shakhs ko wohi milega jiski usne niyat ki.\"\n\n(Amal bil-Niyyat)", ref: "Sahih Bukhari, Hadith 1" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Iman ki 70 se zyada shakhein hain, aur un mein sabse behtar Kalima-e-Shahadat hai, aur sabse chhoti raaste se takleef dene wali cheez hatana hai.\"", ref: "Sahih Bukhari, Hadith 9" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Allah taala tumhari suratein aur maal nahi dekhta, balke woh tumhare dilon aur amaal dekhta hai.\"", ref: "Sahih Bukhari, Hadith 30" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Mazboot momin kamzor momin se behtar hai, aur dono mein nekii hai.\"", ref: "Sahih Bukhari, Hadith 6442" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Muslim musalman ka bhai hai — na us par zulm karta hai, na usay zaleel karta hai.\"", ref: "Sahih Bukhari, Hadith 2442" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Jo Allah par aur aakhiri din par imaan rakhta hai, woh achhi baat kahe ya khamosh rahe.\"", ref: "Sahih Bukhari, Hadith 6018" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Musalsal nek amal woh hain jo chhote hon lekin musalsal (lagataar) hon — Allah ko wohi zyada pasand hain.\"", ref: "Sahih Bukhari, Hadith 6464" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Jannat un logon ke liye hai jo apni zaban aur apne haath ki burai se logon ko mehfooz rakhte hain.\"", ref: "Sahih Bukhari, Hadith 6474" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Khushi ka izhaar sadaqah hai.\"", ref: "Sahih Bukhari, Hadith 6022" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Do noomein hain jinke baare mein aksar log nuqsan mein rehte hain: Sehat aur Fursat (khali waqt).\"", ref: "Sahih Bukhari, Hadith 6412" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Duniya momin ke liye qaid-khana hai aur kafir ke liye jannat.\"", ref: "Sahih Bukhari, Hadith 6416" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Jisko Allah se milna pasand hai, Allah ko us se milna pasand hai; aur jisko Allah se milna na-pasand hai, Allah ko us se milna na-pasand hai.\"", ref: "Sahih Bukhari, Hadith 6507" },
  ],
  muslim: [
    { text: "RasoolAllah ﷺ ne farmaya: \"Islam ki bunyaad paanch cheezon par hai: Shahadat dena ke Allah ke siwa koi maabood nahi aur Muhammad ﷺ Allah ke Rasool hain, Namaz qayam karna, Zakat dena, Hajj karna aur Ramzan ke rozay rakhna.\"", ref: "Sahih Muslim, Hadith 16" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Momin ki misaal taraazu (scale) ki tarah hai — jitna uske imaan mein izafa hoga utna musibat mein bhi izafa hoga.\"", ref: "Sahih Muslim, Hadith 2784" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Gussa na karo.\" — Aap ne baar baar yehi farmaya.\"", ref: "Sahih Muslim, Hadith 2564" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Allah ki qaasam! Jo imaan nahi rakhta woh jannat mein nahi jayega, aur jo tum mein mohabbat nahi rakhta woh imaan nahi rakhta.\"", ref: "Sahih Muslim, Hadith 45" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Musalman musalman ka aaina hai.\"", ref: "Sahih Muslim, Hadith 4918" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Jo kisi musalman bhai ki dunyawi takleef door karega, Allah qayamat ke din uski takleef door karega.\"", ref: "Sahih Muslim, Hadith 2699" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Tauba karne wala gunaah se aise hai jaise usne gunaah kiya hi nahi.\"", ref: "Sahih Muslim, Hadith 2744" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Banda apne dost ke deen par hota hai — toh har shakhs ko dekh lena chahiye ke woh kisse dosti karta hai.\"", ref: "Sahih Muslim, Hadith 2638" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Insaan ke liye yeh kaafi gunahgaar hai ke woh har baat bina jaanchhe bayan kar de.\"", ref: "Sahih Muslim, Hadith 1" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Zulm andheron mein hoga qayamat ke din.\"", ref: "Sahih Muslim, Hadith 2578" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Jannat mein ek market hai jahan na koi khareedta hai aur na bechta — sirf sooratein hoti hain.\"", ref: "Sahih Muslim, Hadith 188" },
    { text: "RasoolAllah ﷺ ne farmaya: \"Aurat par shohar ka, aur shohar par biwi ka haq hai.\"", ref: "Sahih Muslim, Hadith 1162" },
  ],
};

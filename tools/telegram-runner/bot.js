const axios = require('axios');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const GeminiAgent = require('./geminiAgent');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ALLOWED_USER_IDS = (process.env.TELEGRAM_ALLOWED_USER_ID || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

if (!TELEGRAM_BOT_TOKEN) {
  console.error('[Error] TELEGRAM_BOT_TOKEN belum diisi di file .env.');
  console.error('Silakan isi TELEGRAM_BOT_TOKEN dan GEMINI_API_KEY terlebih dahulu.');
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.error('[Error] GEMINI_API_KEY belum diisi di file .env.');
  process.exit(1);
}

const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const agent = new GeminiAgent(GEMINI_API_KEY, process.env.GEMINI_MODEL || 'gemini-2.5-flash');

async function telegramRequest(method, payload = {}) {
  try {
    const res = await axios.post(`${TELEGRAM_API_BASE}/${method}`, payload, { timeout: 30000 });
    return res.data;
  } catch (err) {
    console.error(`[Telegram API ${method} Error]:`, err.response?.data || err.message);
    return null;
  }
}

async function sendMessage(chatId, text, parseMode = 'Markdown') {
  return await telegramRequest('sendMessage', {
    chat_id: chatId,
    text: text,
    parse_mode: parseMode
  });
}

async function sendTyping(chatId) {
  return await telegramRequest('sendChatAction', {
    chat_id: chatId,
    action: 'typing'
  });
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const fromId = String(msg.from.id);
  const text = msg.text?.trim() || '';
  const username = msg.from.username || msg.from.first_name || 'User';

  console.log(`[Message from @${username} (ID: ${fromId})]: ${text}`);

  // 1. Security Check
  if (ALLOWED_USER_IDS.length > 0 && !ALLOWED_USER_IDS.includes(fromId)) {
    console.warn(`[Security Alert] Akses ditolak untuk User ID: ${fromId}`);
    await sendMessage(
      chatId,
      `⛔ *Akses Ditolak!*\n\nUser ID Anda (\`${fromId}\`) belum terdaftar di whitelist bot ini.\nSilakan tambahkan ID ini ke \`TELEGRAM_ALLOWED_USER_ID\` di file \`.env\`.`
    );
    return;
  }

  // 2. Command Handlers
  if (text === '/start' || text === '/help') {
    const welcome = `
🚀 *Selamat Datang di Xentra Core AI Runner!*

Halo *${username}*! Bot ini siap mengeksekusi instruksi coding, perbaikan, dan deployment untuk **Xentra Core** langsung dari HP Anda.

📌 *Cara Penggunaan:*
Kirimkan saja instruksi dalam bahasa Indonesia sehari-hari, contohnya:
- _"Ubah warna tema primer brand jadi #b6ff00 dan ganti tagline"_
- _"Jalankan unit test dan periksa apakah ada error"_
- _"Buat diskon ongkir otomatis jika belanja di atas 50rb lalu deploy"_
- _"Tolong deploy commit terbaru ke cPanel sekarang"_

⚡ *Perintah Cepat:*
/status — Cek status bot & server
/test — Jalankan automated unit tests
/deploy — Deploy perubahan saat ini ke dev.mybangjo.com
`;
    await sendMessage(chatId, welcome);
    return;
  }

  if (text === '/status') {
    await sendMessage(
      chatId,
      `🟢 *Xentra Core AI Runner Aktif*\n- Server: Online 24/7\n- Model: \`${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}\`\n- Workspace: \`xentra-core\`\n- Target Deploy: \`dev.mybangjo.com\``
    );
    return;
  }

  // 3. Process AI Task with Gemini Agent
  await sendTyping(chatId);
  const statusMsg = await sendMessage(chatId, `⏳ *Menerima instruksi... Sedang menganalisis repositori Xentra Core...*`);

  const progressUpdates = [];
  const onProgress = async (msgText) => {
    progressUpdates.push(msgText);
    await sendTyping(chatId);
  };

  try {
    const responseText = await agent.runTask(text, onProgress);

    let finalMessage = '';
    if (progressUpdates.length > 0) {
      finalMessage += `*Riwayat Langkah:*\n${progressUpdates.slice(-4).join('\n')}\n\n---\n\n`;
    }
    finalMessage += responseText;

    await sendMessage(chatId, finalMessage);
  } catch (err) {
    console.error('[Agent Execution Error]:', err);
    await sendMessage(
      chatId,
      `❌ *Terjadi Kesalahan saat Mengeksekusi Tugas:*\n\`\`\`\n${err.message}\n\`\`\``
    );
  }
}

// Long Polling Loop
async function startPolling() {
  console.log('====================================================');
  console.log('  🤖 Xentra Core Telegram AI Runner is Starting...  ');
  console.log('====================================================');

  // Verify Bot
  const me = await telegramRequest('getMe');
  if (me && me.result) {
    console.log(`[Connected] Bot Aktif: @${me.result.username} (${me.result.first_name})`);
    console.log(`[Security] Whitelisted User IDs:`, ALLOWED_USER_IDS.length ? ALLOWED_USER_IDS : '(Semua user diizinkan / Development Mode)');
  } else {
    console.error('[Fatal] Gagal memvalidasi bot token Telegram.');
    return;
  }

  let offset = 0;

  while (true) {
    try {
      const res = await axios.get(`${TELEGRAM_API_BASE}/getUpdates`, {
        params: {
          offset: offset,
          timeout: 25
        },
        timeout: 30000
      });

      if (res.data && res.data.ok && Array.isArray(res.data.result)) {
        for (const update of res.data.result) {
          offset = update.update_id + 1;
          if (update.message && update.message.text) {
            await handleMessage(update.message);
          }
        }
      }
    } catch (err) {
      // Ignore network timeout glitches on long polling
      if (!err.message.includes('timeout')) {
        console.warn('[Polling Error]:', err.message);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

startPolling();

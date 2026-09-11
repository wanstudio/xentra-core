const axios = require('axios');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USER_IDS = (process.env.TELEGRAM_ALLOWED_USER_ID || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

if (!TELEGRAM_BOT_TOKEN) {
  console.error('[Error] TELEGRAM_BOT_TOKEN belum diisi di file .env.');
  process.exit(1);
}

const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

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

  if (ALLOWED_USER_IDS.length > 0 && !ALLOWED_USER_IDS.includes(fromId)) {
    console.warn(`[Security Alert] Akses ditolak untuk User ID: ${fromId}`);
    await sendMessage(
      chatId,
      `⛔ *Akses Ditolak!*\n\nUser ID Anda (\`${fromId}\`) belum terdaftar di whitelist bot ini.\nSilakan tambahkan ID ini ke \`TELEGRAM_ALLOWED_USER_ID\` di file \`.env\`.`
    );
    return;
  }

  if (text === '/start' || text === '/help') {
    const welcome = `
🚀 *Selamat Datang di Xentra Core Runner!*

Halo *${username}*! Bot ini siap menjalankan pengujian dan deployment untuk **Xentra Core** langsung dari HP Anda.

⚡ *Perintah Cepat:*
/status — Cek status bot & server
/test — Jalankan automated unit tests
/deploy — Commit & push ke main (deployment mengikuti GitHub Actions/infrastruktur Xentra)
`;
    await sendMessage(chatId, welcome);
    return;
  }

  if (text === '/status') {
    await sendMessage(
      chatId,
      `🟢 *Xentra Core Runner Aktif*\n- Server: Online 24/7\n- Workspace: \`xentra-core\`\n- Target Deploy: Infrastruktur runtime Xentra (via GitHub Actions)`
    );
    return;
  }

  if (text === '/test') {
    await sendTyping(chatId);
    await sendMessage(chatId, `🧪 *Menjalankan Unit Test Suite...*`);
    const { executeTool } = require('./agentTools');
    const testRes = await executeTool('run_tests', {});
    if (testRes.success) {
      await sendMessage(chatId, `✅ *Semua Unit Test Lolos!*\n\`\`\`\n${testRes.test_output}\n\`\`\``);
    } else {
      await sendMessage(chatId, `❌ *Test Gagal:*\n\`\`\`\n${testRes.stderr || testRes.error}\n\`\`\``);
    }
    return;
  }

  if (text === '/deploy') {
    await sendTyping(chatId);
    await sendMessage(chatId, `🚀 *Memulai Deployment...*`);
    const { executeTool } = require('./agentTools');
    const deployRes = await executeTool('deploy_to_cpanel', { commit_message: 'Manual deploy via Telegram /deploy command' });
    if (deployRes.success) {
      await sendMessage(chatId, `🎉 *Deployment Berhasil!*\n\`\`\`\n${deployRes.deploy_output}\n\`\`\``);
    } else {
      await sendMessage(chatId, `❌ *Deploy Gagal:*\n\`\`\`\n${deployRes.stderr || deployRes.error}\n\`\`\``);
    }
    return;
  }

  await sendMessage(chatId, `❓ *Perintah tidak dikenali.*\nKirim */help* untuk daftar perintah yang tersedia.`);
}

async function startPolling() {
  console.log('====================================================');
  console.log('  🤖 Xentra Core Telegram Runner is Starting...  ');
  console.log('====================================================');

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
      if (!err.message.includes('timeout')) {
        console.warn('[Polling Error]:', err.message);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

startPolling();
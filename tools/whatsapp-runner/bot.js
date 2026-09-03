const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const GeminiAgent = require('./geminiAgent');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ALLOWED_NUMBERS = (process.env.ALLOWED_WHATSAPP_NUMBERS || '')
  .split(',')
  .map(num => num.replace(/[^0-9]/g, ''))
  .filter(Boolean);

if (!GEMINI_API_KEY) {
  console.error('[Error] GEMINI_API_KEY belum diisi di file .env.');
  process.exit(1);
}

const agent = new GeminiAgent(GEMINI_API_KEY, process.env.GEMINI_MODEL || 'gemini-2.5-flash');

let currentSock = null;
const processedMessageIds = new Set();

async function connectToWhatsApp() {
  const sessionDir = path.join(__dirname, 'auth_session');
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  console.log('====================================================');
  console.log(`  🤖 Xentra Core WhatsApp AI Runner v${version.join('.')}  `);
  console.log('====================================================');

  if (currentSock) {
    try {
      currentSock.ev.removeAllListeners();
    } catch (_) {}
  }

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    markOnlineOnConnect: true,
    generateHighQualityLinkPreview: false,
    defaultQueryTimeoutMs: 60000,
    connectTimeoutMs: 60000
  });

  currentSock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n📲 SILAKAN SCAN QR CODE INI DENGAN WHATSAPP DI HP ANDA:\n');
      qrcode.generate(qr, { small: true });
      console.log('\n(Buka WA di HP -> Titik tiga -> Perangkat tertaut -> Tautkan perangkat)\n');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[Connection Closed] Reason: ${statusCode || 'Unknown'}. Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        // Wait slightly longer on 440 to allow WhatsApp server to reset stream
        const delay = statusCode === 440 ? 5000 : 3000;
        setTimeout(connectToWhatsApp, delay);
      } else {
        console.log('[Logged Out] Sesi logout. Silakan restart bot untuk scan QR baru.');
      }
    } else if (connection === 'open') {
      console.log('✅ [WhatsApp Connected] Bot BERHASIL TERHUBUNG dan siap menerima perintah!');
      console.log('🔒 Whitelisted Numbers:', ALLOWED_NUMBERS.length ? ALLOWED_NUMBERS : '(Semua nomor diizinkan)');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const msg of messages) {
      if (!msg.message) continue;

      const msgId = msg.key.id;
      if (processedMessageIds.has(msgId)) continue;
      processedMessageIds.add(msgId);
      if (processedMessageIds.size > 2000) processedMessageIds.clear();

      const remoteJid = msg.key.remoteJid;
      if (remoteJid === 'status@broadcast') continue;

      const isFromMe = msg.key.fromMe === true;
      const participant = msg.key.participant || msg.participant || '';
      const senderPhone = (remoteJid + ' ' + participant).replace(/[^0-9]/g, '');

      // Extract message text
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        '';

      if (!text || !text.trim()) continue;

      const trimmedText = text.trim();

      // Avoid processing bot's own responses
      if (
        trimmedText.startsWith('⏳ *Menerima instruksi') ||
        trimmedText.startsWith('🟢 *Xentra Core') ||
        trimmedText.startsWith('*🤖 Selamat Datang') ||
        trimmedText.startsWith('*Langkah Eksekusi:*') ||
        trimmedText.startsWith('❌ *Gagal')
      ) {
        continue;
      }

      console.log(`[Incoming WA Message]: "${trimmedText}" | fromMe: ${isFromMe} | JID: ${remoteJid}`);

      // Security check: Only allow messages from verified sender or whitelisted numbers
      const isAuthorized = isFromMe || (ALLOWED_NUMBERS.length > 0 && ALLOWED_NUMBERS.some(num => senderPhone.includes(num)));

      if (ALLOWED_NUMBERS.length > 0 && !isAuthorized) {
        console.warn(`[Security Blocked] Pesan dari pengirim tidak terdaftar: ${senderPhone}`);
        return;
      }

      console.log(`🚀 [Memproses Tugas]: ${trimmedText}`);

      const reply = async (messageText) => {
        try {
          console.log(`[Mengirim Balasan WA ke ${remoteJid}]: ${messageText.slice(0, 60)}...`);
          await sock.sendMessage(remoteJid, { text: messageText });
        } catch (err) {
          console.error('[Error Mengirim Balasan WA]:', err);
        }
      };

      // Normalized command check (supports "!test", "! test", "/test", "/ test")
      const normalizedCmd = trimmedText.toLowerCase().replace(/\s+/g, ' ');

      if (['!start', '! start', '!help', '! help', '/start', '/ start', '/help', '/ help'].includes(normalizedCmd)) {
        const helpText = `*🤖 Selamat Datang di Xentra Core WhatsApp AI Runner!*\n\nBot ini siap membantu Anda memodifikasi kode, menjalankan pengujian, dan melakukan deployment langsung dari WhatsApp saat PC mati.\n\n📌 *Cara Penggunaan:*\nKirim instruksi Anda dalam bahasa Indonesia biasa, contoh:\n• _"Ganti warna tema brand Bangjo jadi #b6ff00 dan ubah tagline-nya"_\n• _"Jalankan unit test untuk memastikan tidak ada error"_\n• _"Buat diskon ongkir 10rb untuk belanja di atas 50rb lalu deploy ke cPanel"_\n\n⚡ *Perintah Cepat:*\n• *!status* — Cek status bot & environment\n• *!test* — Jalankan automated unit tests\n• *!deploy* — Commit & push ke main (deploy otomatis ke app.mybangjo.com)`;
        await reply(helpText);
        continue;
      }

      if (['!status', '! status', '/status', '/ status'].includes(normalizedCmd)) {
        await reply(`🟢 *Xentra Core WhatsApp AI Runner Aktif*\n• Status: Online 24/7\n• Model: \`${process.env.GEMINI_MODEL || 'gemini-3.7-flash'}\`\n• Workspace: \`xentra-core\`\n• Deploy Target: \`app.mybangjo.com\` (via GitHub Actions)`);
        continue;
      }

      if (['!test', '! test', '/test', '/ test'].includes(normalizedCmd)) {
        await reply(`🧪 *Menjalankan Unit Test Suite...*`);
        const { executeTool } = require('./agentTools');
        const testRes = await executeTool('run_tests', {});
        if (testRes.success) {
          await reply(`✅ *Semua Unit Test Lolos!*\n\`\`\`\n${testRes.test_output}\n\`\`\``);
        } else {
          await reply(`❌ *Test Gagal:*\n\`\`\`\n${testRes.stderr || testRes.error}\n\`\`\``);
        }
        continue;
      }

      if (['!deploy', '! deploy', '/deploy', '/ deploy'].includes(normalizedCmd)) {
        await reply(`🚀 *Memulai Deployment ke cPanel...*`);
        const { executeTool } = require('./agentTools');
        const deployRes = await executeTool('deploy_to_cpanel', { commit_message: 'Manual deploy via WhatsApp !deploy command' });
        if (deployRes.success) {
          await reply(`🎉 *Deployment Berhasil!*\n\`\`\`\n${deployRes.deploy_output}\n\`\`\``);
        } else {
          await reply(`❌ *Deploy Gagal:*\n\`\`\`\n${deployRes.stderr || deployRes.error}\n\`\`\``);
        }
        continue;
      }

      // Process Natural Language Task with Gemini Agent
      await reply(`⏳ *Menerima instruksi... Sedang menganalisis repositori Xentra Core...*`);

      const progressSteps = [];
      const onProgress = async (stepInfo) => {
        progressSteps.push(stepInfo);
      };

      try {
        const responseText = await agent.runTask(trimmedText, onProgress);

        let finalResponse = '';
        if (progressSteps.length > 0) {
          finalResponse += `*Langkah Eksekusi:*\n${progressSteps.slice(-4).join('\n')}\n\n---\n\n`;
        }
        finalResponse += responseText;

        await reply(finalResponse);
      } catch (err) {
        console.error('[WhatsApp Agent Error]:', err);
        await reply(`❌ *Gagal Mengeksekusi Perintah:*\n\n_${err.message}_`);
      }
    }
  });
}

connectToWhatsApp();

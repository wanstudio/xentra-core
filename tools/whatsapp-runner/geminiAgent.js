const axios = require('axios');
const { toolDeclarations, executeTool } = require('./agentTools');

const SYSTEM_INSTRUCTION = `
Kamu adalah Xentra AI Agent Engine, asisten otomatis untuk pengembangan dan deployment proyek Xentra Core (SaaS Restaurant Multi-Tenant & Multi-Branch berbasis Node.js/Express dan SQLite).

Peraturan Kerja:
1. Ketika pengguna memberikan instruksi coding atau penyesuaian fitur via WhatsApp, baca file terkait terlebih dahulu menggunakan tool 'read_file'.
2. Lakukan perubahan kode secara presisi dan bersih menggunakan 'write_file' atau 'replace_in_file'.
3. Selalu pertahankan integritas arsitektur Xentra (Single Source of Truth ongkir, State Machine pesanan, direct payment Midtrans, Clean Architecture).
4. Setelah mengedit kode, jalankan tool 'run_tests' untuk memastikan tidak ada syntax error atau unit test yang gagal.
5. Jika pengguna meminta untuk deploy atau perubahan sudah siap, gunakan tool 'deploy_to_cpanel' untuk commit dan push ke main; GitHub Actions (deploy-app.yml) otomatis mendeploy ke app.mybangjo.com.
6. Format balasan pesan WhatsApp dalam Bahasa Indonesia yang ringkas, jelas, gunakan formatting tebal (*bold*), miring (_italic_), atau monospace (\`code\`) khas WhatsApp.
`;

class GeminiAgent {
  constructor(apiKey, model = 'gemini-2.5-flash') {
    this.apiKey = apiKey;
    this.model = model;
    this.history = [];
  }

  async runTask(userPrompt, onProgress) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const contents = [
      ...this.history,
      {
        role: 'user',
        parts: [{ text: userPrompt }]
      }
    ];

    let maxSteps = 10;

    while (maxSteps > 0) {
      maxSteps--;

      const payload = {
        system_instruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }]
        },
        contents,
        tools: [
          {
            function_declarations: toolDeclarations
          }
        ],
        generationConfig: {
          temperature: 0.2
        }
      };

      let response;
      try {
        response = await axios.post(endpoint, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 45000
        });
      } catch (err) {
        console.error('[GeminiAgent Error]:', err.response?.data || err.message);
        throw new Error(
          err.response?.data?.error?.message || `Gagal menghubungi Gemini API: ${err.message}`
        );
      }

      const candidate = response.data.candidates?.[0];
      if (!candidate || !candidate.content) {
        throw new Error('Tidak menerima respon yang valid dari model AI.');
      }

      const modelContent = candidate.content;
      contents.push(modelContent);

      const functionCalls = modelContent.parts.filter(p => p.functionCall);

      if (!functionCalls || functionCalls.length === 0) {
        const textParts = modelContent.parts.map(p => p.text || '').join('');
        this.history = contents.slice(-6);
        return textParts;
      }

      const functionResponseParts = [];

      for (const part of functionCalls) {
        const fn = part.functionCall;
        const toolName = fn.name;
        const toolArgs = fn.args || {};

        if (onProgress) {
          onProgress(`🛠️ *Menjalankan:* \`${toolName}\``);
        }

        const toolResult = await executeTool(toolName, toolArgs, onProgress);

        functionResponseParts.push({
          functionResponse: {
            name: toolName,
            response: toolResult
          }
        });
      }

      contents.push({
        role: 'user',
        parts: functionResponseParts
      });
    }

    throw new Error('Mencapai batas maksimal langkah eksekusi (max steps reached).');
  }
}

module.exports = GeminiAgent;

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE_ROOT = path.resolve(__dirname, '../../../');
const CORE_ROOT = path.resolve(__dirname, '../../');

function resolveWorkspacePath(relativePath) {
  const clean = relativePath.replace(/^(\.\/|\/)/, '');
  const target = path.resolve(WORKSPACE_ROOT, clean);
  if (!target.startsWith(WORKSPACE_ROOT)) {
    throw new Error('Access denied: path is outside workspace root.');
  }
  return target;
}

const toolDeclarations = [
  {
    name: 'read_file',
    description: 'Membaca isi teks dari sebuah file di dalam repositori Xentra.',
    parameters: {
      type: 'OBJECT',
      properties: {
        file_path: {
          type: 'STRING',
          description: 'Path relatif file dari root workspace, misal: "xentra-core/server/routes/api.js" atau "xentra-core/server/database/db.js"'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'write_file',
    description: 'Menulis atau membuat file baru dengan konten teks lengkap.',
    parameters: {
      type: 'OBJECT',
      properties: {
        file_path: {
          type: 'STRING',
          description: 'Path relatif file yang akan ditulis.'
        },
        content: {
          type: 'STRING',
          description: 'Konten lengkap file.'
        }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'replace_in_file',
    description: 'Mengganti potongan teks (substring) tertentu di dalam file dengan teks baru.',
    parameters: {
      type: 'OBJECT',
      properties: {
        file_path: {
          type: 'STRING',
          description: 'Path relatif file yang akan diedit.'
        },
        target_text: {
          type: 'STRING',
          description: 'Teks lama yang harus cocok persis dengan yang ada di file saat ini.'
        },
        replacement_text: {
          type: 'STRING',
          description: 'Teks baru pengganti.'
        }
      },
      required: ['file_path', 'target_text', 'replacement_text']
    }
  },
  {
    name: 'list_directory',
    description: 'Melihat daftar file dan sub-folder di dalam direktori tertentu.',
    parameters: {
      type: 'OBJECT',
      properties: {
        dir_path: {
          type: 'STRING',
          description: 'Path relatif direktori, misal: "xentra-core/server/services" atau "xentra-core/apps"'
        }
      },
      required: ['dir_path']
    }
  },
  {
    name: 'run_tests',
    description: 'Menjalankan automated unit test suite Xentra Core untuk memastikan tidak ada error logika atau sintaks.',
    parameters: {
      type: 'OBJECT',
      properties: {}
    }
  },
  {
    name: 'deploy_to_cpanel',
    description: 'Melakukan git commit, push ke GitHub, dan men-deploy langsung paket xentra-core ke server cPanel (dev.mybangjo.com).',
    parameters: {
      type: 'OBJECT',
      properties: {
        commit_message: {
          type: 'STRING',
          description: 'Pesan commit deskriptif untuk perubahan yang dilakukan.'
        }
      },
      required: ['commit_message']
    }
  }
];

async function executeTool(toolName, args, onProgress) {
  if (onProgress) onProgress(`⚙️ Menjalankan alat: ${toolName}...`);

  switch (toolName) {
    case 'read_file': {
      const fullPath = resolveWorkspacePath(args.file_path);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `File tidak ditemukan: ${args.file_path}` };
      }
      const content = fs.readFileSync(fullPath, 'utf8');
      return { success: true, file_path: args.file_path, content };
    }

    case 'write_file': {
      const fullPath = resolveWorkspacePath(args.file_path);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, args.content, 'utf8');
      return { success: true, message: `File berhasil ditulis: ${args.file_path}` };
    }

    case 'replace_in_file': {
      const fullPath = resolveWorkspacePath(args.file_path);
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `File tidak ditemukan: ${args.file_path}` };
      }
      let content = fs.readFileSync(fullPath, 'utf8');
      if (!content.includes(args.target_text)) {
        return { success: false, error: `Teks target tidak ditemukan persis di dalam file: ${args.file_path}` };
      }
      content = content.replace(args.target_text, args.replacement_text);
      fs.writeFileSync(fullPath, content, 'utf8');
      return { success: true, message: `Berhasil mengganti teks pada: ${args.file_path}` };
    }

    case 'list_directory': {
      const fullPath = resolveWorkspacePath(args.dir_path || '.');
      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `Direktori tidak ditemukan: ${args.dir_path}` };
      }
      const items = fs.readdirSync(fullPath, { withFileTypes: true }).map(item => ({
        name: item.name,
        type: item.isDirectory() ? 'directory' : 'file'
      }));
      return { success: true, dir_path: args.dir_path, items };
    }

    case 'run_tests': {
      try {
        const output = execSync('node --test tests/**/*.test.js', {
          cwd: CORE_ROOT,
          encoding: 'utf8',
          timeout: 20000
        });
        return { success: true, test_output: output };
      } catch (err) {
        return {
          success: false,
          error: 'Test suite gagal atau terdapat kesalahan sintaks.',
          stdout: err.stdout ? err.stdout.toString() : '',
          stderr: err.stderr ? err.stderr.toString() : err.message
        };
      }
    }

    case 'deploy_to_cpanel': {
      try {
        const commitMsg = (args.commit_message || 'Update via WhatsApp AI Runner').replace(/"/g, '\\"');
        const deployScript = path.join(WORKSPACE_ROOT, 'deploy-core.sh');
        
        const output = execSync(`bash "${deployScript}" "${commitMsg}"`, {
          cwd: WORKSPACE_ROOT,
          encoding: 'utf8',
          timeout: 60000
        });
        return { success: true, deploy_output: output };
      } catch (err) {
        return {
          success: false,
          error: 'Proses deploy gagal.',
          stdout: err.stdout ? err.stdout.toString() : '',
          stderr: err.stderr ? err.stderr.toString() : err.message
        };
      }
    }

    default:
      return { success: false, error: `Tool "${toolName}" tidak dikenali.` };
  }
}

module.exports = {
  toolDeclarations,
  executeTool
};

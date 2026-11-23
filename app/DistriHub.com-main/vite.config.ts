import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
const buildId = process.env.GITHUB_SHA || `local-${Date.now()}`;
export default defineConfig(({ mode }) => {
  const atendimentoChatEnabled = loadEnv(mode, process.cwd(), 'VITE_').VITE_ATENDIMENTO_CHAT === 'true';
  return {
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
    __ATENDIMENTO_CHAT_ENABLED__: JSON.stringify(atendimentoChatEnabled),
  },
  plugins: [react(), {
    name: 'distrihub-build-version',
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'app-version.json', source: JSON.stringify({ buildId, atendimentoChatEnabled }) }); },
  }],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  };
});

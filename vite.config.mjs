import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const REACT_VENDOR = /[/\\]node_modules[/\\](?:react|react-dom|scheduler)[/\\]/;
const FX_VENDOR = /[/\\]node_modules[/\\](?:three|metal-fx|img-fx|thinking-orbs|liquid-gooey|voice-glow|border-beam|bot-avatars)[/\\]/;
const OPENUI_VENDOR = /[/\\]node_modules[/\\]@openuidev[/\\]/;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist',
    // Mantém os arquivos de builds anteriores: uma aba aberta antes do deploy ainda os encontra.
    emptyOutDir: false,
    manifest: true,
    target: 'es2022',
    // Efeitos WebGL/canvas e OpenUI nunca entram no modulepreload da primeira pintura.
    modulePreload: {
      resolveDependencies: (_filename, deps) => deps.filter(d => !/\/(?:fx-|gl-)/.test(d))
    },
    rollupOptions: {
      output: {
        manualChunks: id => {
          if (REACT_VENDOR.test(id)) return 'react';
          if (OPENUI_VENDOR.test(id)) return 'fx-openui';
          const fx = id.match(FX_VENDOR);
          if (fx) return 'fx-' + id.match(/node_modules[/\\]([^/\\]+)/)[1];
        }
      }
    }
  },
  server: { proxy: { '/api': 'http://127.0.0.1:3000', '/oauth-callback.js': 'http://127.0.0.1:3000' } }
});

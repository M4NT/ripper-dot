import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist',
    // Mantém os arquivos de builds anteriores: uma aba aberta antes do deploy ainda os encontra.
    emptyOutDir: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        // Efeitos pesados (WebGL) em chunks próprios: a primeira tela não espera por eles.
        manualChunks: id => /node_modules\/metal-fx/.test(id) ? 'gl-metal' : /node_modules\/react/.test(id) ? 'react' : undefined
      }
    }
  },
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } }
});

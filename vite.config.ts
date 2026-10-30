import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify — file watching is disabled to prevent flickering during agent edits.
    hmr: process.env.DISABLE_HMR !== 'true',
    // Project media (blob uploads/restores) is served by the Express server.
    // The specific /api/media entry must precede the generic /api catch-all so
    // Vite's first-match proxy picks it; both live on the same :3001 server.
    proxy: {
      '/api/media': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Saved projects live on the Express server (:3001); proxy API calls there in dev.
      '/api': 'http://localhost:3001',
    },
  },
});

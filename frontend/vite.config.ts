import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Listen on all interfaces and accept any Host header so an ngrok tunnel
    // on 5173 works (design-contract §0b, §1).
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/socket.io': { target: API, changeOrigin: true, ws: true },
    },
  },
});

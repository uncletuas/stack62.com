import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    // Proxy the admin API to the backend in local dev so the SPA can call
    // a same-origin /v1/admin/* without CORS. Override the target with
    // VITE_DEV_API_TARGET if the backend runs elsewhere.
    proxy: {
      '/v1': {
        target: process.env.VITE_DEV_API_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});

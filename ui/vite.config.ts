import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.D2P_UI_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.D2P_DAEMON_PORT ?? 5174}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});

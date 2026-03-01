import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from '@tanstack/router-plugin/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendPort = env.BACKEND_PORT || 4002

  return {
    plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(), 
    tailwindcss()
  ],
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
        secure: false,
      },
      "/parties": {
        target: "http://localhost:1999",
        changeOrigin: true,
        ws: true,
      },
    },
  },
 }
});

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    // En desarrollo se proxya `/api` para que el navegador hable con el mismo
    // origen: así las cookies del refresh (SameSite=Strict, path=/api/auth) y el
    // CORS no dan guerra. En producción `VITE_API_URL` apunta a la API real.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})

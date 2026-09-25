import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// The dashboard talks to the cloud API through /api. In dev and preview,
// Vite proxies that to the FastAPI server (VITE_API_TARGET, default :8000),
// so no CORS setup is needed. For a static deploy, set VITE_API_URL instead.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const target = env.VITE_API_TARGET || 'http://127.0.0.1:8000'
  const proxy = { '/api': { target, changeOrigin: true } }
  return {
    plugins: [react()],
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
  }
})

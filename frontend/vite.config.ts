import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', ['BACKEND_PORT', 'FRONTEND_PORT'])
  const backendPort = env.BACKEND_PORT || '13013'
  const frontendPort = parseInt(env.FRONTEND_PORT || '13014')

  return {
    plugins: [react()],
    build: {
      outDir: '../backend/static',
      emptyOutDir: true,
    },
    server: {
      port: frontendPort,
      proxy: {
        '/api': `http://localhost:${backendPort}`,
      },
    },
  }
})

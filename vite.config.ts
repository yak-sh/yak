import { defineConfig } from 'vite'
import { fresh } from '@fresh/plugin-vite'

export default defineConfig({
  plugins: [fresh()],
  // Vite can't upgrade websockets itself, but it proxies them: same-origin
  // /ws lands on the sync listener (sync.ts, :5174).
  server: {
    proxy: { '/ws': { target: 'ws://localhost:5174', ws: true } },
  },
})

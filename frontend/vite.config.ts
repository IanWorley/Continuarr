import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The dev server forwards API calls to the backend on Spring Boot's default port.
const API_PATH_PREFIX = '/api'
const BACKEND_URL = 'http://localhost:8080'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      [API_PATH_PREFIX]: BACKEND_URL,
    },
  },
})

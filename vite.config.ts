import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-expect-error — plain .mjs with no type declarations; it is a Node request
// handler, not part of the client bundle.
import { apiMiddleware } from './server/api.mjs'

/**
 * The local backend is mounted straight into Vite's dev and preview servers,
 * so `npm run dev` serves the app and its API from one process on one port.
 * No second terminal, no proxy config, no CORS in the common case.
 *
 * `npm run server` runs the same handler standalone when that is wanted.
 */
function localBackend() {
  return {
    name: 'anadromos-local-backend',
    configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
      server.middlewares.use(apiMiddleware())
    },
    configurePreviewServer(server: { middlewares: { use: (fn: unknown) => void } }) {
      server.middlewares.use(apiMiddleware())
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localBackend()],
})

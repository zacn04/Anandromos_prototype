/**
 * Standalone local backend.
 *
 * Only needed when running the API on its own — `npm run dev` and
 * `npm run preview` both mount the same handler in-process (vite.config.ts),
 * so the usual demo needs no second terminal.
 */
import http from 'node:http'
import { apiMiddleware } from './api.mjs'

const PORT = Number(process.env.PORT ?? 5174)
const handle = apiMiddleware()

http
  .createServer((req, res) => {
    handle(req, res, () => {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
    })
  })
  .listen(PORT, () => {
    console.log(`Anadromos local backend on http://localhost:${PORT}/api`)
  })

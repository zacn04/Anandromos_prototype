/**
 * The local backend's HTTP surface, as a plain Node request handler.
 *
 * Written as connect-style middleware rather than an Express app so the exact
 * same code serves three situations without a framework or a second process:
 *
 *   - `npm run dev`      — mounted into Vite's dev server (see vite.config.ts)
 *   - `npm run preview`  — mounted into Vite's preview server
 *   - `npm run server`   — standalone, for running the API on its own
 *
 * Endpoints (all under /api):
 *   GET    /api/state          every key/value pair, for one-shot hydration
 *   GET    /api/state/:key     one value
 *   PUT    /api/state/:key     store one value (JSON body is the value)
 *   DELETE /api/state          wipe everything ("Reset demo")
 *   GET    /api/health         liveness, so the client can fall back quietly
 */
import { getAll, get, put, clear } from './store.mjs'

const MAX_BODY_BYTES = 1_000_000

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      // Bounded so a runaway client cannot exhaust memory. This is a local
      // demo server, but an unbounded body reader is a bad habit to ship.
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function apiMiddleware() {
  return async function handle(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/api/')) return next?.()

    // Same-origin under Vite; permissive otherwise so the API can be hit from a
    // second browser or device on the LAN during a demo.
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-methods', 'GET,PUT,DELETE,OPTIONS')
    res.setHeader('access-control-allow-headers', 'content-type')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    try {
      if (url.pathname === '/api/health') return json(res, 200, { ok: true })

      if (url.pathname === '/api/state') {
        if (req.method === 'GET') return json(res, 200, await getAll())
        if (req.method === 'DELETE') {
          await clear()
          return json(res, 200, { ok: true })
        }
      }

      const match = /^\/api\/state\/(.+)$/.exec(url.pathname)
      if (match) {
        const key = decodeURIComponent(match[1])
        if (req.method === 'GET') return json(res, 200, { key, value: await get(key) })
        if (req.method === 'PUT') {
          const raw = await readBody(req)
          let value
          try {
            value = raw === '' ? null : JSON.parse(raw)
          } catch {
            return json(res, 400, { error: 'body must be JSON' })
          }
          await put(key, value)
          return json(res, 200, { key, value })
        }
      }

      json(res, 404, { error: 'not found' })
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) })
    }
  }
}

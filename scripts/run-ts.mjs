/**
 * Runs a TypeScript module from `src/` in Node, through Vite's SSR pipeline.
 *
 * `src/` uses bundler-style extensionless imports (`from './store'`), which
 * Node's ESM resolver cannot follow. Vite resolves them the same way the real
 * build does, so a script run this way exercises the actual application
 * modules rather than a re-implementation of them.
 *
 * Usage: node scripts/run-ts.mjs scripts/smoke-engine.ts
 */
import { createServer } from 'vite'
import path from 'node:path'

const target = process.argv[2]
if (!target) {
  console.error('usage: node scripts/run-ts.mjs <path-to-ts-module>')
  process.exit(2)
}

const server = await createServer({
  configFile: false,
  root: path.resolve(import.meta.dirname, '..'),
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true },
  logLevel: 'warn',
})

try {
  await server.ssrLoadModule(path.resolve(target))
} finally {
  await server.close()
}

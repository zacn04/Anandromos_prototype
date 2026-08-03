import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadContent } from './content'
import { hydrate } from './data/persist'

/**
 * Content is awaited exactly once, here, before the first render (§5.9). Every
 * accessor below this point is synchronous, so no component fetches, no
 * Suspense boundary and no loading state exists anywhere else in the app.
 *
 * This does NOT protect module-scope code: `import App from './App.tsx'` is
 * hoisted and the whole import graph is evaluated before the `await` below
 * runs. An accessor call at module scope in any reachable module therefore
 * executes with no store installed, and throws. See §6.12.
 */
const root = createRoot(document.getElementById('root')!)

try {
  // Two awaits, one boot: curriculum content, and whatever the local backend
  // has persisted for this browser. Both resolve before the first render, so
  // every accessor below this point stays synchronous.
  const [, persisted] = await Promise.all([loadContent(), hydrate()])
  if (import.meta.env.DEV) {
    console.info(
      persisted.serverUp
        ? `Anadromos: local backend connected (${persisted.keys} keys)`
        : 'Anadromos: local backend unreachable — using this browser\'s storage',
    )
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
} catch (err) {
  console.error('Anadromos: content failed to load', err)
  root.render(
    <div style={{ padding: 32, fontFamily: 'system-ui', color: '#b6531f' }}>
      Content failed to load. See the console.
    </div>,
  )
}

/**
 * The local backend's storage layer.
 *
 * A JSON file on disk, read and written through a tiny key/value API. Not
 * SQLite and not Postgres, deliberately: at demo scale a file is faster to
 * reason about, diffable, inspectable with `cat`, and has no dependency, no
 * migration story and no daemon. The API surface below is the same shape a
 * real database would sit behind, so replacing this file later changes nothing
 * above it.
 *
 * Writes are serialised through a promise chain. Two concurrent PUTs to
 * different keys would otherwise read-modify-write the same file and one would
 * silently lose — the classic lost-update bug, and exactly the kind of thing
 * that shows up as "the demo forgot what I just did".
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const DATA_DIR = path.resolve(import.meta.dirname, 'data')
const DATA_FILE = path.join(DATA_DIR, 'state.json')

let writeChain = Promise.resolve()

async function readAll() {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, 'utf8'))
  } catch {
    // Missing or corrupt: start clean rather than failing the request.
    return {}
  }
}

async function writeAll(data) {
  await fs.mkdir(DATA_DIR, { recursive: true })
  // Write-then-rename, so a crash mid-write cannot leave a truncated file that
  // reads as "no saved state" on the next boot.
  const tmp = `${DATA_FILE}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2))
  await fs.rename(tmp, DATA_FILE)
}

/** Every stored key/value pair. Used to hydrate the client in one round trip. */
export async function getAll() {
  return readAll()
}

export async function get(key) {
  const all = await readAll()
  return Object.prototype.hasOwnProperty.call(all, key) ? all[key] : null
}

export async function put(key, value) {
  writeChain = writeChain.then(async () => {
    const all = await readAll()
    all[key] = value
    await writeAll(all)
  })
  await writeChain
  return value
}

export async function clear() {
  writeChain = writeChain.then(() => writeAll({}))
  await writeChain
}

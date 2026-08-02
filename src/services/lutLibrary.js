import { parseCubeLut, cubeLutToRgba8 } from '../utils/cubeLut'

// App-level LUT library: import a .cube once, use it in every project.
// Storage is IndexedDB (LUT tables are megabytes-scale — far too big for the
// project JSON or localStorage); clips reference LUTs by id via
// clip.adjustments.lut = { lutId, amount }. A project opened on a machine
// that lacks the LUT renders without it (same graceful degradation as a
// missing font) and the Inspector shows the missing state.
//
// The render path never touches IndexedDB: loadLutLibrary() primes an
// in-memory registry once, and the GPU hosts (gpuCompositor +
// adjustmentsGpu) read synchronously via getLoadedLut() mid-frame.

const DB_NAME = 'comfystudio-luts'
const DB_VERSION = 1
const STORE = 'luts'

export const LUTS_CHANGED_EVENT = 'comfystudio-luts-changed'

const registry = new Map() // lutId -> { id, name, size, rgba8: Uint8Array }
let loadPromise = null

const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION)
  request.onupgradeneeded = () => {
    const db = request.result
    if (!db.objectStoreNames.contains(STORE)) {
      db.createObjectStore(STORE, { keyPath: 'id' })
    }
  }
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error || new Error('Failed to open the LUT library.'))
})

const withStore = async (mode, run) => {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const store = tx.objectStore(STORE)
      const result = run(store)
      tx.oncomplete = () => resolve(result?.result !== undefined ? result.result : result)
      tx.onerror = () => reject(tx.error || new Error('LUT library transaction failed.'))
      tx.onabort = () => reject(tx.error || new Error('LUT library transaction aborted.'))
    })
  } finally {
    db.close()
  }
}

const notifyChanged = () => {
  try {
    window.dispatchEvent(new CustomEvent(LUTS_CHANGED_EVENT))
  } catch (_) { /* non-browser */ }
}

/**
 * Prime the in-memory registry from IndexedDB. Idempotent and cached;
 * callers that must render LUTs (export start, app boot) await this once.
 */
export function loadLutLibrary() {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    try {
      const records = await withStore('readonly', (store) => store.getAll())
      const rows = Array.isArray(records) ? records : []
      for (const row of rows) {
        if (row?.id && row?.rgba8 instanceof Uint8Array && Number.isInteger(row?.size)) {
          registry.set(row.id, { id: row.id, name: row.name || row.id, size: row.size, rgba8: row.rgba8 })
        } else if (row?.id && row?.rgba8?.buffer) {
          // Structured clone can resurface as a plain ArrayBuffer view.
          registry.set(row.id, {
            id: row.id,
            name: row.name || row.id,
            size: row.size,
            rgba8: new Uint8Array(row.rgba8.buffer),
          })
        }
      }
      notifyChanged()
    } catch (err) {
      console.warn('[lutLibrary] load failed:', err?.message || err)
    }
    return registry
  })()
  return loadPromise
}

/** Synchronous registry read for the render path. Null when absent/unloaded. */
export function getLoadedLut(lutId) {
  if (!lutId) return null
  return registry.get(lutId) || null
}

/** Sorted metadata list for the Inspector dropdown. */
export function listLoadedLuts() {
  return [...registry.values()]
    .map(({ id, name, size }) => ({ id, name, size }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const makeLutId = (name) => {
  const slug = String(name || 'lut').replace(/\.cube$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 48)
  return `lut-${slug}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Parse and store a .cube file. Resolves with the library entry metadata;
 * throws with a user-readable message on parse failure.
 */
export async function importCubeLutFile(file) {
  const text = await file.text()
  const baseName = String(file?.name || 'LUT').replace(/\.cube$/i, '')
  const parsed = parseCubeLut(text, { name: baseName })
  const record = {
    id: makeLutId(baseName),
    name: parsed.title && parsed.title !== baseName ? `${baseName}` : baseName,
    size: parsed.size,
    rgba8: cubeLutToRgba8(parsed),
    createdAt: Date.now(),
  }
  await withStore('readwrite', (store) => store.put(record))
  registry.set(record.id, { id: record.id, name: record.name, size: record.size, rgba8: record.rgba8 })
  notifyChanged()
  return { id: record.id, name: record.name, size: record.size }
}

export async function deleteLut(lutId) {
  if (!lutId) return
  await withStore('readwrite', (store) => store.delete(lutId))
  registry.delete(lutId)
  notifyChanged()
}

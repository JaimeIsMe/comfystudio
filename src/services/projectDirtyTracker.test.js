import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ASSETS_PROJECT_KEYS,
  PROJECT_STORE_KEYS,
  TIMELINE_PROJECT_KEYS,
  attachProjectDirtyWatchers,
  isProjectDirty,
  markProjectClean,
  markProjectDirty,
  watchStoreForProjectChanges,
} from './projectDirtyTracker.js'

// Minimal stand-in for a zustand store: subscribe(listener) with
// listener(state, previousState), plus an emit helper for tests.
function makeFakeStore(initialState = {}) {
  let state = initialState
  const listeners = new Set()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setState(partial) {
      const previous = state
      state = { ...state, ...partial }
      listeners.forEach((listener) => listener(state, previous))
    },
  }
}

test('marks dirty when a watched key gets a new reference', () => {
  markProjectClean()
  const store = makeFakeStore({ clips: [], playheadPosition: 0 })
  const stop = watchStoreForProjectChanges(store, ['clips'])

  store.setState({ clips: [{ id: 'clip-1' }] })
  assert.equal(isProjectDirty(), true)
  stop()
})

test('ignores changes to unwatched volatile keys', () => {
  markProjectClean()
  const clips = []
  const store = makeFakeStore({ clips, playheadPosition: 0, isPlaying: false })
  const stop = watchStoreForProjectChanges(store, ['clips'])

  // Playback: playhead and isPlaying churn, clips reference unchanged.
  store.setState({ playheadPosition: 1.5, isPlaying: true })
  store.setState({ playheadPosition: 3.0 })
  assert.equal(isProjectDirty(), false)
  stop()
})

test('an identical reference does not mark dirty', () => {
  markProjectClean()
  const tracks = [{ id: 'video-1' }]
  const store = makeFakeStore({ tracks })
  const stop = watchStoreForProjectChanges(store, ['tracks'])

  store.setState({ tracks })
  assert.equal(isProjectDirty(), false)
  stop()
})

test('markProjectClean resets after a save', () => {
  markProjectDirty()
  assert.equal(isProjectDirty(), true)
  markProjectClean()
  assert.equal(isProjectDirty(), false)
})

test('save-order race: the save-induced store update lands before markProjectClean', () => {
  markProjectClean()
  const store = makeFakeStore({ currentProject: { name: 'A' } })
  const stop = watchStoreForProjectChanges(store, ['currentProject'])

  // saveProject replaces currentProject (new modified timestamp)...
  store.setState({ currentProject: { name: 'A', modified: 'now' } })
  assert.equal(isProjectDirty(), true)
  // ...then calls markProjectClean() as its final step.
  markProjectClean()
  assert.equal(isProjectDirty(), false)
  stop()
})

test('attachProjectDirtyWatchers wires all three stores and stop() detaches', () => {
  markProjectClean()
  const timelineStore = makeFakeStore({ clips: [] })
  const assetsStore = makeFakeStore({ assets: [] })
  const projectStore = makeFakeStore({ currentTimelineId: 't1' })

  const stop = attachProjectDirtyWatchers({ timelineStore, assetsStore, projectStore })

  assetsStore.setState({ assets: [{ id: 'a1' }] })
  assert.equal(isProjectDirty(), true)

  markProjectClean()
  projectStore.setState({ currentTimelineId: 't2' })
  assert.equal(isProjectDirty(), true)

  markProjectClean()
  stop()
  timelineStore.setState({ clips: [{ id: 'c1' }] })
  assert.equal(isProjectDirty(), false, 'detached watcher must not mark dirty')
})

test('a missing previous state fails safe toward dirty', () => {
  markProjectClean()
  const store = makeFakeStore({ clips: [] })
  const stop = store.subscribe.call(store, () => {})
  stop()
  // Simulate a subscriber invoked without previousState.
  const detach = watchStoreForProjectChanges(
    { subscribe: (listener) => { listener({ clips: [] }, undefined); return () => {} } },
    ['clips']
  )
  assert.equal(isProjectDirty(), true)
  detach()
})

test('watched key lists match the save path shape', () => {
  // Guard against accidental emptying; the real sync check is the comment in
  // the module pointing at getProjectData.
  assert.ok(TIMELINE_PROJECT_KEYS.includes('clips'))
  assert.ok(TIMELINE_PROJECT_KEYS.includes('tracks'))
  assert.ok(TIMELINE_PROJECT_KEYS.includes('markers'))
  assert.ok(!TIMELINE_PROJECT_KEYS.includes('playheadPosition'))
  assert.ok(!TIMELINE_PROJECT_KEYS.includes('isPlaying'))
  assert.ok(ASSETS_PROJECT_KEYS.includes('assets'))
  assert.ok(PROJECT_STORE_KEYS.includes('currentProject'))
})

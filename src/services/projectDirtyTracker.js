// Tracks whether the open project has unsaved changes, so autosave can skip
// the expensive save path (full getProjectData serialization, a playhead
// thumbnail capture, and two disk writes) when nothing changed.
//
// Store updates here are immutable, so a changed top-level reference is a
// reliable "this slice really changed" signal — the same property the
// debounced persist storage in timelineStore relies on. Volatile fields
// (playhead, isPlaying, selection) are simply not in the watched key lists,
// so playback and scrubbing never mark the project dirty.
//
// This module imports nothing. projectStore imports markProjectClean from
// here, and App wires the store watchers in — keeping the dependency graph
// acyclic.

// Mirrors timelineStore.getProjectData(). Keep in sync when that changes.
export const TIMELINE_PROJECT_KEYS = [
  'duration',
  'zoom',
  'masterAudioVolume',
  'masterAudioInserts',
  'tracks',
  'clips',
  'transitions',
  'markers',
  'clipCounter',
  'transitionCounter',
  'markerCounter',
  'snappingEnabled',
  'snappingThreshold',
  'rippleEditMode',
]

// Mirrors what saveProject reads from the assets store.
export const ASSETS_PROJECT_KEYS = [
  'assets',
  'folders',
  'folderCounter',
]

// Project-level fields that land in the saved JSON. currentProject covers
// renames and settings edits; saveProject itself replaces currentProject,
// which transiently marks dirty — saveProject calls markProjectClean() after
// its own set(), so the order works out.
export const PROJECT_STORE_KEYS = [
  'currentProject',
  'currentTimelineId',
]

let dirty = false

export function markProjectDirty() {
  dirty = true
}

export function markProjectClean() {
  dirty = false
}

export function isProjectDirty() {
  return dirty
}

function anyKeyChanged(state, previousState, keys) {
  if (!state || !previousState) return true
  for (const key of keys) {
    if (state[key] !== previousState[key]) return true
  }
  return false
}

export function watchStoreForProjectChanges(store, keys) {
  return store.subscribe((state, previousState) => {
    if (anyKeyChanged(state, previousState, keys)) markProjectDirty()
  })
}

// App calls this once with the real store hooks. Returns a stop function.
export function attachProjectDirtyWatchers({ timelineStore, assetsStore, projectStore }) {
  const unsubscribers = [
    watchStoreForProjectChanges(timelineStore, TIMELINE_PROJECT_KEYS),
    watchStoreForProjectChanges(assetsStore, ASSETS_PROJECT_KEYS),
    watchStoreForProjectChanges(projectStore, PROJECT_STORE_KEYS),
  ]
  return () => {
    unsubscribers.forEach((unsubscribe) => {
      try { unsubscribe?.() } catch (_) { /* already stopped */ }
    })
  }
}

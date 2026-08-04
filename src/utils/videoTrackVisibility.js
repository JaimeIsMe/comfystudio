// Shared visibility rules for video tracks. A video solo is a temporary
// monitoring override: it does not rewrite the user's eye/visibility choices.
// Multiple tracks may be soloed together, and solo never overrides a hidden or
// muted track.

export function hasVideoSolo(tracks = []) {
  return (tracks || []).some((track) => track?.type === 'video' && track.solo === true)
}

export function isVideoTrackVisible(track, anySolo = false) {
  if (!track || track.type !== 'video') return false
  if (track.visible === false) return false
  if (track.muted === true) return false
  if (anySolo && track.solo !== true) return false
  return true
}

/**
 * Fold video solo state into visibility for consumers such as interchange
 * exporters that already understand hidden tracks but not solo.
 */
export function applyVideoSoloAsHidden(tracks = []) {
  const anySolo = hasVideoSolo(tracks)
  if (!anySolo) return tracks
  return (tracks || []).map((track) => (
    track?.type === 'video' && !isVideoTrackVisible(track, anySolo)
      ? { ...track, visible: false }
      : track
  ))
}

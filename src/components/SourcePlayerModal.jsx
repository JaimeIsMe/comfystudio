import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react'
import { useTimelineStore } from '../stores/timelineStore'

// Source Player (issue #89): mark In/Out on a video or audio asset, then
// insert only that range onto the timeline as a pre-trimmed clip. The clip is
// born with trimStart + duration, so the timeline trim handles can still
// reveal the rest of the source afterwards — nothing destructive.
//
// Keyboard grammar is the NLE standard: I / O mark points at the playhead,
// X clears, Space plays, arrow keys step frames. Playback is range-bounded:
// play stops at the Out point and restarts from In, so you audition the
// select rather than the whole file.

const formatTc = (seconds) => {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`
}

const makeSourcePlayerLinkGroupId = (asset) => {
  const safeAssetId = String(asset?.id || 'asset').replace(/[^a-zA-Z0-9_-]+/g, '_')
  return `link-srcplayer-${safeAssetId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export default function SourcePlayerModal({ asset, onClose }) {
  const videoRef = useRef(null)
  const barRef = useRef(null)
  const playheadRef = useRef(null)
  const tcRef = useRef(null)
  const draggingRef = useRef(null)

  const [sourceDuration, setSourceDuration] = useState(
    Number(asset?.duration ?? asset?.settings?.duration) || 0
  )
  const [inPoint, setInPoint] = useState(null)
  const [outPoint, setOutPoint] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [footerNote, setFooterNote] = useState({ tone: 'muted', text: '' })

  const isAudio = asset?.type === 'audio'
  const sourceFps = Number(asset?.settings?.fps ?? asset?.fps) || 24
  const frameStep = 1 / sourceFps

  const effIn = inPoint ?? 0
  const effOut = outPoint ?? sourceDuration
  const hasRange = inPoint != null || outPoint != null
  const rangeDuration = Math.max(0, effOut - effIn)

  const clampT = useCallback(
    (value) => Math.max(0, Math.min(sourceDuration || 0, value)),
    [sourceDuration]
  )

  // Position readouts bypass React: the playhead line and timecode update on
  // every animation frame, and re-rendering the modal 60×/s for a moving
  // <div> is the exact class of mistake the playback-perf work removed.
  useEffect(() => {
    let raf = null
    const tick = () => {
      const video = videoRef.current
      if (video) {
        const t = video.currentTime || 0
        const total = sourceDuration || video.duration || 1
        if (playheadRef.current) {
          playheadRef.current.style.left = `${Math.min(100, (t / total) * 100)}%`
        }
        if (tcRef.current) tcRef.current.textContent = formatTc(t)
        if (!video.paused && outPoint != null && t >= outPoint - 0.001) {
          video.pause()
          video.currentTime = outPoint
          setIsPlaying(false)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [sourceDuration, outPoint])

  const seekTo = useCallback((value) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = clampT(value)
  }, [clampT])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      if (outPoint != null && video.currentTime >= outPoint - 0.001) {
        video.currentTime = effIn
      }
      void video.play()
      setIsPlaying(true)
    } else {
      video.pause()
      setIsPlaying(false)
    }
  }, [effIn, outPoint])

  const stepFrame = useCallback((direction) => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    setIsPlaying(false)
    video.currentTime = clampT((video.currentTime || 0) + direction * frameStep)
  }, [clampT, frameStep])

  const markIn = useCallback(() => {
    const t = videoRef.current?.currentTime ?? 0
    setInPoint(Math.min(t, (outPoint ?? sourceDuration) - frameStep))
  }, [outPoint, sourceDuration, frameStep])

  const markOut = useCallback(() => {
    const t = videoRef.current?.currentTime ?? 0
    setOutPoint(Math.max(t, (inPoint ?? 0) + frameStep))
  }, [inPoint, frameStep])

  const clearRange = useCallback(() => {
    setInPoint(null)
    setOutPoint(null)
  }, [])

  // Capture-phase listener so I/O/X/Space never fall through to the global
  // timeline shortcuts (X is cut-at-playhead out there).
  useEffect(() => {
    const handler = (event) => {
      const tag = String(event.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || event.target?.isContentEditable) return
      const key = event.key
      const handled = ['i', 'I', 'o', 'O', 'x', 'X', ' ', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(key)
      if (!handled) return
      event.preventDefault()
      event.stopPropagation()
      if (key === 'i' || key === 'I') markIn()
      else if (key === 'o' || key === 'O') markOut()
      else if (key === 'x' || key === 'X') clearRange()
      else if (key === ' ') togglePlay()
      else if (key === 'ArrowLeft') stepFrame(-1)
      else if (key === 'ArrowRight') stepFrame(1)
      else if (key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [markIn, markOut, clearRange, togglePlay, stepFrame, onClose])

  // Scrub bar: click/drag scrubs, gold handles drag the In/Out points.
  const positionToTime = useCallback((clientX) => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return 0
    return clampT(((clientX - rect.left) / rect.width) * (sourceDuration || 0))
  }, [clampT, sourceDuration])

  const applyPointer = useCallback((event) => {
    if (!draggingRef.current) return
    const t = positionToTime(event.clientX)
    if (draggingRef.current === 'in') {
      setInPoint(Math.min(t, (outPoint ?? sourceDuration) - frameStep))
    } else if (draggingRef.current === 'out') {
      setOutPoint(Math.max(t, (inPoint ?? 0) + frameStep))
    } else {
      videoRef.current?.pause?.()
      setIsPlaying(false)
      seekTo(t)
    }
  }, [positionToTime, inPoint, outPoint, sourceDuration, frameStep, seekTo])

  const onBarPointerDown = useCallback((event) => {
    const targetRole = event.target?.dataset?.role
    draggingRef.current = targetRole === 'in-handle' ? 'in' : targetRole === 'out-handle' ? 'out' : 'scrub'
    barRef.current?.setPointerCapture?.(event.pointerId)
    applyPointer(event)
  }, [applyPointer])

  const onBarPointerMove = applyPointer

  const onBarPointerUp = useCallback(() => {
    draggingRef.current = null
  }, [])

  // ---- Insert ----------------------------------------------------------

  const resolveTargetTrack = useCallback(() => {
    const state = useTimelineStore.getState()
    const wantType = isAudio ? 'audio' : 'video'
    const tracks = state.tracks || []
    const active = tracks.find((track) => track.id === state.activeTrackId)
    if (active && active.type === wantType && active.locked !== true) return active
    return tracks.find((track) => track.type === wantType && track.locked !== true) || null
  }, [isAudio])

  const handleInsert = useCallback((where) => {
    const state = useTimelineStore.getState()
    const track = resolveTargetTrack()
    if (!track) {
      setFooterNote({ tone: 'error', text: `No unlocked ${isAudio ? 'audio' : 'video'} track available — add one first.` })
      return
    }
    const fps = Number(state.timelineFps) || 24
    const startTime = where === 'playhead'
      ? Math.max(0, Number(state.playheadPosition) || 0)
      : (state.clips || [])
        .filter((clip) => clip.trackId === track.id)
        .reduce((end, clip) => Math.max(end, (Number(clip.startTime) || 0) + (Number(clip.duration) || 0)), 0)

    const trimOverrides = hasRange
      ? { trimStart: effIn, duration: Math.max(1 / fps, rangeDuration) }
      : {}

    // Linked embedded audio, in exact parity with drag-drop and the MCP
    // placement path — including the range trim, so picture and sound stay
    // in sync on a partial insert.
    const includeLinkedAudio = !isAudio
      && String(asset?.type || '').toLowerCase() === 'video'
      && asset?.hasAudio !== false
      && asset?.audioEnabled !== false
    const audioTrack = includeLinkedAudio
      ? (state.tracks || []).find((candidate) => (
        candidate.type === 'audio' && candidate.locked !== true && candidate.visible !== false
      )) || null
      : null
    const linkGroupId = audioTrack ? makeSourcePlayerLinkGroupId(asset) : undefined

    const clip = state.addClip?.(track.id, asset, startTime, fps, {
      ...trimOverrides,
      metadata: { addedBySourcePlayer: true },
      ...(linkGroupId ? { linkGroupId, selectAfterAdd: false } : {}),
    })
    if (!clip) {
      setFooterNote({ tone: 'error', text: 'Could not add the clip to the timeline.' })
      return
    }

    let audioClip = null
    if (audioTrack && linkGroupId) {
      audioClip = useTimelineStore.getState().addClip?.(audioTrack.id, { ...asset, type: 'audio' }, clip.startTime, fps, {
        saveHistory: false,
        linkGroupId,
        selectAfterAdd: false,
        duration: clip.duration,
        ...(trimOverrides.trimStart != null ? { trimStart: trimOverrides.trimStart } : {}),
        metadata: {
          addedBySourcePlayer: true,
          linkedVideoClipId: clip.id,
          embeddedAudioFromVideoAsset: true,
        },
      })
      useTimelineStore.setState(() => ({
        selectedClipIds: audioClip ? [clip.id, audioClip.id] : [clip.id],
      }))
    }

    setFooterNote({
      tone: 'success',
      text: hasRange
        ? `Inserted ${formatTc(clip.duration)} (source ${formatTc(effIn)} → ${formatTc(effOut)}) on ${track.name || track.id} at ${formatTc(clip.startTime)}.`
        : `Inserted the full clip on ${track.name || track.id} at ${formatTc(clip.startTime)}.`,
    })
  }, [asset, effIn, effOut, hasRange, isAudio, rangeDuration, resolveTargetTrack])

  const targetTrackLabel = useMemo(() => {
    const track = resolveTargetTrack()
    return track ? (track.name || track.id) : null
  }, [resolveTargetTrack])

  if (!asset) return null

  const barPct = (value) => `${sourceDuration > 0 ? Math.min(100, (value / sourceDuration) * 100) : 0}%`

  return (
    <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-5xl max-h-[92vh] overflow-hidden rounded-2xl border border-sf-dark-700 bg-sf-dark-950 shadow-[0_30px_60px_rgba(0,0,0,0.35)]">
        <div className="flex items-center gap-3 border-b border-sf-dark-700 px-5 py-3">
          <div className="text-sm font-semibold text-sf-text-primary">Source Player</div>
          <div className="min-w-0 truncate text-xs text-sf-text-muted">
            {asset.name || asset.id} · {formatTc(sourceDuration)}{isAudio ? ' · audio' : ''}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg border border-sf-dark-600 bg-sf-dark-900 px-3 py-2 text-xs text-sf-text-primary hover:bg-sf-dark-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pt-4">
          <div className="relative flex h-[380px] items-center justify-center overflow-hidden rounded-xl border border-sf-dark-700 bg-black">
            <video
              ref={videoRef}
              src={asset.url}
              className="h-full w-full object-contain"
              onLoadedMetadata={(event) => {
                const mediaDuration = Number(event.currentTarget?.duration)
                if (Number.isFinite(mediaDuration) && mediaDuration > 0) setSourceDuration(mediaDuration)
              }}
              onEnded={() => setIsPlaying(false)}
            />
            {isAudio && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-sf-text-muted">
                Audio source — use the transport below
              </div>
            )}
            {hasRange && (
              <span className="absolute left-3 bottom-2.5 rounded bg-black/60 px-2 py-0.5 font-mono text-[11px] text-sf-accent">
                range {formatTc(effIn)} → {formatTc(effOut)}
              </span>
            )}
            <span ref={tcRef} className="absolute right-3 bottom-2.5 rounded bg-black/60 px-2 py-0.5 font-mono text-[11px] text-white">
              00:00.0
            </span>
          </div>

          <div
            ref={barRef}
            onPointerDown={onBarPointerDown}
            onPointerMove={onBarPointerMove}
            onPointerUp={onBarPointerUp}
            className="relative mt-4 h-6 cursor-pointer touch-none select-none rounded-md bg-sf-dark-800"
          >
            {hasRange && (
              <>
                <div
                  className="absolute bottom-0 top-0 border-y-2 border-sf-accent bg-sf-accent/20"
                  style={{ left: barPct(effIn), width: barPct(rangeDuration) }}
                />
                <div
                  data-role="in-handle"
                  className="absolute -bottom-1 -top-1 z-[3] w-3 cursor-ew-resize rounded bg-sf-accent"
                  style={{ left: `calc(${barPct(effIn)} - 6px)` }}
                  title="In point — drag, or press I at the playhead"
                />
                <div
                  data-role="out-handle"
                  className="absolute -bottom-1 -top-1 z-[3] w-3 cursor-ew-resize rounded bg-sf-accent"
                  style={{ left: `calc(${barPct(effOut)} - 6px)` }}
                  title="Out point — drag, or press O at the playhead"
                />
              </>
            )}
            <div ref={playheadRef} className="pointer-events-none absolute -bottom-1.5 -top-1.5 z-[2] w-0.5 bg-white" />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={togglePlay} className="inline-flex items-center gap-1.5 rounded-lg bg-sf-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-sf-accent/90">
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {isPlaying ? 'Pause' : 'Play'}
              <span className="rounded border border-white/30 px-1 font-mono text-[10px] opacity-80">Space</span>
            </button>
            <button type="button" onClick={() => stepFrame(-1)} title="Back one frame (←)" className="rounded-lg border border-sf-dark-600 bg-sf-dark-900 px-2.5 py-1.5 text-xs text-sf-text-primary hover:bg-sf-dark-800">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => stepFrame(1)} title="Forward one frame (→)" className="rounded-lg border border-sf-dark-600 bg-sf-dark-900 px-2.5 py-1.5 text-xs text-sf-text-primary hover:bg-sf-dark-800">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={markIn} className="rounded-lg border border-sf-dark-600 bg-sf-dark-900 px-3 py-1.5 text-xs text-sf-text-primary hover:bg-sf-dark-800">
              Mark In <span className="ml-1 rounded border border-sf-dark-500 px-1 font-mono text-[10px] text-sf-text-muted">I</span>
            </button>
            <button type="button" onClick={markOut} className="rounded-lg border border-sf-dark-600 bg-sf-dark-900 px-3 py-1.5 text-xs text-sf-text-primary hover:bg-sf-dark-800">
              Mark Out <span className="ml-1 rounded border border-sf-dark-500 px-1 font-mono text-[10px] text-sf-text-muted">O</span>
            </button>
            <button type="button" onClick={clearRange} className="rounded-lg border border-sf-dark-600 bg-sf-dark-900 px-3 py-1.5 text-xs text-sf-text-muted hover:bg-sf-dark-800 hover:text-sf-text-primary">
              Clear <span className="ml-1 rounded border border-sf-dark-500 px-1 font-mono text-[10px]">X</span>
            </button>
            <div className="ml-auto flex gap-4 font-mono text-[11px] text-sf-text-muted">
              <span>In <span className="text-sf-text-primary">{formatTc(inPoint)}</span></span>
              <span>Out <span className="text-sf-text-primary">{formatTc(outPoint)}</span></span>
              <span>Range <span className="text-sf-accent">{hasRange ? formatTc(rangeDuration) : 'full clip'}</span></span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 border-t border-sf-dark-700 px-5 py-3.5">
          <span className={`min-w-0 flex-1 truncate text-xs ${footerNote.tone === 'error' ? 'text-sf-error' : footerNote.tone === 'success' ? 'text-sf-success' : 'text-sf-text-muted'}`}>
            {footerNote.text || (targetTrackLabel
              ? `Inserts target ${targetTrackLabel} (the active track). No range marked = full clip.`
              : 'No compatible track on this timeline yet.')}
          </span>
          <button
            type="button"
            onClick={() => handleInsert('end')}
            className="rounded-lg border border-sf-dark-600 bg-sf-dark-900 px-3.5 py-2 text-xs text-sf-text-primary hover:bg-sf-dark-800"
          >
            Add to end of track
          </button>
          <button
            type="button"
            onClick={() => handleInsert('playhead')}
            className="rounded-lg bg-sf-accent px-3.5 py-2 text-xs font-medium text-white hover:bg-sf-accent/90"
          >
            Insert at playhead
          </button>
        </div>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { useAssetsStore } from '../stores/assetsStore'
import { useTimelineStore } from '../stores/timelineStore'

// Source controls (issue #89): mark In/Out on the previewed video/audio asset,
// then insert only that range onto the timeline as a pre-trimmed clip. Lives
// under the preview monitor in asset mode — the timeline stays visible, so
// "Insert at playhead" lands before your eyes (the old Source Player modal
// covered the timeline, which made inserting blind; that is why it was
// retired in favor of this).
//
// Keyboard grammar is the NLE standard while the monitor is in asset mode:
// I / O mark points at the playhead, X clears, Space plays, arrow keys step
// frames. Playback is range-bounded: play stops at the Out point and restarts
// from In, so you audition the select rather than the whole file.
//
// The clip is born with trimStart + duration, so the timeline trim handles
// can still reveal the rest of the source afterwards — nothing destructive.

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

// The asset preview <video> element is owned by PreviewPanel and registered
// into the assets store; grab it lazily so registration timing (cleared and
// re-registered on every preview switch) never leaves us holding a stale node.
const getPreviewVideo = () => useAssetsStore.getState().videoRef || null

// Scrub seeks are coalesced: a video seek is asynchronous and can take
// 100-300ms on long-GOP sources, while pointermove fires far faster than
// that. Issuing every move as a seek starves the decoder and the frame only
// catches up on release. Instead, while a seek is in flight we remember only
// the LATEST requested position and issue it when 'seeked' fires — dropped
// intermediates were stale the moment the pointer moved on.
const issueCoalescedSeek = (video, target, pendingRef) => {
  pendingRef.current = null
  video.currentTime = target
  video.addEventListener('seeked', () => {
    if (pendingRef.current != null) {
      issueCoalescedSeek(video, pendingRef.current, pendingRef)
    }
  }, { once: true })
}

// Inserts follow the active track when it is type-compatible and unlocked,
// else fall back to the first compatible unlocked track — the same idiom as
// drag-drop placement in Timeline.jsx.
const resolveTargetTrack = (tracks, activeTrackId, isAudio) => {
  const wantType = isAudio ? 'audio' : 'video'
  const all = tracks || []
  const active = all.find((track) => track.id === activeTrackId)
  if (active && active.type === wantType && active.locked !== true) return active
  return all.find((track) => track.type === wantType && track.locked !== true) || null
}

export default function PreviewSourceControls({ asset }) {
  const barRef = useRef(null)
  const playheadRef = useRef(null)
  const tcRef = useRef(null)
  const draggingRef = useRef(null)
  const pendingSeekRef = useRef(null)

  const isPlaying = useAssetsStore((s) => s.isPlaying)
  const storeDuration = useAssetsStore((s) => s.duration)
  const setPreviewMode = useAssetsStore((s) => s.setPreviewMode)
  const timelineTracks = useTimelineStore((s) => s.tracks)
  const activeTrackId = useTimelineStore((s) => s.activeTrackId)

  const [inPoint, setInPoint] = useState(null)
  const [outPoint, setOutPoint] = useState(null)
  const [footerNote, setFooterNote] = useState({ tone: 'muted', text: '' })
  const noteTimerRef = useRef(null)

  // Success notes are transient so the live "Inserts to <track>" label comes
  // back — otherwise the note would hide track changes made after an insert.
  // Errors stay until the user acts; they are instructions, not receipts.
  const showFooterNote = useCallback((note) => {
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    setFooterNote(note)
    if (note.tone === 'success') {
      noteTimerRef.current = setTimeout(() => {
        setFooterNote({ tone: 'muted', text: '' })
      }, 4000)
    }
  }, [])

  useEffect(() => () => {
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
  }, [])

  // The range belongs to the asset being auditioned, not to the panel.
  useEffect(() => {
    setInPoint(null)
    setOutPoint(null)
    setFooterNote({ tone: 'muted', text: '' })
    pendingSeekRef.current = null
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
  }, [asset?.id])

  const isAudio = asset?.type === 'audio'
  const sourceFps = Number(asset?.settings?.fps ?? asset?.fps) || 24
  const frameStep = 1 / sourceFps
  const sourceDuration = (Number(storeDuration) > 0 && Number.isFinite(Number(storeDuration)))
    ? Number(storeDuration)
    : Number(asset?.duration ?? asset?.settings?.duration) || 0

  const effIn = inPoint ?? 0
  const effOut = outPoint ?? sourceDuration
  const hasRange = inPoint != null || outPoint != null
  const rangeDuration = Math.max(0, effOut - effIn)

  const clampT = useCallback(
    (value) => Math.max(0, Math.min(sourceDuration || 0, value)),
    [sourceDuration]
  )

  // Position readouts bypass React: the playhead line and timecode update on
  // every animation frame, and re-rendering the panel 60×/s for a moving
  // <div> is the exact class of mistake the playback-perf work removed.
  useEffect(() => {
    let raf = null
    const tick = () => {
      const video = getPreviewVideo()
      if (video) {
        // During a coalesced scrub the pending target is where the user's
        // hand is; the video's own time trails it by one in-flight seek.
        const t = pendingSeekRef.current ?? (video.currentTime || 0)
        const total = sourceDuration || video.duration || 1
        if (playheadRef.current) {
          playheadRef.current.style.left = `${Math.min(100, (t / total) * 100)}%`
        }
        if (tcRef.current) tcRef.current.textContent = formatTc(t)
        if (!video.paused && outPoint != null && t >= outPoint - 0.001) {
          video.pause()
          video.currentTime = outPoint
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [sourceDuration, outPoint])

  // Backstop for the rAF out-point stop: rAF is throttled to zero when the
  // window is hidden or occluded, but 'timeupdate' keeps firing — without
  // this, backgrounded playback would sail through the Out point. Coarser
  // than rAF (~4Hz), and the seek back to outPoint corrects any overshoot.
  useEffect(() => {
    if (outPoint == null) return undefined
    const video = getPreviewVideo()
    if (!video) return undefined
    const onTimeUpdate = () => {
      if (!video.paused && video.currentTime >= outPoint - 0.001) {
        video.pause()
        video.currentTime = outPoint
      }
    }
    video.addEventListener('timeupdate', onTimeUpdate)
    return () => video.removeEventListener('timeupdate', onTimeUpdate)
  }, [outPoint])

  const requestSeek = useCallback((value) => {
    const video = getPreviewVideo()
    if (!video) return
    const target = clampT(value)
    if (video.seeking) {
      pendingSeekRef.current = target
      return
    }
    issueCoalescedSeek(video, target, pendingSeekRef)
  }, [clampT])

  const togglePlay = useCallback(() => {
    const video = getPreviewVideo()
    if (!video) return
    if (video.paused) {
      pendingSeekRef.current = null
      if (outPoint != null && video.currentTime >= outPoint - 0.001) {
        video.currentTime = effIn
      }
      void video.play()
    } else {
      video.pause()
    }
  }, [effIn, outPoint])

  const stepFrame = useCallback((direction) => {
    const video = getPreviewVideo()
    if (!video) return
    video.pause()
    // Frame steps are precise and final — drop any stale scrub target so a
    // late coalesced drain can't stomp the stepped position.
    pendingSeekRef.current = null
    video.currentTime = clampT((video.currentTime || 0) + direction * frameStep)
  }, [clampT, frameStep])

  const markIn = useCallback(() => {
    const t = pendingSeekRef.current ?? getPreviewVideo()?.currentTime ?? 0
    setInPoint(Math.min(t, (outPoint ?? sourceDuration) - frameStep))
  }, [outPoint, sourceDuration, frameStep])

  const markOut = useCallback(() => {
    const t = pendingSeekRef.current ?? getPreviewVideo()?.currentTime ?? 0
    setOutPoint(Math.max(t, (inPoint ?? 0) + frameStep))
  }, [inPoint, frameStep])

  const clearRange = useCallback(() => {
    setInPoint(null)
    setOutPoint(null)
  }, [])

  // Capture-phase listener so I/O/X/Space never fall through to the global
  // shortcuts while the monitor is in asset mode (out there I/O set the
  // timeline range and X is cut-at-playhead). Modified combos pass through —
  // Alt+X still clears the timeline In/Out. Escape hands the monitor back to
  // the timeline; no stopPropagation so an open context menu still closes.
  useEffect(() => {
    const handler = (event) => {
      const tag = String(event.target?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || event.target?.isContentEditable) return
      const key = event.key
      if (key === 'Escape') {
        if (document.fullscreenElement) return
        if ((useTimelineStore.getState().clips || []).length === 0) return
        setPreviewMode('timeline')
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const handled = ['i', 'I', 'o', 'O', 'x', 'X', ' ', 'ArrowLeft', 'ArrowRight'].includes(key)
      if (!handled) return
      event.preventDefault()
      event.stopPropagation()
      if (key === 'i' || key === 'I') markIn()
      else if (key === 'o' || key === 'O') markOut()
      else if (key === 'x' || key === 'X') clearRange()
      else if (key === ' ') togglePlay()
      else if (key === 'ArrowLeft') stepFrame(-1)
      else if (key === 'ArrowRight') stepFrame(1)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [markIn, markOut, clearRange, togglePlay, stepFrame, setPreviewMode])

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
      getPreviewVideo()?.pause?.()
      requestSeek(t)
    }
  }, [positionToTime, inPoint, outPoint, sourceDuration, frameStep, requestSeek])

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

  const handleInsert = useCallback((where) => {
    const state = useTimelineStore.getState()
    const track = resolveTargetTrack(state.tracks, state.activeTrackId, isAudio)
    if (!track) {
      showFooterNote({ tone: 'error', text: `No unlocked ${isAudio ? 'audio' : 'video'} track available — add one first.` })
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
      showFooterNote({ tone: 'error', text: 'Could not add the clip to the timeline.' })
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

    showFooterNote({
      tone: 'success',
      text: hasRange
        ? `Inserted ${formatTc(clip.duration)} (source ${formatTc(effIn)} → ${formatTc(effOut)}) on ${track.name || track.id} at ${formatTc(clip.startTime)}.`
        : `Inserted the full clip on ${track.name || track.id} at ${formatTc(clip.startTime)}.`,
    })
  }, [asset, effIn, effOut, hasRange, isAudio, rangeDuration, showFooterNote])

  // Live, unlike the store snapshot in handleInsert: clicking a track in the
  // timeline re-renders this label immediately, so it doubles as feedback
  // for "which track did I just make active".
  const targetTrack = resolveTargetTrack(timelineTracks, activeTrackId, isAudio)
  const targetTrackLabel = targetTrack ? (targetTrack.name || targetTrack.id) : null

  if (!asset) return null

  const barPct = (value) => `${sourceDuration > 0 ? Math.min(100, (value / sourceDuration) * 100) : 0}%`

  return (
    <div className="bg-sf-dark-900 border-t border-sf-dark-700 flex-shrink-0">
      {/* Source scrub bar — replaces the plain preview scrubber in asset mode */}
      <div className="h-7 flex items-center px-3 gap-2">
        <span ref={tcRef} className="text-[10px] text-sf-text-secondary font-mono w-12 text-right">
          00:00.0
        </span>
        <div
          ref={barRef}
          onPointerDown={onBarPointerDown}
          onPointerMove={onBarPointerMove}
          onPointerUp={onBarPointerUp}
          className="relative flex-1 h-5 cursor-pointer touch-none select-none"
        >
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 bg-sf-dark-700 rounded-full" />
          {hasRange && (
            <>
              <div
                className="absolute top-1/2 -translate-y-1/2 h-2.5 rounded-sm bg-sf-accent/25 border-y border-sf-accent/70"
                style={{ left: barPct(effIn), width: barPct(rangeDuration) }}
              />
              <div
                data-role="in-handle"
                className="absolute inset-y-0 z-[3] w-2 cursor-ew-resize rounded-sm bg-sf-accent"
                style={{ left: `calc(${barPct(effIn)} - 4px)` }}
                title="In point — drag, or press I at the playhead"
              />
              <div
                data-role="out-handle"
                className="absolute inset-y-0 z-[3] w-2 cursor-ew-resize rounded-sm bg-sf-accent"
                style={{ left: `calc(${barPct(effOut)} - 4px)` }}
                title="Out point — drag, or press O at the playhead"
              />
            </>
          )}
          <div ref={playheadRef} className="pointer-events-none absolute inset-y-0 z-[2] w-0.5 bg-white" />
        </div>
        <span className="text-[10px] text-sf-text-muted font-mono w-12">
          {formatTc(sourceDuration)}
        </span>
      </div>

      {/* Transport, marks, and inserts */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
        <button
          type="button"
          onClick={togglePlay}
          title={isPlaying ? 'Pause (Space)' : 'Play the marked range (Space)'}
          className="inline-flex items-center gap-1 rounded-md bg-sf-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-sf-accent/90"
        >
          {isPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={() => stepFrame(-1)} title="Back one frame (←)" className="rounded-md border border-sf-dark-600 bg-sf-dark-800 px-2 py-1 text-xs text-sf-text-primary hover:bg-sf-dark-700">
          <ChevronLeft className="h-3 w-3" />
        </button>
        <button type="button" onClick={() => stepFrame(1)} title="Forward one frame (→)" className="rounded-md border border-sf-dark-600 bg-sf-dark-800 px-2 py-1 text-xs text-sf-text-primary hover:bg-sf-dark-700">
          <ChevronRight className="h-3 w-3" />
        </button>
        <button type="button" onClick={markIn} className="rounded-md border border-sf-dark-600 bg-sf-dark-800 px-2 py-1 text-xs text-sf-text-primary hover:bg-sf-dark-700">
          In <span className="ml-0.5 rounded border border-sf-dark-500 px-1 font-mono text-[10px] text-sf-text-muted">I</span>
        </button>
        <button type="button" onClick={markOut} className="rounded-md border border-sf-dark-600 bg-sf-dark-800 px-2 py-1 text-xs text-sf-text-primary hover:bg-sf-dark-700">
          Out <span className="ml-0.5 rounded border border-sf-dark-500 px-1 font-mono text-[10px] text-sf-text-muted">O</span>
        </button>
        <button type="button" onClick={clearRange} className="rounded-md border border-sf-dark-600 bg-sf-dark-800 px-2 py-1 text-xs text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary">
          Clear <span className="ml-0.5 rounded border border-sf-dark-500 px-1 font-mono text-[10px]">X</span>
        </button>
        <div className="flex gap-3 px-1.5 font-mono text-[10px] text-sf-text-muted">
          <span>In <span className="text-sf-text-primary">{formatTc(inPoint)}</span></span>
          <span>Out <span className="text-sf-text-primary">{formatTc(outPoint)}</span></span>
          <span>Range <span className="text-sf-accent">{hasRange ? formatTc(rangeDuration) : 'full clip'}</span></span>
        </div>
        <span
          className={`min-w-0 flex-1 truncate text-right text-[10px] ${footerNote.tone === 'error' ? 'text-sf-error' : footerNote.tone === 'success' ? 'text-sf-success' : 'text-sf-text-muted'}`}
          title={footerNote.text || undefined}
        >
          {footerNote.text || (targetTrackLabel
            ? `Inserts to ${targetTrackLabel}`
            : 'No compatible track on this timeline yet')}
        </span>
        <button
          type="button"
          onClick={() => handleInsert('end')}
          className="rounded-md border border-sf-dark-600 bg-sf-dark-800 px-2.5 py-1 text-xs text-sf-text-primary hover:bg-sf-dark-700"
        >
          Add to End
        </button>
        <button
          type="button"
          onClick={() => handleInsert('playhead')}
          className="rounded-md bg-sf-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-sf-accent/90"
        >
          Insert at Playhead
        </button>
      </div>
    </div>
  )
}

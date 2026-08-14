import { useEffect, useRef, useMemo } from 'react'
import useTimelineStore from '../stores/timelineStore'
import useAssetsStore from '../stores/assetsStore'
import { getAudioClipFadeGain } from '../utils/audioClipFades'
import { getAudioClipLinearGain } from '../utils/audioClipGain'
import {
  hasAudioSolo,
  isAudioTrackAudible,
  trackPanToStereoPosition,
  trackVolumeToLinearGain,
} from '../utils/audioTrackAudibility'
import { getAudioInsertsSignature } from '../utils/audioInserts'
import { buildInsertChain } from '../services/audioInsertChain'
import {
  registerMixerGraph,
  unregisterMixerGraph,
  setTrackAnalyser,
  removeTrackAnalyser,
  setInsertMeters,
} from '../services/audioMixerGraph'
import {
  AUDIO_PREVIEW_DRIFT_CHECK_INTERVAL_MS,
  AUDIO_PREVIEW_SEEK_TOLERANCE_SECONDS,
  getAudioClipTimeScale,
  getAudioSourceTimeAtTimeline,
  isAudioTimelineDiscontinuity,
  resolveAudioPreviewUrl,
  selectAudioPreviewCandidates,
  shouldAlignAudioBeforeStart,
  shouldCorrectAudioDrift,
} from '../utils/audioPreviewScheduling'

const getNowMs = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
)

function clearAudioEntryListeners(entry) {
  entry?.removeSourceListeners?.()
  if (entry) entry.removeSourceListeners = null
}

function pauseAudioEntry(entry) {
  if (!entry) return
  if (!entry.element.paused) entry.element.pause()
}

function disposeAudioEntry(entry) {
  if (!entry || entry.disposed) return
  entry.disposed = true
  entry.desiredPlaying = false
  entry.generation += 1
  clearAudioEntryListeners(entry)
  pauseAudioEntry(entry)
  entry.element.removeAttribute('src')
  entry.element.load?.()
  try {
    entry.sourceNode?.disconnect()
    entry.gainNode?.disconnect()
  } catch (_) {}
}

function refreshAudioEntrySeekState(entry, nowMs) {
  if (!entry?.seekInFlight) return
  const elapsed = Math.max(0, nowMs - (entry.seekStartedAtMs || 0))
  // Some Chromium/container combinations omit `seeked` for tiny seeks. Do
  // not leave the clip permanently blocked if the element is already stable.
  if ((!entry.element.seeking && elapsed > 100) || elapsed > 1500) {
    entry.seekInFlight = false
    entry.seekTarget = null
  }
}

function requestAudioEntrySeek(entry, targetTime, nowMs = getNowMs()) {
  if (!entry || entry.disposed || !Number.isFinite(targetTime)) return false
  entry.pendingSeekTarget = targetTime
  if (entry.element.readyState < 1) return false
  refreshAudioEntrySeekState(entry, nowMs)
  if (entry.seekInFlight || entry.element.seeking) return false

  if (Math.abs((entry.element.currentTime || 0) - targetTime) <= AUDIO_PREVIEW_SEEK_TOLERANCE_SECONDS) {
    entry.pendingSeekTarget = null
    entry.positionPrepared = true
    return false
  }

  try {
    entry.pendingSeekTarget = null
    entry.seekInFlight = true
    entry.seekTarget = targetTime
    entry.seekStartedAtMs = nowMs
    entry.lastSeekAtMs = nowMs
    entry.positionPrepared = false
    entry.element.currentTime = targetTime
    return true
  } catch (err) {
    entry.seekInFlight = false
    entry.seekTarget = null
    console.warn('Failed to seek preview audio clip:', err)
    return false
  }
}

function requestAudioEntryPlay(entry) {
  if (
    !entry
    || entry.disposed
    || !entry.desiredPlaying
    || entry.seekInFlight
    || entry.element.seeking
    || entry.element.readyState < 2
    || !entry.element.paused
    || entry.playPromise
  ) return

  const generation = entry.generation
  const playPromise = entry.element.play()
  if (!playPromise || typeof playPromise.then !== 'function') return

  entry.playPromise = playPromise
  playPromise.then(() => {
    if (entry.generation !== generation) return
    if (entry.disposed || !entry.desiredPlaying) {
      pauseAudioEntry(entry)
    }
  }).catch((err) => {
    if (
      entry.disposed
      || entry.generation !== generation
      || err?.name === 'AbortError'
    ) return
    console.warn('Failed to play audio clip:', err)
  }).finally(() => {
    if (entry.generation === generation && entry.playPromise === playPromise) {
      entry.playPromise = null
    }
  })
}

/**
 * AudioLayerRenderer - Manages audio playback for audio clips on the timeline
 *
 * This component handles:
 * - Playing audio clips that are active at the current playhead position
 * - Syncing audio playback with timeline position
 * - Respecting track muting, solo, and visibility
 * - Handling multiple overlapping audio clips
 *
 * Graph topology (desk order — inserts BEFORE the fader; the mixer reads its
 * meters from this graph via audioMixerGraph; audioInsertChain.js is the
 * shared DSP that export mixdowns run too):
 *
 *   clip source → clip gain (clip gain × fades)
 *     → track bus input → track inserts → track fader → track pan → track analyser
 *       → master bus input → master inserts
 *         → program gain (master fader, part of the program: export applies it too)
 *           → master analyser → monitor gain (app volume knob, preview-only)
 *             → destination
 *
 * The fader is forced to explicit stereo so the panner always sees stereo
 * input — one pan law everywhere, and center stays an exact passthrough
 * (mono sources would otherwise drop 3 dB at center under the mono law).
 */
function AudioLayerRenderer() {
  const audioElementsRef = useRef(new Map()) // clipId -> { element, currentSrc, sourceNode, gainNode, trackId }
  const trackBusesRef = useRef(new Map()) // trackId -> { input, chain, chainSignature, fader, analyser }
  const latestPlaybackRef = useRef(null)
  const previousTimelineSampleRef = useRef(null)
  const entryEventHandlerRef = useRef(null)
  const audioContextRef = useRef(null)
  const masterBusInputRef = useRef(null)
  const masterChainRef = useRef(null)
  const masterChainSignatureRef = useRef(null)
  const programGainRef = useRef(null)
  const monitorGainRef = useRef(null)

  const {
    clips,
    tracks,
    isPlaying,
    playheadPosition,
    playbackRate,
    masterAudioVolume,
    masterAudioInserts,
  } = useTimelineStore()

  const assets = useAssetsStore(state => state.assets)
  const getAssetUrl = useAssetsStore(state => state.getAssetUrl)
  const volume = useAssetsStore(state => state.volume) // Monitor volume from assets store

  useEffect(() => {
    let audioContext = null
    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext
      if (!AudioContextCtor) return undefined

      audioContext = new AudioContextCtor()
      const masterBusInput = audioContext.createGain()
      const programGain = audioContext.createGain()
      const masterAnalyser = audioContext.createAnalyser()
      masterAnalyser.fftSize = 2048
      masterAnalyser.smoothingTimeConstant = 0.2
      const monitorGain = audioContext.createGain()

      // Master insert chain is wired between masterBusInput and programGain
      // by syncMasterChain() in the main effect below.
      programGain.connect(masterAnalyser)
      masterAnalyser.connect(monitorGain)
      monitorGain.connect(audioContext.destination)

      audioContextRef.current = audioContext
      masterBusInputRef.current = masterBusInput
      programGainRef.current = programGain
      monitorGainRef.current = monitorGain
      masterChainRef.current = null
      masterChainSignatureRef.current = null
      registerMixerGraph({ context: audioContext, masterAnalyser })
    } catch (err) {
      console.warn('Failed to initialize preview audio context:', err)
    }

    return () => {
      unregisterMixerGraph(audioContext)
      masterChainRef.current?.dispose?.()
      masterChainRef.current = null
      masterChainSignatureRef.current = null
      trackBusesRef.current.forEach((bus) => bus.chain?.dispose?.())
      trackBusesRef.current.clear()
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {})
      }
      audioContextRef.current = null
      masterBusInputRef.current = null
      programGainRef.current = null
      monitorGainRef.current = null
    }
  }, [])

  // Media readiness events must consult the latest timeline/entry state. A
  // single ref-backed handler prevents old loaded/seeked callbacks from
  // reviving an evicted clip or playing it after the playhead moved away.
  useEffect(() => {
    entryEventHandlerRef.current = (entry, eventType = '') => {
      if (!entry || entry.disposed || audioElementsRef.current.get(entry.clipId) !== entry) return

      const nowMs = getNowMs()
      const latest = latestPlaybackRef.current
      const clip = entry.clip
      if (!latest || !clip) return
      const clipStart = Number(clip.startTime) || 0
      const clipEnd = clipStart + Math.max(0, Number(clip.duration) || 0)
      const active = latest.playheadPosition >= clipStart && latest.playheadPosition < clipEnd
      entry.active = active
      entry.desiredPlaying = Boolean(latest.isPlaying && active && !clip.reverse)

      if (eventType === 'error') {
        const failedUrl = entry.currentSrc
        entry.failedUrl = failedUrl
        entry.failedUrls.add(failedUrl)
        if (failedUrl && failedUrl === entry.cacheUrl) {
          useAssetsStore.getState().markPlaybackCacheBroken?.(clip.assetId, 'audio-preview-error')
        }
        const fallbackUrl = [entry.preferredUrl, entry.sourceUrl]
          .find((url) => url && !entry.failedUrls.has(url)) || null
        if (fallbackUrl) {
          pauseAudioEntry(entry)
          entry.seekInFlight = false
          entry.seekTarget = null
          entry.pendingSeekTarget = null
          entry.positionPrepared = false
          entry.startAlignmentAttempts = 0
          entry.currentSrc = fallbackUrl
          entry.element.src = fallbackUrl
          entry.element.load?.()
        } else if (!entry.errorReported) {
          entry.errorReported = true
          console.warn('Failed to load preview audio clip:', clip?.name || clip?.id || entry.clipId)
        }
        return
      }

      if (entry.element.seeking) return
      if (entry.seekInFlight) {
        entry.seekInFlight = false
        entry.seekTarget = null
      }
      if (eventType === 'seeked') entry.positionPrepared = true

      const latestTarget = active
        ? getAudioSourceTimeAtTimeline(clip, latest.playheadPosition)
        : null
      if (shouldAlignAudioBeforeStart({
        active,
        isPlaying: entry.desiredPlaying,
        positionPrepared: entry.positionPrepared,
        attempts: entry.startAlignmentAttempts,
        currentTime: entry.element.currentTime,
        expectedTime: latestTarget,
      })) {
        entry.startAlignmentAttempts += 1
        entry.positionPrepared = false
        entry.pendingSeekTarget = latestTarget
      }

      // A cold load may finish hundreds of milliseconds after playback began.
      // Replace its original target with the current playhead so it never
      // starts behind and enters the audible catch-up/drift-correction cycle.
      // Once a seek completes, start from that prepared position instead of
      // chasing the moving playhead with a second in-flight seek.
      if (active && !entry.positionPrepared) {
        entry.pendingSeekTarget = Number.isFinite(entry.pendingSeekTarget)
          ? entry.pendingSeekTarget
          : latestTarget
      }
      const pendingTarget = entry.pendingSeekTarget
      if (Number.isFinite(pendingTarget)) {
        requestAudioEntrySeek(entry, pendingTarget, nowMs)
        if (entry.seekInFlight) return
      }

      if (entry.desiredPlaying) requestAudioEntryPlay(entry)
      else pauseAudioEntry(entry)
    }

    return () => {
      entryEventHandlerRef.current = null
    }
  }, [])

  useEffect(() => {
    const audioContext = audioContextRef.current
    if (audioContext && audioContext.state === 'suspended' && isPlaying) {
      audioContext.resume().catch(() => {})
    }
  }, [isPlaying])

  // (Re)build the master insert chain when masterAudioInserts change
  const syncMasterChain = () => {
    const audioContext = audioContextRef.current
    const masterBusInput = masterBusInputRef.current
    const programGain = programGainRef.current
    if (!audioContext || !masterBusInput || !programGain) return

    const signature = getAudioInsertsSignature(masterAudioInserts)
    if (signature === masterChainSignatureRef.current) return

    try {
      masterBusInput.disconnect()
    } catch (_) {}
    masterChainRef.current?.dispose?.()

    try {
      const chain = buildInsertChain(audioContext, masterAudioInserts)
      masterBusInput.connect(chain.input)
      chain.output.connect(programGain)
      masterChainRef.current = chain
      masterChainSignatureRef.current = signature
      setInsertMeters('master', chain.meters)
    } catch (err) {
      console.warn('Failed to build master insert chain, bypassing:', err)
      masterBusInput.connect(programGain)
      masterChainRef.current = null
      masterChainSignatureRef.current = signature
      setInsertMeters('master', [])
    }
  }

  // Lazily create the per-track bus (insert chain + fader gain + meter analyser)
  const ensureTrackBus = (trackId) => {
    const audioContext = audioContextRef.current
    const masterBusInput = masterBusInputRef.current
    if (!audioContext || !masterBusInput || !trackId) return null

    let bus = trackBusesRef.current.get(trackId)
    if (bus) return bus

    try {
      const input = audioContext.createGain()
      const fader = audioContext.createGain()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.2

      let panner = null
      if (typeof audioContext.createStereoPanner === 'function') {
        // Force stereo into the panner so the stereo pan law applies to mono
        // sources too (center = passthrough; see topology comment above)
        fader.channelCount = 2
        fader.channelCountMode = 'explicit'
        panner = audioContext.createStereoPanner()
      }

      // Insert chain wired between input and fader by syncTrackChain
      if (panner) {
        fader.connect(panner)
        panner.connect(analyser)
      } else {
        fader.connect(analyser)
      }
      analyser.connect(masterBusInput)
      bus = { input, chain: null, chainSignature: null, fader, panner, analyser }
      trackBusesRef.current.set(trackId, bus)
      setTrackAnalyser(trackId, analyser)
      return bus
    } catch (err) {
      console.warn('Failed to create track audio bus:', err)
      return null
    }
  }

  // (Re)build a track's insert chain when its inserts change
  const syncTrackChain = (bus, track) => {
    const audioContext = audioContextRef.current
    if (!audioContext || !bus) return

    const signature = getAudioInsertsSignature(track.inserts)
    if (signature === bus.chainSignature) return

    try {
      bus.input.disconnect()
    } catch (_) {}
    bus.chain?.dispose?.()

    try {
      const chain = buildInsertChain(audioContext, track.inserts)
      bus.input.connect(chain.input)
      chain.output.connect(bus.fader)
      bus.chain = chain
      bus.chainSignature = signature
      setInsertMeters(track.id, chain.meters)
    } catch (err) {
      console.warn('Failed to build track insert chain, bypassing:', err)
      bus.input.connect(bus.fader)
      bus.chain = null
      bus.chainSignature = signature
      setInsertMeters(track.id, [])
    }
  }

  // Drop buses for tracks that no longer exist
  useEffect(() => {
    const liveTrackIds = new Set((tracks || []).filter(t => t.type === 'audio').map(t => t.id))
    for (const [trackId, bus] of trackBusesRef.current.entries()) {
      if (!liveTrackIds.has(trackId)) {
        bus.chain?.dispose?.()
        try {
          bus.input.disconnect()
          bus.fader.disconnect()
          bus.panner?.disconnect()
          bus.analyser.disconnect()
        } catch (_) {}
        trackBusesRef.current.delete(trackId)
        removeTrackAnalyser(trackId)
        setInsertMeters(trackId, [])
      }
    }
  }, [tracks])

  // Keep active clips plus a bounded forward/backward warm window. Upcoming
  // short clips get a loaded, pre-seeked element before their first sample;
  // recently-ended entries survive briefly so ordinary cut crossings do not
  // churn decoder instances.
  const audioPreviewCandidates = useMemo(() => {
    const anySolo = hasAudioSolo(tracks)
    return selectAudioPreviewCandidates({
      clips,
      tracks,
      playheadPosition,
      playbackRate,
      isTrackAudible: (track) => isAudioTrackAudible(track, anySolo),
    })
  }, [clips, tracks, playheadPosition, playbackRate])

  // Create/update audio elements for active and soon-to-be-active clips.
  useEffect(() => {
    const audioEntries = audioElementsRef.current
    const nowMs = getNowMs()
    const nextTimelineSample = {
      playheadPosition,
      playbackRate,
      isPlaying,
      sampledAtMs: nowMs,
    }
    const timelineDiscontinuity = isAudioTimelineDiscontinuity(
      previousTimelineSampleRef.current,
      nextTimelineSample,
      nowMs
    )
    previousTimelineSampleRef.current = nextTimelineSample
    latestPlaybackRef.current = nextTimelineSample

    // Evict only clips outside the warm/retention window. This set is stable
    // during ordinary playback and avoids cold-starting a decoder at each cut.
    const retainedClipIds = new Set(audioPreviewCandidates.map(({ clip }) => clip.id))
    for (const [clipId, entry] of audioEntries.entries()) {
      if (!retainedClipIds.has(clipId)) {
        disposeAudioEntry(entry)
        audioEntries.delete(clipId)
      }
    }

    syncMasterChain()

    // Keep bus chains + faders in sync with track state (also covers fader
    // moves and insert edits while nothing on the track is playing).
    for (const track of tracks || []) {
      if (track.type !== 'audio') continue
      const bus = trackBusesRef.current.get(track.id)
      if (bus) {
        syncTrackChain(bus, track)
        bus.fader.gain.value = trackVolumeToLinearGain(track.volume ?? 100)
        if (bus.panner) {
          bus.panner.pan.value = trackPanToStereoPosition(track.pan)
        }
      }
    }

    if (programGainRef.current) {
      programGainRef.current.gain.value = trackVolumeToLinearGain(masterAudioVolume ?? 100)
    }
    if (monitorGainRef.current && Number.isFinite(volume)) {
      monitorGainRef.current.gain.value = Math.max(0, volume)
    }

    audioPreviewCandidates.forEach(({ clip, track, active, upcoming, prepareTimelineTime }) => {
      const asset = assets.find(item => item.id === clip.assetId)
      let entry = audioEntries.get(clip.id)
      const sourceUrl = asset?.url || clip.url || null
      const preferredUrl = getAssetUrl(clip.assetId) || sourceUrl
      const resolvedUrl = resolveAudioPreviewUrl({
        preferredUrl,
        sourceUrl,
        currentUrl: entry?.currentSrc,
        playing: Boolean(isPlaying && active && !clip.reverse),
        failedUrl: entry?.failedUrl,
        failedUrls: entry?.failedUrls,
      })
      if (!resolvedUrl) return

      if (!entry) {
        const audioEl = new Audio()
        audioEl.preload = 'auto'
        audioEl.crossOrigin = 'anonymous'
        entry = {
          element: audioEl,
          currentSrc: null,
          sourceUrl: null,
          preferredUrl: null,
          cacheUrl: null,
          failedUrl: null,
          failedUrls: new Set(),
          errorReported: false,
          sourceNode: null,
          gainNode: null,
          trackId: null,
          clipId: clip.id,
          clip: null,
          track: null,
          active: false,
          desiredPlaying: false,
          disposed: false,
          generation: 0,
          seekInFlight: false,
          seekTarget: null,
          pendingSeekTarget: null,
          seekStartedAtMs: 0,
          lastSeekAtMs: 0,
          lastDriftCheckAtMs: 0,
          startAlignmentAttempts: 0,
          positionPrepared: false,
          playPromise: null,
          removeSourceListeners: null,
        }

        const audioContext = audioContextRef.current
        const bus = ensureTrackBus(track.id)
        if (audioContext && bus) {
          try {
            syncTrackChain(bus, track)
            const sourceNode = audioContext.createMediaElementSource(audioEl)
            const gainNode = audioContext.createGain()
            sourceNode.connect(gainNode)
            gainNode.connect(bus.input)
            entry.sourceNode = sourceNode
            entry.gainNode = gainNode
            entry.trackId = track.id
          } catch (err) {
            console.warn('Failed to connect preview audio through Web Audio:', err)
          }
        }

        audioEntries.set(clip.id, entry)
      } else if (entry.gainNode && entry.trackId !== track.id) {
        // Clip moved to a different audio track: reroute through the new bus
        const bus = ensureTrackBus(track.id)
        if (bus) {
          try {
            syncTrackChain(bus, track)
            entry.gainNode.disconnect()
            entry.gainNode.connect(bus.input)
            entry.trackId = track.id
          } catch (err) {
            console.warn('Failed to reroute clip audio to new track bus:', err)
          }
        }
      }

      const audioEl = entry.element
      entry.clip = clip
      entry.track = track
      entry.sourceUrl = sourceUrl
      entry.preferredUrl = preferredUrl
      entry.cacheUrl = asset?.playbackCacheUrl || null
      entry.active = active
      entry.desiredPlaying = Boolean(isPlaying && active && !clip.reverse)
      if (!active) entry.startAlignmentAttempts = 0
      entry.disposed = false

      // Check if src actually changed (compare against our tracked src, not browser-resolved URL)
      const srcChanged = entry.currentSrc !== resolvedUrl
      if (srcChanged) {
        clearAudioEntryListeners(entry)
        pauseAudioEntry(entry)
        entry.generation += 1
        entry.playPromise = null
        entry.seekInFlight = false
        entry.seekTarget = null
        entry.pendingSeekTarget = null
        entry.positionPrepared = false
        entry.startAlignmentAttempts = 0
        entry.errorReported = false
        const sourceGeneration = entry.generation
        const handleMediaState = (event) => {
          if (entry.generation !== sourceGeneration) return
          entryEventHandlerRef.current?.(entry, event?.type)
        }
        audioEl.addEventListener('loadedmetadata', handleMediaState)
        audioEl.addEventListener('canplay', handleMediaState)
        audioEl.addEventListener('seeked', handleMediaState)
        audioEl.addEventListener('error', handleMediaState)
        entry.removeSourceListeners = () => {
          audioEl.removeEventListener('loadedmetadata', handleMediaState)
          audioEl.removeEventListener('canplay', handleMediaState)
          audioEl.removeEventListener('seeked', handleMediaState)
          audioEl.removeEventListener('error', handleMediaState)
        }
        audioEl.src = resolvedUrl
        entry.currentSrc = resolvedUrl
        audioEl.load?.()
      }

      const clipTime = playheadPosition - clip.startTime
      const reverse = !!clip.reverse
      const clampedTime = getAudioSourceTimeAtTimeline(clip, playheadPosition)

      const fadeGain = active ? getAudioClipFadeGain(clip, clipTime) : 0
      const clipGain = active ? getAudioClipLinearGain(clip) * fadeGain : 0

      if (entry.gainNode) {
        entry.gainNode.gain.value = Math.max(0, clipGain)
        audioEl.volume = 1
      } else {
        // No Web Audio: approximate the whole chain on the element itself
        // (inserts can't run here — gain staging only)
        const trackGain = trackVolumeToLinearGain(track.volume ?? 100)
        const masterGain = trackVolumeToLinearGain(masterAudioVolume ?? 100)
        const fallbackVolume = Math.max(0, Math.min(1, volume * clipGain * trackGain * masterGain))
        audioEl.volume = fallbackVolume
      }

      // Reverse audio not supported with HTMLAudioElement; keep silent
      if (reverse) {
        pauseAudioEntry(entry)
        return
      }

      const effectiveRate = Math.max(0.01, Math.abs(playbackRate) * getAudioClipTimeScale(clip))
      if (Math.abs(audioEl.playbackRate - effectiveRate) > 0.01) {
        audioEl.playbackRate = effectiveRate
      }

      refreshAudioEntrySeekState(entry, nowMs)

      // Warm upcoming clips at their source in-point. Active clips only seek
      // on initial preparation, explicit timeline jumps, or bounded drift
      // checks — never on every RAF update.
      if (upcoming && Number.isFinite(prepareTimelineTime)) {
        requestAudioEntrySeek(entry, getAudioSourceTimeAtTimeline(clip, prepareTimelineTime), nowMs)
      } else if (active && (srcChanged || timelineDiscontinuity)) {
        entry.startAlignmentAttempts = 0
        requestAudioEntrySeek(entry, clampedTime, nowMs)
      } else if (shouldCorrectAudioDrift({
        active,
        isPlaying,
        isSeeking: entry.seekInFlight || audioEl.seeking,
        currentTime: audioEl.currentTime,
        expectedTime: clampedTime,
        nowMs,
        lastCheckAtMs: entry.lastDriftCheckAtMs,
        lastSeekAtMs: entry.lastSeekAtMs,
      })) {
        entry.lastDriftCheckAtMs = nowMs
        requestAudioEntrySeek(entry, clampedTime, nowMs)
      } else if (
        active
        && isPlaying
        && nowMs - entry.lastDriftCheckAtMs >= AUDIO_PREVIEW_DRIFT_CHECK_INTERVAL_MS
      ) {
        entry.lastDriftCheckAtMs = nowMs
      }

      if (entry.desiredPlaying) {
        requestAudioEntryPlay(entry)
      } else {
        pauseAudioEntry(entry)
      }
    })
  }, [audioPreviewCandidates, playheadPosition, isPlaying, playbackRate, getAssetUrl, assets, tracks, volume, masterAudioVolume, masterAudioInserts])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const audioEntries = audioElementsRef.current
      for (const entry of audioEntries.values()) {
        disposeAudioEntry(entry)
      }
      audioEntries.clear()
    }
  }, [])

  // This component doesn't render anything visible
  return null
}

export default AudioLayerRenderer

import { useEffect, useRef, useCallback } from 'react'
import useTimelineStore from '../stores/timelineStore'

const getSelectedLoopRange = (clips, selectedClipIds) => {
  if (!Array.isArray(clips) || clips.length === 0) return null
  if (!Array.isArray(selectedClipIds) || selectedClipIds.length === 0) return null

  const selectedSet = new Set(selectedClipIds)
  const selectedClips = clips.filter((clip) => selectedSet.has(clip.id))
  if (selectedClips.length === 0) return null

  let start = Infinity
  let end = -Infinity
  for (const clip of selectedClips) {
    const clipStart = Number(clip.startTime)
    const clipDuration = Math.max(0, Number(clip.duration) || 0)
    if (!Number.isFinite(clipStart)) continue
    const clipEnd = clipStart + clipDuration
    start = Math.min(start, clipStart)
    end = Math.max(end, clipEnd)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return { start: Math.max(0, start), end: Math.max(0, end) }
}

/**
 * Hook to manage timeline playback
 * Advances the playhead and provides playback state
 */
export function useTimelinePlayback() {
  const animationFrameRef = useRef(null)
  const lastTimeRef = useRef(performance.now())
  const activeClipRef = useRef(null)
  
  const {
    isPlaying,
    playheadPosition,
    playbackRate,
    setPlayheadPosition,
    togglePlay,
    shuttlePause,
    getActiveClipAtTime,
    getTransitionAtTime,
    getTimelineEndTime,
    clips,
    transitions,
  } = useTimelineStore()

  // Get active clip info at current position
  const getPlaybackState = useCallback((time) => {
    const activeClip = getActiveClipAtTime(time)
    const transitionInfo = getTransitionAtTime(time)
    const endTime = getTimelineEndTime()
    const baseScale = activeClip?.sourceTimeScale || (activeClip?.timelineFps && activeClip?.sourceFps
      ? activeClip.timelineFps / activeClip.sourceFps
      : 1)
    const speed = Number(activeClip?.speed)
    const speedScale = Number.isFinite(speed) && speed > 0 ? speed : 1
    const timeScale = baseScale * speedScale
    const reverse = !!activeClip?.reverse
    const trimStart = activeClip?.trimStart || 0
    const rawTrimEnd = activeClip?.trimEnd ?? activeClip?.sourceDuration ?? trimStart
    const trimEnd = Number.isFinite(rawTrimEnd) ? rawTrimEnd : trimStart
    
    return {
      activeClip,
      transitionInfo,
      endTime,
      // Calculate the time within the source video
      sourceTime: activeClip 
        ? (reverse
          ? trimEnd - (time - activeClip.startTime) * timeScale
          : trimStart + (time - activeClip.startTime) * timeScale)
        : 0
    }
  }, [getActiveClipAtTime, getTransitionAtTime, getTimelineEndTime])

  // Track ping-pong direction (1 = forward, -1 = reverse)
  const pingPongDirectionRef = useRef(1)

  // Main playback loop with JKL shuttle support and loop modes
  const tick = useCallback(() => {
    const now = performance.now()
    const deltaMs = now - lastTimeRef.current
    lastTimeRef.current = now
    
    // Convert to seconds and apply playback rate (supports reverse with negative rate)
    const state = useTimelineStore.getState()
    const { loopMode, inPoint, outPoint } = state
    const selectionLoopRange = getSelectedLoopRange(state.clips, state.selectedClipIds)
    const effectiveLoopMode = loopMode === 'loop-selection' && !selectionLoopRange
      ? 'normal'
      : loopMode
    
    // For ping-pong mode, apply direction
    let effectiveRate = state.playbackRate
    if (effectiveLoopMode === 'ping-pong') {
      effectiveRate = Math.abs(state.playbackRate) * pingPongDirectionRef.current
    }
    
    const deltaSeconds = (deltaMs / 1000) * effectiveRate
    let newPosition = state.playheadPosition + deltaSeconds
    const endTime = state.getTimelineEndTime()
    
    // Determine loop boundaries
    const loopStart = effectiveLoopMode === 'loop-selection'
      ? selectionLoopRange.start
      : ((effectiveLoopMode === 'loop-in-out' && inPoint !== null) ? inPoint : 0)
    const loopEnd = effectiveLoopMode === 'loop-selection'
      ? selectionLoopRange.end
      : ((effectiveLoopMode === 'loop-in-out' && outPoint !== null) ? outPoint : endTime)
    
    // Handle end of timeline (forward playback)
    if (newPosition >= loopEnd && loopEnd > 0 && effectiveRate > 0) {
      switch (effectiveLoopMode) {
        case 'loop':
        case 'loop-in-out':
        case 'loop-selection':
          // Loop back to start
          newPosition = loopStart
          break
        case 'ping-pong':
          // Reverse direction
          pingPongDirectionRef.current = -1
          newPosition = loopEnd - (newPosition - loopEnd)
          break
        default:
          // Normal mode - stop at end
          setPlayheadPosition(loopEnd)
          if (state.isPlaying) {
            shuttlePause()
          }
          return
      }
    }
    
    // Handle start of timeline (reverse playback)
    if (newPosition <= loopStart && effectiveRate < 0) {
      switch (effectiveLoopMode) {
        case 'loop':
        case 'loop-in-out':
        case 'loop-selection':
          // Loop to end
          newPosition = loopEnd
          break
        case 'ping-pong':
          // Reverse direction
          pingPongDirectionRef.current = 1
          newPosition = loopStart + (loopStart - newPosition)
          break
        default:
          // Normal mode - stop at start
          setPlayheadPosition(loopStart)
          if (state.isPlaying) {
            shuttlePause()
          }
          return
      }
    }
    
    setPlayheadPosition(Math.max(loopStart, Math.min(loopEnd, newPosition)))
    
    // Continue loop if still playing
    if (state.isPlaying) {
      animationFrameRef.current = requestAnimationFrame(tick)
    }
  }, [setPlayheadPosition, shuttlePause])

  // Start/stop playback loop based on isPlaying
  useEffect(() => {
    if (isPlaying) {
      lastTimeRef.current = performance.now()
      animationFrameRef.current = requestAnimationFrame(tick)
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [isPlaying, tick])

  // Sync video element with timeline position
  const syncVideoToTimeline = useCallback((videoRef, clip, currentTime) => {
    if (!videoRef || !clip) return
    
    const baseScale = clip.sourceTimeScale || (clip.timelineFps && clip.sourceFps
      ? clip.timelineFps / clip.sourceFps
      : 1)
    const speed = Number(clip.speed)
    const speedScale = Number.isFinite(speed) && speed > 0 ? speed : 1
    const timeScale = baseScale * speedScale
    const reverse = !!clip.reverse
    const trimStart = clip.trimStart || 0
    const rawTrimEnd = clip.trimEnd ?? clip.sourceDuration ?? trimStart
    const trimEnd = Number.isFinite(rawTrimEnd) ? rawTrimEnd : trimStart
    const sourceTime = reverse
      ? trimEnd - (currentTime - clip.startTime) * timeScale
      : trimStart + (currentTime - clip.startTime) * timeScale
    
    // Only seek if difference is significant (> 0.1s) to avoid constant seeking
    if (Math.abs(videoRef.currentTime - sourceTime) > 0.1) {
      videoRef.currentTime = sourceTime
    }
  }, [])

  // Get current playback info
  const playbackInfo = getPlaybackState(playheadPosition)

  return {
    isPlaying,
    playheadPosition,
    activeClip: playbackInfo.activeClip,
    transitionInfo: playbackInfo.transitionInfo,
    sourceTime: playbackInfo.sourceTime,
    endTime: playbackInfo.endTime,
    syncVideoToTimeline,
    togglePlay,
  }
}

export default useTimelinePlayback




import { useEffect, useRef, useMemo } from 'react'
import useTimelineStore from '../stores/timelineStore'
import useAssetsStore from '../stores/assetsStore'

/**
 * AudioLayerRenderer - Manages audio playback for audio clips on the timeline
 * 
 * This component handles:
 * - Playing audio clips that are active at the current playhead position
 * - Syncing audio playback with timeline position
 * - Respecting track muting and visibility
 * - Handling multiple overlapping audio clips
 */
function AudioLayerRenderer() {
  const audioElementsRef = useRef(new Map()) // clipId -> { element, currentSrc }
  const isPlayingRef = useRef(false)
  
  const {
    clips,
    tracks,
    isPlaying,
    playheadPosition,
    playbackRate,
    getActiveClipsAtTime,
  } = useTimelineStore()
  
  const getAssetById = useAssetsStore(state => state.getAssetById)
  const volume = useAssetsStore(state => state.volume) // Get volume from assets store

  // Keep isPlayingRef in sync so event handlers always have current value
  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])
  
  // Get active audio clips at current playhead position
  const activeAudioClips = useMemo(() => {
    const allActive = getActiveClipsAtTime(playheadPosition)
    return allActive
      .filter(({ track }) => track.type === 'audio' && track.visible && !track.muted)
      .map(({ clip, track }) => ({ clip, track }))
  }, [playheadPosition, getActiveClipsAtTime, tracks])
  
  // Create/update audio elements for active clips
  useEffect(() => {
    const audioEntries = audioElementsRef.current
    
    // Remove audio elements for clips that are no longer active
    const activeClipIds = new Set(activeAudioClips.map(({ clip }) => clip.id))
    for (const [clipId, entry] of audioEntries.entries()) {
      if (!activeClipIds.has(clipId)) {
        entry.element.pause()
        entry.element.src = ''
        audioEntries.delete(clipId)
      }
    }
    
    // Create/update audio elements for active clips
    activeAudioClips.forEach(({ clip, track }) => {
      const asset = getAssetById(clip.assetId)
      if (!asset?.url) return
      
      let entry = audioEntries.get(clip.id)
      
      if (!entry) {
        // Create new audio element
        const audioEl = new Audio()
        audioEl.preload = 'auto'
        audioEl.crossOrigin = 'anonymous'
        entry = { element: audioEl, currentSrc: null }
        audioEntries.set(clip.id, entry)
      }

      const audioEl = entry.element
      
      // Check if src actually changed (compare against our tracked src, not browser-resolved URL)
      const srcChanged = entry.currentSrc !== asset.url
      if (srcChanged) {
        audioEl.src = asset.url
        entry.currentSrc = asset.url
      }
      
      // Calculate source time within the audio file (with speed/reverse)
      const clipTime = playheadPosition - clip.startTime
      const speed = Number(clip.speed)
      const speedScale = Number.isFinite(speed) && speed > 0 ? speed : 1
      const reverse = !!clip.reverse
      const trimStart = clip.trimStart || 0
      const rawTrimEnd = clip.trimEnd ?? clip.sourceDuration ?? trimStart
      const trimEnd = Number.isFinite(rawTrimEnd) ? rawTrimEnd : trimStart
      const minTime = Math.min(trimStart, trimEnd)
      const maxTime = Math.max(trimStart, trimEnd)
      const sourceTime = reverse
        ? trimEnd - clipTime * speedScale
        : trimStart + clipTime * speedScale
      const clampedTime = Math.max(minTime, Math.min(sourceTime, maxTime - 0.01))
      
      // Check if we're within the clip's active range
      const clipEnd = clip.startTime + clip.duration
      const isWithinClip = playheadPosition >= clip.startTime && playheadPosition < clipEnd
      
      // Reverse audio not supported with HTMLAudioElement; keep silent
      if (reverse) {
        audioEl.pause()
        return
      }

      const effectiveRate = Math.abs(playbackRate) * speedScale

      if (srcChanged) {
        // Remove any prior loadeddata handlers to avoid stale closures
        const onLoadedData = () => {
          // Read from ref to get current isPlaying state (not stale closure)
          const currentlyPlaying = isPlayingRef.current
          if (isWithinClip && currentlyPlaying) {
            audioEl.currentTime = clampedTime
            audioEl.playbackRate = effectiveRate
            audioEl.play().catch(err => {
              console.warn('Failed to play audio clip:', err)
            })
          }
        }
        // Use { once: true } to auto-remove the listener
        audioEl.addEventListener('loadeddata', onLoadedData, { once: true })
      } else if (audioEl.readyState >= 2) {
        // Audio is loaded - sync position
        const timeDiff = Math.abs(audioEl.currentTime - clampedTime)
        if (timeDiff > 0.1) {
          audioEl.currentTime = clampedTime
        }
        
        // Set playback rate
        if (Math.abs(audioEl.playbackRate - effectiveRate) > 0.01) {
          audioEl.playbackRate = effectiveRate
        }
        
        // Play/pause based on timeline state and clip boundaries
        if (isPlaying && isWithinClip) {
          if (audioEl.paused) {
            audioEl.play().catch(err => {
              console.warn('Failed to play audio clip:', err)
            })
          }
        } else {
          if (!audioEl.paused) {
            audioEl.pause()
          }
        }
      }
      
      // Set volume - use master volume from assets store, multiplied by track volume if available
      let finalVolume = volume
      if (track.volume !== undefined) {
        // Track volume is typically 0-100, convert to 0-1 and multiply with master volume
        finalVolume = volume * (track.volume / 100)
      }
      audioEl.volume = Math.max(0, Math.min(1, finalVolume))
    })
  }, [activeAudioClips, playheadPosition, isPlaying, playbackRate, getAssetById, clips, tracks, volume])
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const audioEntries = audioElementsRef.current
      for (const entry of audioEntries.values()) {
        entry.element.pause()
        entry.element.src = ''
      }
      audioEntries.clear()
    }
  }, [])
  
  // This component doesn't render anything visible
  return null
}

export default AudioLayerRenderer

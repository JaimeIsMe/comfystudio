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
  const audioElementsRef = useRef(new Map()) // clipId -> HTMLAudioElement
  const lastPositionRef = useRef(0)
  
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
  
  // Get active audio clips at current playhead position
  const activeAudioClips = useMemo(() => {
    const allActive = getActiveClipsAtTime(playheadPosition)
    return allActive
      .filter(({ track }) => track.type === 'audio' && track.visible && !track.muted)
      .map(({ clip, track }) => ({ clip, track }))
  }, [playheadPosition, getActiveClipsAtTime, tracks])
  
  // Create/update audio elements for active clips
  useEffect(() => {
    const audioElements = audioElementsRef.current
    
    // Remove audio elements for clips that are no longer active
    const activeClipIds = new Set(activeAudioClips.map(({ clip }) => clip.id))
    for (const [clipId, audioEl] of audioElements.entries()) {
      if (!activeClipIds.has(clipId)) {
        audioEl.pause()
        audioEl.src = ''
        audioElements.delete(clipId)
      }
    }
    
    // Create/update audio elements for active clips
    activeAudioClips.forEach(({ clip, track }) => {
      const asset = getAssetById(clip.assetId)
      if (!asset?.url) return
      
      let audioEl = audioElements.get(clip.id)
      
      if (!audioEl) {
        // Create new audio element
        audioEl = new Audio()
        audioEl.preload = 'auto'
        audioEl.crossOrigin = 'anonymous'
        audioElements.set(clip.id, audioEl)
      }
      
      // Update src if it changed
      const srcChanged = audioEl.src !== asset.url
      if (srcChanged) {
        audioEl.src = asset.url
      }
      
      // Calculate source time within the audio file
      const clipTime = playheadPosition - clip.startTime
      const sourceTime = (clip.trimStart || 0) + clipTime
      const maxTime = clip.sourceDuration || clip.trimEnd || clip.duration
      const clampedTime = Math.max(0, Math.min(sourceTime, maxTime - 0.01))
      
      // Check if we're within the clip's active range
      const clipEnd = clip.startTime + clip.duration
      const isWithinClip = playheadPosition >= clip.startTime && playheadPosition < clipEnd
      
      // Wait for audio to load before seeking if src changed
      if (srcChanged) {
        const onLoadedData = () => {
          if (isWithinClip && isPlaying) {
            audioEl.currentTime = clampedTime
            audioEl.playbackRate = playbackRate
            audioEl.play().catch(err => {
              console.warn('Failed to play audio clip:', err)
            })
          }
          audioEl.removeEventListener('loadeddata', onLoadedData)
        }
        audioEl.addEventListener('loadeddata', onLoadedData)
      } else if (audioEl.readyState >= 2) {
        // Audio is loaded - sync position
        const timeDiff = Math.abs(audioEl.currentTime - clampedTime)
        if (timeDiff > 0.1) {
          audioEl.currentTime = clampedTime
        }
        
        // Set playback rate
        if (Math.abs(audioEl.playbackRate - playbackRate) > 0.01) {
          audioEl.playbackRate = playbackRate
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
      const audioElements = audioElementsRef.current
      for (const audioEl of audioElements.values()) {
        audioEl.pause()
        audioEl.src = ''
      }
      audioElements.clear()
    }
  }, [])
  
  // This component doesn't render anything visible
  return null
}

export default AudioLayerRenderer

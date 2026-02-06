import { useEffect, useRef, useState, useMemo } from 'react'
import useTimelineStore from '../stores/timelineStore'
import useAssetsStore from '../stores/assetsStore'

/**
 * MasterAudioMeter - Stereo VU meter component for timeline audio
 * Analyzes audio levels from active audio clips
 */
function MasterAudioMeter({ height, className = '' }) {
  const [leftLevel, setLeftLevel] = useState(-40) // dB
  const [leftPeak, setLeftPeak] = useState(-40) // dB
  const [rightLevel, setRightLevel] = useState(-40) // dB
  const [rightPeak, setRightPeak] = useState(-40) // dB
  
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const dataArrayRef = useRef(null)
  const audioElementsRef = useRef(new Map()) // clipId -> { audioEl, source, gainNode }
  const peakHoldRef = useRef({ left: -40, right: -40 })
  const peakHoldTimeoutRef = useRef({ left: null, right: null })
  
  const {
    clips,
    tracks,
    playheadPosition,
    isPlaying,
    getActiveClipsAtTime,
  } = useTimelineStore()
  
  const getAssetById = useAssetsStore(state => state.getAssetById)
  
  // Get active audio clips
  const activeAudioClips = useMemo(() => {
    const allActive = getActiveClipsAtTime(playheadPosition)
    return allActive
      .filter(({ track }) => track.type === 'audio' && track.visible && !track.muted)
      .map(({ clip, track }) => ({ clip, track }))
  }, [playheadPosition, getActiveClipsAtTime, tracks])
  
  // Initialize Web Audio API context and analyzer
  useEffect(() => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.5
      
      // Create a master gain node for mixing all sources
      // Note: We don't connect to destination to avoid double playback
      // AudioLayerRenderer handles actual playback
      const masterGain = audioContext.createGain()
      masterGain.connect(analyser)
      // Don't connect analyser to destination - we only want to analyze, not play
      
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      
      audioContextRef.current = audioContext
      analyserRef.current = analyser
      dataArrayRef.current = dataArray
      masterGainRef.current = masterGain
    } catch (err) {
      console.warn('Failed to initialize audio analyzer:', err)
    }
    
    return () => {
      if (peakHoldTimeoutRef.current.left) {
        clearTimeout(peakHoldTimeoutRef.current.left)
      }
      if (peakHoldTimeoutRef.current.right) {
        clearTimeout(peakHoldTimeoutRef.current.right)
      }
      // Cleanup audio sources
      audioElementsRef.current.forEach(({ source, audioEl }) => {
        try {
          source?.disconnect()
          audioEl.pause()
          audioEl.src = ''
        } catch (e) {}
      })
      audioElementsRef.current.clear()
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {})
      }
    }
  }, [])
  
  const masterGainRef = useRef(null)
  
  // Resume AudioContext on user interaction (required by some browsers)
  useEffect(() => {
    const ctx = audioContextRef.current
    if (ctx && ctx.state === 'suspended' && isPlaying) {
      ctx.resume().catch(() => {})
    }
  }, [isPlaying])
  
  // Connect/disconnect audio sources based on active clips
  useEffect(() => {
    if (!audioContextRef.current || !masterGainRef.current) return
    
    const audioContext = audioContextRef.current
    const masterGain = masterGainRef.current
    const audioElements = audioElementsRef.current
    
    // Remove sources for clips that are no longer active
    const activeClipIds = new Set(activeAudioClips.map(({ clip }) => clip.id))
    for (const [clipId, { source, gainNode, audioEl }] of audioElements.entries()) {
      if (!activeClipIds.has(clipId)) {
        try {
          source?.disconnect()
          gainNode?.disconnect()
          audioEl.pause()
          audioEl.src = ''
          audioElements.delete(clipId)
        } catch (e) {}
      }
    }
    
    // Create/update sources for active clips
    activeAudioClips.forEach(({ clip, track }) => {
      const asset = getAssetById(clip.assetId)
      if (!asset?.url) return
      
      let sourceData = audioElements.get(clip.id)
      
      if (!sourceData) {
        // Create new audio element
        const audioEl = new Audio()
        audioEl.preload = 'auto'
        audioEl.crossOrigin = 'anonymous'
        audioEl.src = asset.url
        
        // Wait for audio to load before creating source
        const onLoadedData = () => {
          try {
            const source = audioContext.createMediaElementSource(audioEl)
            const gainNode = audioContext.createGain()
            source.connect(gainNode)
            gainNode.connect(masterGain)
            
            audioElements.set(clip.id, { source, gainNode, audioEl })
            
            // Sync playback
            const clipTime = playheadPosition - clip.startTime
            const sourceTime = (clip.trimStart || 0) + clipTime
            const maxTime = clip.sourceDuration || clip.trimEnd || clip.duration
            const clampedTime = Math.max(0, Math.min(sourceTime, maxTime - 0.01))
            
            const clipEnd = clip.startTime + clip.duration
            const isWithinClip = playheadPosition >= clip.startTime && playheadPosition < clipEnd
            
            // Play audio for analysis (but it's not connected to speakers)
            // AudioLayerRenderer handles actual playback
            if (isWithinClip && isPlaying) {
              audioEl.currentTime = clampedTime
              audioEl.play().catch(() => {})
            }
            // Keep volume 1 for analysis; we don't connect analyser to destination so no double playback
            audioEl.volume = 1
            
            // Meter shows pre-fader level (raw track level), not affected by master volume knob
            gainNode.gain.value = 1
          } catch (err) {
            console.warn('Failed to create audio source:', err)
          }
          audioEl.removeEventListener('loadeddata', onLoadedData)
        }
        audioEl.addEventListener('loadeddata', onLoadedData)
      } else {
        // Update existing source
        const { gainNode, audioEl } = sourceData
        
        // Sync playback
        const clipTime = playheadPosition - clip.startTime
        const sourceTime = (clip.trimStart || 0) + clipTime
        const maxTime = clip.sourceDuration || clip.trimEnd || clip.duration
        const clampedTime = Math.max(0, Math.min(sourceTime, maxTime - 0.01))
        
        const clipEnd = clip.startTime + clip.duration
        const isWithinClip = playheadPosition >= clip.startTime && playheadPosition < clipEnd
        
        if (audioEl.readyState >= 2) {
          const timeDiff = Math.abs(audioEl.currentTime - clampedTime)
          if (timeDiff > 0.1) {
            audioEl.currentTime = clampedTime
          }
          
          // Sync playback for analysis (muted, AudioLayerRenderer handles actual playback)
          if (isPlaying && isWithinClip) {
            if (audioEl.paused) {
              audioEl.play().catch(() => {})
            }
          } else {
            if (!audioEl.paused) {
              audioEl.pause()
            }
          }
          // Keep volume 1 for analysis (analyser not connected to destination)
          audioEl.volume = 1
        }
        
        // Meter shows pre-fader level (raw track level), not affected by master volume knob
        gainNode.gain.value = 1
      }
    })
  }, [activeAudioClips, playheadPosition, isPlaying, getAssetById])
  
  // Analysis loop: use setInterval so it keeps running (rAF can be throttled when tab inactive or no interaction)
  const METER_UPDATE_MS = 50 // ~20 fps, enough for smooth meter
  useEffect(() => {
    const analyser = analyserRef.current
    if (!analyser) return

    const analyze = () => {
      try {
        const fftSize = analyser.fftSize
        const floatData = new Float32Array(fftSize)
        analyser.getFloatTimeDomainData(floatData)

        let sum = 0
        for (let i = 0; i < floatData.length; i++) {
          sum += floatData[i] * floatData[i]
        }
        const rms = floatData.length > 0 ? Math.sqrt(sum / floatData.length) : 0
        const leftDb = rms > 0.001 ? Math.max(-40, 20 * Math.log10(rms)) : -40
        const rightDb = leftDb

        setLeftLevel(leftDb)
        setRightLevel(rightDb)

        if (leftDb > peakHoldRef.current.left) {
          peakHoldRef.current.left = leftDb
          if (peakHoldTimeoutRef.current.left) clearTimeout(peakHoldTimeoutRef.current.left)
          peakHoldTimeoutRef.current.left = setTimeout(() => {
            peakHoldRef.current.left = -40
            setLeftPeak(-40)
          }, 1000)
          setLeftPeak(leftDb)
        }
        if (rightDb > peakHoldRef.current.right) {
          peakHoldRef.current.right = rightDb
          if (peakHoldTimeoutRef.current.right) clearTimeout(peakHoldTimeoutRef.current.right)
          peakHoldTimeoutRef.current.right = setTimeout(() => {
            peakHoldRef.current.right = -40
            setRightPeak(-40)
          }, 1000)
          setRightPeak(rightDb)
        }
      } catch (_) {}
    }

    analyze()
    const intervalId = setInterval(analyze, METER_UPDATE_MS)

    return () => clearInterval(intervalId)
  }, [])
  
  // Convert dB to percentage position (0 dB at top, -40 dB at bottom)
  const dbToPosition = (db) => {
    // Map -40dB to 100%, 0dB to 0%
    return Math.max(0, Math.min(100, ((db + 40) / 40) * 100))
  }
  
  // Get color for a given dB level
  const getColorForDb = (db) => {
    if (db >= -4) return 'bg-red-500' // Red for peaks (0 to -4 dB)
    if (db >= -12) return 'bg-yellow-500' // Yellow for warning (-4 to -12 dB)
    return 'bg-green-500' // Green for normal (-12 to -40 dB)
  }
  
  const leftPosition = dbToPosition(leftLevel)
  const rightPosition = dbToPosition(rightLevel)
  const leftPeakPosition = dbToPosition(leftPeak)
  const rightPeakPosition = dbToPosition(rightPeak)
  
  // Simplified dB scale: only 0, -10, -20, -30, -40
  const dbLabels = [0, -10, -20, -30, -40]
  
  return (
    <div className={`flex flex-col items-center bg-sf-dark-800 ${className}`} style={{ width: height ? undefined : '100%', height: height ? `${height}px` : '100%', minHeight: 120 }}>
      {/* Layout: left bar | scale (centered) | right bar */}
      <div className="flex-1 flex items-stretch gap-0 min-h-0 w-full max-w-[80px] px-1">
        {/* Left channel */}
        <div className="flex-1 min-w-0 min-h-0 relative bg-black/50 rounded-l-sm overflow-hidden border border-sf-dark-600 border-r-0">
          <div
            className={`absolute bottom-0 left-0 right-0 ${getColorForDb(leftLevel)} transition-all duration-75`}
            style={{ height: `${leftPosition}%` }}
          />
          {leftPeak > -40 && (
            <div
              className="absolute left-0 right-0 bg-red-500"
              style={{ bottom: `${leftPeakPosition}%`, height: '2px' }}
            />
          )}
        </div>
        
        {/* dB scale - centered between the two bars */}
        <div className="flex flex-col justify-between py-0.5 text-[8px] text-sf-text-muted font-mono pointer-events-none shrink-0 w-6 items-center">
          {dbLabels.map(db => (
            <span key={db} className="leading-none">{db}</span>
          ))}
        </div>
        
        {/* Right channel */}
        <div className="flex-1 min-w-0 min-h-0 relative bg-black/50 rounded-r-sm overflow-hidden border border-sf-dark-600 border-l-0">
          <div
            className={`absolute bottom-0 left-0 right-0 ${getColorForDb(rightLevel)} transition-all duration-75`}
            style={{ height: `${rightPosition}%` }}
          />
          {rightPeak > -40 && (
            <div
              className="absolute left-0 right-0 bg-red-500"
              style={{ bottom: `${rightPeakPosition}%`, height: '2px' }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default MasterAudioMeter

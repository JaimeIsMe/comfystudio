import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Sparkles, Video, Image as ImageIcon, Music, RefreshCw, Loader2,
  ChevronLeft, ChevronRight, Play, Pause, Upload, X, Film, Search,
  FolderOpen, Wand2, Volume2, Mic, Clock, Settings
} from 'lucide-react'
import useComfyUI from '../hooks/useComfyUI'
import useAssetsStore from '../stores/assetsStore'
import useProjectStore from '../stores/projectStore'
import { comfyui } from '../services/comfyui'
import { importAsset, isElectron } from '../services/fileSystem'
import { enqueuePlaybackTranscode } from '../services/playbackCache'

// ============================================
// Cinematography Tags (reused from GeneratePanel)
// ============================================
const SHOT_CATEGORIES = {
  'Shot': ['Extreme close-up', 'Close-up', 'Medium close-up', 'Medium shot', 'Medium wide', 'Wide shot', 'Extreme wide', 'Over-the-shoulder', 'POV', 'Two-shot', 'Insert shot'],
  'Movement': ['Static', 'Pan', 'Tilt', 'Dolly in', 'Dolly out', 'Push in', 'Pull out', 'Tracking shot', 'Crane shot', 'Steadicam', 'Handheld', 'Drone', 'Aerial', 'Orbit', 'Whip pan'],
  'Angle': ['Eye level', 'Low angle', 'High angle', "Bird's eye", 'Overhead', "Worm's eye", 'Dutch angle'],
  'Lighting': ['Natural light', 'Golden hour', 'Blue hour', 'High key', 'Low key', 'Dramatic lighting', 'Cinematic lighting', 'Soft lighting', 'Hard lighting', 'Backlit', 'Silhouette', 'Rim lighting', 'Neon', 'Candlelit', 'Moonlit'],
  'Mood': ['Cinematic', 'Dramatic', 'Epic', 'Intimate', 'Mysterious', 'Tense', 'Suspenseful', 'Romantic', 'Melancholic', 'Energetic', 'Serene', 'Ethereal', 'Dark'],
  'Style': ['Film noir', 'Documentary', 'Commercial', 'Music video', 'Blockbuster', 'Indie film', 'Vintage', 'Retro', 'Sci-fi', 'Fantasy', 'Horror', 'Western'],
  'Color': ['Desaturated', 'High contrast', 'Warm tones', 'Cool tones', 'Teal and orange', 'Black and white', 'Vibrant', 'Muted', 'Neon colors'],
  'Speed': ['Slow motion', 'Real-time', 'Fast motion', 'Time-lapse', 'Hyperlapse'],
  'Depth': ['Shallow DOF', 'Bokeh', 'Deep focus', 'Rack focus'],
  'Lens': ['Anamorphic', 'Wide angle', 'Telephoto', 'Fisheye', 'Macro', '35mm film look']
}
const CATEGORY_ORDER = ['Shot', 'Movement', 'Angle', 'Lighting', 'Mood', 'Style', 'Color', 'Speed', 'Depth', 'Lens']

// ============================================
// Workflow Registry
// ============================================
const WORKFLOWS = {
  video: [
    { id: 'ltx2-t2v', label: 'Text to Video (LTX2)', needsImage: false, description: 'Generate video from text prompt' },
    { id: 'ltx2-i2v', label: 'Image to Video (LTX2)', needsImage: true, description: 'Animate an image into video with LTX2' },
    { id: 'wan22-i2v', label: 'Image to Video (WAN 2.2)', needsImage: true, description: 'Animate an image into video' },
  ],
  image: [
    { id: 'multi-angles', label: 'Multiple Angles', needsImage: true, description: 'Generate 8 camera angles from one image' },
    { id: 'image-edit', label: 'Image Edit', needsImage: true, description: 'Edit image with text prompt (inflate, modify, etc.)' },
  ],
  audio: [
    { id: 'music-gen', label: 'Music Generation', needsImage: false, description: 'Generate music from tags and lyrics' },
  ],
}

const CATEGORY_ICONS = { video: Video, image: ImageIcon, audio: Music }

// ============================================
// CinematographyTags Sub-component
// ============================================
function CinematographyTags({ onAddTag, selectedTags, onRemoveTag }) {
  const [activeCategory, setActiveCategory] = useState('Shot')
  const tabsRef = useRef(null)
  const scrollTabs = (dir) => tabsRef.current?.scrollBy({ left: dir * 100, behavior: 'smooth' })

  return (
    <div className="space-y-2">
      <div className="relative flex items-center">
        <button onClick={() => scrollTabs(-1)} className="absolute left-0 z-10 p-0.5 bg-sf-dark-900/90 hover:bg-sf-dark-700 rounded text-sf-text-muted"><ChevronLeft className="w-3 h-3" /></button>
        <div ref={tabsRef} className="flex gap-1 overflow-x-auto mx-5 pb-1" style={{ scrollbarWidth: 'none' }}>
          {CATEGORY_ORDER.map(cat => (
            <button key={cat} onClick={() => setActiveCategory(cat)}
              className={`px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap transition-colors ${activeCategory === cat ? 'bg-sf-accent text-white' : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'}`}
            >{cat}</button>
          ))}
        </div>
        <button onClick={() => scrollTabs(1)} className="absolute right-0 z-10 p-0.5 bg-sf-dark-900/90 hover:bg-sf-dark-700 rounded text-sf-text-muted"><ChevronRight className="w-3 h-3" /></button>
      </div>
      <div className="bg-sf-dark-800/50 rounded-lg p-2">
        <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
          {SHOT_CATEGORIES[activeCategory].map(tag => {
            const sel = selectedTags.includes(tag)
            return (
              <button key={tag} onClick={() => sel ? onRemoveTag(tag) : onAddTag(tag)}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors ${sel ? 'bg-sf-accent text-white' : 'bg-sf-dark-700 hover:bg-sf-dark-600 text-sf-text-secondary'}`}
              >{sel ? '+ ' : ''}{tag}</button>
            )
          })}
        </div>
      </div>
      {selectedTags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {selectedTags.map(tag => (
            <span key={tag} onClick={() => onRemoveTag(tag)} className="px-1.5 py-0.5 bg-sf-accent/20 text-sf-accent rounded text-[9px] cursor-pointer hover:bg-sf-accent/30">{tag} x</span>
          ))}
          <button onClick={() => selectedTags.forEach(onRemoveTag)} className="text-[9px] text-sf-text-muted hover:text-sf-error ml-1">Clear</button>
        </div>
      )}
    </div>
  )
}

// ============================================
// Asset Input Browser (left column)
// ============================================
function AssetInputBrowser({ selectedAsset, onSelectAsset, filterType, frameTime, onFrameTimeChange }) {
  const { assets } = useAssetsStore()
  const [search, setSearch] = useState('')
  const videoRef = useRef(null)
  const canvasRef = useRef(null)

  // Filter assets based on workflow needs
  const filtered = useMemo(() => {
    let list = assets.filter(a => a.type !== 'mask')
    if (filterType === 'image') {
      list = list.filter(a => a.type === 'image' || a.type === 'video')
    } else if (filterType === 'video') {
      list = list.filter(a => a.type === 'video')
    } else if (filterType === 'audio') {
      list = list.filter(a => a.type === 'audio')
    }
    if (search) {
      list = list.filter(a => a.name.toLowerCase().includes(search.toLowerCase()))
    }
    return list
  }, [assets, filterType, search])

  // When video loads, seek to frameTime
  useEffect(() => {
    if (videoRef.current && selectedAsset?.type === 'video') {
      videoRef.current.currentTime = frameTime || 0
    }
  }, [frameTime, selectedAsset])

  const handleVideoSeeked = () => {
    // Draw current frame to canvas for preview
    if (videoRef.current && canvasRef.current) {
      const v = videoRef.current
      const c = canvasRef.current
      c.width = v.videoWidth
      c.height = v.videoHeight
      c.getContext('2d').drawImage(v, 0, 0)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex-shrink-0 p-2 border-b border-sf-dark-700">
        <div className="text-[10px] text-sf-text-muted uppercase tracking-wider mb-2">Input Source</div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-sf-text-muted" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search assets..."
            className="w-full pl-7 pr-2 py-1 bg-sf-dark-800 border border-sf-dark-600 rounded text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent"
          />
        </div>
      </div>

      {/* Selected asset preview + frame grabber */}
      {selectedAsset && (
        <div className="flex-shrink-0 border-b border-sf-dark-700 p-2">
          <div className="text-[10px] text-sf-text-muted mb-1">Selected: <span className="text-sf-text-primary">{selectedAsset.name}</span></div>
          {selectedAsset.type === 'video' && filterType === 'image' ? (
            (() => {
              const durationSec = selectedAsset.duration ?? selectedAsset.settings?.duration ?? 5
              const fps = selectedAsset.fps ?? selectedAsset.settings?.fps ?? 24
              const totalFrames = Math.max(0, Math.floor(durationSec * fps))
              const currentFrame = Math.min(totalFrames, Math.round((frameTime || 0) * fps))
              return (
                <div className="space-y-2">
                  <div className="relative aspect-video bg-sf-dark-800 rounded overflow-hidden">
                    <video
                      ref={videoRef}
                      src={selectedAsset.url}
                      className="w-full h-full object-contain"
                      muted
                      onSeeked={handleVideoSeeked}
                      onLoadedMetadata={() => { if (videoRef.current) videoRef.current.currentTime = frameTime || 0 }}
                    />
                    <canvas ref={canvasRef} className="hidden" />
                    <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/70 rounded text-[9px] text-white">
                      Frame {currentFrame}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-sf-text-muted w-6">0</span>
                    <input
                      type="range" min="0" max={durationSec} step={1 / Math.max(1, fps)}
                      value={frameTime || 0} onChange={e => onFrameTimeChange(parseFloat(e.target.value))}
                      className="flex-1 h-1 accent-sf-accent"
                    />
                    <span className="text-[9px] text-sf-text-muted w-8 text-right">{totalFrames}</span>
                  </div>
                  <div className="text-[9px] text-sf-text-muted">Drag slider to pick a frame from this video</div>
                </div>
              )
            })()
          ) : (
            <div className="aspect-video bg-sf-dark-800 rounded overflow-hidden">
              {selectedAsset.type === 'video' ? (
                <video src={selectedAsset.url} className="w-full h-full object-contain" muted />
              ) : selectedAsset.type === 'image' ? (
                <img src={selectedAsset.url} className="w-full h-full object-contain" alt={selectedAsset.name} />
              ) : (
                <div className="w-full h-full flex items-center justify-center"><Music className="w-8 h-8 text-sf-text-muted" /></div>
              )}
            </div>
          )}
          <button onClick={() => onSelectAsset(null)} className="mt-1 text-[9px] text-sf-text-muted hover:text-sf-error">Clear selection</button>
        </div>
      )}

      {/* Asset grid */}
      <div className="flex-1 overflow-auto p-2">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-sf-text-muted">
            <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-xs">{filterType ? `No ${filterType} assets` : 'No assets'}</p>
            <p className="text-[10px]">Import media in the Assets tab</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {filtered.map(asset => {
              const isSelected = selectedAsset?.id === asset.id
              return (
                <button key={asset.id} onClick={() => onSelectAsset(asset)}
                  className={`bg-sf-dark-800 border rounded overflow-hidden text-left transition-all ${isSelected ? 'border-sf-accent ring-1 ring-sf-accent' : 'border-sf-dark-600 hover:border-sf-dark-500'}`}
                >
                  <div className="aspect-video bg-sf-dark-700 flex items-center justify-center relative overflow-hidden">
                    {asset.type === 'video' && asset.url ? (
                      <video src={asset.url} className="w-full h-full object-cover" muted preload="metadata" />
                    ) : asset.type === 'image' && asset.url ? (
                      <img src={asset.url} className="w-full h-full object-cover" alt="" />
                    ) : (
                      <Music className="w-4 h-4 text-sf-text-muted" />
                    )}
                    <div className={`absolute top-0.5 left-0.5 px-1 py-0.5 rounded text-[7px] text-white ${asset.type === 'video' ? 'bg-blue-600/80' : asset.type === 'image' ? 'bg-green-600/80' : 'bg-purple-600/80'}`}>
                      {asset.type === 'video' ? 'VID' : asset.type === 'image' ? 'IMG' : 'AUD'}
                    </div>
                  </div>
                  <div className="px-1 py-0.5">
                    <p className="text-[9px] text-sf-text-primary truncate">{asset.name}</p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// Helper: Extract frame from video as File
// ============================================
async function extractFrameAsFile(videoUrl, time, filename = 'frame.png') {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'auto'
    video.src = videoUrl

    video.onloadedmetadata = () => {
      video.currentTime = Math.min(time, video.duration - 0.01)
    }

    video.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d').drawImage(video, 0, 0)
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(new File([blob], filename, { type: 'image/png' }))
        } else {
          reject(new Error('Failed to extract frame'))
        }
      }, 'image/png')
    }

    video.onerror = () => reject(new Error('Failed to load video for frame extraction'))
  })
}

// ============================================
// Main GenerateWorkspace Component
// ============================================
function GenerateWorkspace() {
  // Load persisted state from localStorage
  const loadPersistedState = () => {
    try {
      const saved = localStorage.getItem('generate-workspace-state')
      if (saved) {
        return JSON.parse(saved)
      }
    } catch (error) {
      console.error('Failed to load persisted Generate workspace state:', error)
    }
    return null
  }

  const persistedState = loadPersistedState()

  // Category + workflow selection
  const [category, setCategory] = useState(persistedState?.category || 'video')
  const [workflowId, setWorkflowId] = useState(persistedState?.workflowId || 'ltx2-t2v')

  // Input asset (store ID, will resolve to object)
  const [selectedAssetId, setSelectedAssetId] = useState(persistedState?.selectedAssetId || null)
  const [selectedAsset, setSelectedAsset] = useState(null)
  const [frameTime, setFrameTime] = useState(persistedState?.frameTime || 0)

  // Common generation state
  const [prompt, setPrompt] = useState(persistedState?.prompt || '')
  const [negativePrompt, setNegativePrompt] = useState(persistedState?.negativePrompt || 'blurry, low quality, watermark')
  const [seed, setSeed] = useState(persistedState?.seed || Math.floor(Math.random() * 1000000))
  const [selectedTags, setSelectedTags] = useState(persistedState?.selectedTags || [])

  // Video settings
  const [duration, setDuration] = useState(persistedState?.duration || 5)
  const [resolution, setResolution] = useState(persistedState?.resolution || { width: 1280, height: 720 })
  const [fps, setFps] = useState(persistedState?.fps || 24)

  // Image edit settings
  const [editSteps, setEditSteps] = useState(persistedState?.editSteps || 40)
  const [editCfg, setEditCfg] = useState(persistedState?.editCfg || 4)

  // Music settings
  const [musicTags, setMusicTags] = useState(persistedState?.musicTags || '')
  const [lyrics, setLyrics] = useState(persistedState?.lyrics || '')
  const [musicDuration, setMusicDuration] = useState(persistedState?.musicDuration || 30)
  const [bpm, setBpm] = useState(persistedState?.bpm || 120)
  const [keyscale, setKeyscale] = useState(persistedState?.keyscale || 'C major')

  // Generation queue state
  const [generationQueue, setGenerationQueue] = useState([])
  const [activeJobId, setActiveJobId] = useState(null)
  const processingRef = useRef(false)
  const queueRef = useRef([])
  const [formError, setFormError] = useState(null)

  // Hooks
  const { isConnected, wsConnected, queueCount } = useComfyUI()
  const { addAsset, generateName, assets } = useAssetsStore()
  const { currentProjectHandle } = useProjectStore()

  // Restore selected asset from ID when assets are available
  useEffect(() => {
    if (selectedAssetId && assets.length > 0) {
      const asset = assets.find(a => a.id === selectedAssetId)
      if (asset) {
        setSelectedAsset(asset)
      } else {
        // Asset no longer exists, clear selection
        setSelectedAssetId(null)
        setSelectedAsset(null)
      }
    }
  }, [selectedAssetId, assets])

  // Persist state to localStorage whenever it changes
  useEffect(() => {
    try {
      const stateToSave = {
        category,
        workflowId,
        selectedAssetId,
        frameTime,
        prompt,
        negativePrompt,
        seed,
        selectedTags,
        duration,
        resolution,
        fps,
        editSteps,
        editCfg,
        musicTags,
        lyrics,
        musicDuration,
        bpm,
        keyscale,
      }
      localStorage.setItem('generate-workspace-state', JSON.stringify(stateToSave))
    } catch (error) {
      console.error('Failed to save Generate workspace state:', error)
    }
  }, [
    category,
    workflowId,
    selectedAssetId,
    frameTime,
    prompt,
    negativePrompt,
    seed,
    selectedTags,
    duration,
    resolution,
    fps,
    editSteps,
    editCfg,
    musicTags,
    lyrics,
    musicDuration,
    bpm,
    keyscale,
  ])

  // Keep queue ref in sync
  useEffect(() => {
    queueRef.current = generationQueue
  }, [generationQueue])

  // Current workflow info
  const currentWorkflow = useMemo(() => {
    const list = WORKFLOWS[category] || []
    return list.find(w => w.id === workflowId) || list[0]
  }, [category, workflowId])

  // When category changes, pick default workflow
  useEffect(() => {
    const list = WORKFLOWS[category] || []
    if (list.length > 0 && !list.find(w => w.id === workflowId)) {
      setWorkflowId(list[0].id)
    }
  }, [category])

  // Build full prompt with tags
  const fullPrompt = useMemo(() => {
    const tagStr = selectedTags.length > 0 ? selectedTags.join(', ') + '. ' : ''
    return tagStr + prompt
  }, [prompt, selectedTags])

  // Frame count helper
  const getFrameCount = () => Math.round(duration * fps) + 1

  const queuedJobs = useMemo(
    () => generationQueue.filter(j => j.status === 'queued'),
    [generationQueue]
  )
  const activeJobs = useMemo(
    () => generationQueue.filter(j => ['uploading', 'configuring', 'queuing', 'running', 'saving'].includes(j.status)),
    [generationQueue]
  )
  const hasJobs = generationQueue.length > 0
  const queuedCount = queuedJobs.length
  const activeCount = activeJobs.length

  // Calculate aspect ratio mismatch warning
  const aspectRatioWarning = useMemo(() => {
    if (!selectedAsset || !selectedAsset.settings) return null
    
    const inputWidth = selectedAsset.settings.width || selectedAsset.width
    const inputHeight = selectedAsset.settings.height || selectedAsset.height
    
    if (!inputWidth || !inputHeight) return null
    
    const inputAspect = inputWidth / inputHeight
    const outputAspect = resolution.width / resolution.height
    const aspectDiff = Math.abs(inputAspect - outputAspect)
    
    // Warn if aspect ratio differs by more than 5%
    if (aspectDiff > 0.05) {
      const inputLabel = inputAspect > 1 ? 'landscape' : inputAspect < 1 ? 'portrait' : 'square'
      const outputLabel = outputAspect > 1 ? 'landscape' : outputAspect < 1 ? 'portrait' : 'square'
      
      return {
        inputAspect: inputAspect.toFixed(2),
        outputAspect: outputAspect.toFixed(2),
        inputLabel,
        outputLabel,
        inputResolution: `${inputWidth}x${inputHeight}`,
        outputResolution: `${resolution.width}x${resolution.height}`,
      }
    }
    
    return null
  }, [selectedAsset, resolution])

  // ============================================
  // Generation queue + handler
  // ============================================
  const updateJob = useCallback((jobId, updater) => {
    setGenerationQueue(prev => prev.map(job => {
      if (job.id !== jobId) return job
      const updates = typeof updater === 'function' ? updater(job) : updater
      return { ...job, ...updates }
    }))
  }, [])

  const updateJobByPromptId = useCallback((promptId, updater) => {
    if (!promptId) return
    setGenerationQueue(prev => prev.map(job => {
      if (job.promptId !== promptId) return job
      const updates = typeof updater === 'function' ? updater(job) : updater
      return { ...job, ...updates }
    }))
  }, [])

  // Listen for ComfyUI progress events and map to jobs
  useEffect(() => {
    const handleProgress = (data) => {
      if (!data?.promptId) return
      const percent = data.max > 0 ? Math.round((data.value / data.max) * 100) : 0
      updateJobByPromptId(data.promptId, (job) => {
        if (job.status === 'done' || job.status === 'error') return job
        return {
          ...job,
          status: job.status === 'queued' ? 'running' : job.status,
          progress: Math.min(99, Math.max(job.progress || 0, percent))
        }
      })
    }

    const handleExecuting = (data) => {
      if (!data?.promptId) return
      updateJobByPromptId(data.promptId, { node: data.node })
    }

    const handleComplete = (data) => {
      if (!data?.promptId) return
      updateJobByPromptId(data.promptId, (job) => ({
        ...job,
        progress: Math.max(job.progress || 0, 100)
      }))
    }

    comfyui.on('progress', handleProgress)
    comfyui.on('executing', handleExecuting)
    comfyui.on('complete', handleComplete)

    return () => {
      comfyui.off('progress', handleProgress)
      comfyui.off('executing', handleExecuting)
      comfyui.off('complete', handleComplete)
    }
  }, [updateJobByPromptId])

  const enqueueJob = useCallback((job) => {
    setGenerationQueue(prev => [...prev, job])
  }, [])

  const handleGenerate = () => {
    if (!isConnected) return
    if (currentWorkflow?.needsImage && !selectedAsset) {
      setFormError('Please select an input asset first')
      return
    }

    setFormError(null)

    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const job = {
      id: jobId,
      createdAt: Date.now(),
      category,
      workflowId,
      workflowLabel: currentWorkflow?.label || workflowId,
      needsImage: !!currentWorkflow?.needsImage,
      prompt: fullPrompt,
      negativePrompt,
      tags: selectedTags,
      seed,
      duration,
      fps,
      resolution,
      editSteps,
      editCfg,
      musicTags,
      lyrics,
      musicDuration,
      bpm,
      keyscale,
      inputAssetId: selectedAsset?.id || null,
      inputAssetName: selectedAsset?.name || '',
      frameTime: frameTime || 0,
      status: 'queued',
      progress: 0,
      promptId: null,
      node: null,
      error: null,
    }

    enqueueJob(job)
  }

  // Poll for result
  const pollForResult = async (promptId, wfId, onProgress) => {
    const maxPolls = 600 // 10 minutes at 1s interval

    // Helper: extract filename from various ComfyUI API formats (old dict-based and new SavedResult)
    const getFilename = (item) => item?.filename || item?.file || item?.name
    const getSubfolder = (item) => item?.subfolder || item?.sub_folder || ''
    const getOutputType = (item) => item?.type || item?.folder_type || 'output'

    // Helper: check if a filename looks like a video file
    const isVideoFilename = (fn) => typeof fn === 'string' && /\.(mp4|webm|gif|mov|avi|mkv)$/i.test(fn)
    // Helper: check if a filename looks like an image file
    const isImageFilename = (fn) => typeof fn === 'string' && /\.(png|jpg|jpeg|webp|bmp|tiff)$/i.test(fn)
    // Helper: check if a filename looks like an audio file
    const isAudioFilename = (fn) => typeof fn === 'string' && /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(fn)

    // Helper: try to extract a media result from a single output item
    const extractFromItem = (item) => {
      const fn = getFilename(item)
      if (!fn) return null
      return { filename: fn, subfolder: getSubfolder(item), outputType: getOutputType(item) }
    }

    for (let i = 0; i < maxPolls; i++) {
      await new Promise(r => setTimeout(r, 1000))
      onProgress(Math.min(90, (i / maxPolls) * 90))

      try {
        const history = await comfyui.getHistory(promptId)
        // ComfyUI may return { [promptId]: { outputs } } or (for /history/id) { outputs } at top level
        const outputs = history?.[promptId]?.outputs ?? history?.outputs
        if (!outputs || typeof outputs !== 'object') continue

        // ── VIDEO detection: scan ALL nodes, ALL keys ──
        // Check known video keys first (videos, gifs), then any array key with video-like filenames
        for (const nodeId of Object.keys(outputs)) {
          const nodeOut = outputs[nodeId]
          if (!nodeOut || typeof nodeOut !== 'object') continue

          // Check known video array keys
          for (const key of ['videos', 'gifs', 'video']) {
            const items = nodeOut[key]
            if (Array.isArray(items) && items.length > 0) {
              const info = extractFromItem(items[0])
              if (info) {
                console.log(`[pollForResult] Found video in node ${nodeId}.${key}:`, info)
                return { type: 'video', ...info }
              }
            }
          }

          // Check ANY array-valued key for items with video-like filenames
          for (const key of Object.keys(nodeOut)) {
            if (['videos', 'gifs', 'video'].includes(key)) continue // already checked
            const val = nodeOut[key]
            if (Array.isArray(val) && val.length > 0) {
              const info = extractFromItem(val[0])
              if (info && isVideoFilename(info.filename)) {
                console.log(`[pollForResult] Found video in node ${nodeId}.${key} (by extension):`, info)
                return { type: 'video', ...info }
              }
            }
          }
        }

        // ── IMAGE detection: scan ALL nodes, ALL keys ──
        const images = []
        for (const nodeId of Object.keys(outputs)) {
          const nodeOut = outputs[nodeId]
          if (!nodeOut || typeof nodeOut !== 'object') continue

          // Check known image key
          if (Array.isArray(nodeOut.images)) {
            for (const img of nodeOut.images) {
              const info = extractFromItem(img)
              if (info && !isVideoFilename(info.filename)) {
                images.push({ type: 'image', ...info })
              }
            }
          }

          // Check any other array key with image-like filenames
          for (const key of Object.keys(nodeOut)) {
            if (key === 'images') continue
            const val = nodeOut[key]
            if (Array.isArray(val) && val.length > 0) {
              for (const item of val) {
                const info = extractFromItem(item)
                if (info && isImageFilename(info.filename)) {
                  images.push({ type: 'image', ...info })
                }
              }
            }
          }
        }
        if (images.length > 0) {
          console.log(`[pollForResult] Found ${images.length} image(s):`, images)
          return { type: 'images', items: images }
        }

        // ── AUDIO detection: scan ALL nodes, ALL keys ──
        for (const nodeId of Object.keys(outputs)) {
          const nodeOut = outputs[nodeId]
          if (!nodeOut || typeof nodeOut !== 'object') continue

          // Check known audio key
          if (nodeOut.audio) {
            const aud = Array.isArray(nodeOut.audio) ? nodeOut.audio[0] : nodeOut.audio
            const info = extractFromItem(aud)
            if (info) {
              console.log(`[pollForResult] Found audio in node ${nodeId}:`, info)
              return { type: 'audio', ...info }
            }
          }

          // Check any array key with audio-like filenames
          for (const key of Object.keys(nodeOut)) {
            if (key === 'audio') continue
            const val = nodeOut[key]
            if (Array.isArray(val) && val.length > 0) {
              const info = extractFromItem(val[0])
              if (info && isAudioFilename(info.filename)) {
                console.log(`[pollForResult] Found audio in node ${nodeId}.${key} (by extension):`, info)
                return { type: 'audio', ...info }
              }
            }
          }
        }

        // Check status for completion - if completed but nothing found, log and keep trying briefly
        const status = history?.[promptId]?.status ?? history?.status
        if (status?.completed || status?.status_str === 'success') {
          // Log the full outputs for debugging
          console.warn('[pollForResult] Generation completed but no output detected. Full outputs:', JSON.stringify(outputs, null, 2))
          console.warn('[pollForResult] Output node keys:', Object.keys(outputs))
          for (const nodeId of Object.keys(outputs)) {
            console.warn(`[pollForResult] Node ${nodeId} keys:`, Object.keys(outputs[nodeId] || {}))
          }
          // Give it a few more tries in case outputs are still being written
          if (i < maxPolls - 5) {
            onProgress(92)
            await new Promise(r => setTimeout(r, 2000))
            // Re-fetch and try once more
            const retryHistory = await comfyui.getHistory(promptId)
            const retryOutputs = retryHistory?.[promptId]?.outputs ?? retryHistory?.outputs
            if (retryOutputs && typeof retryOutputs === 'object') {
              // One final comprehensive scan - look for ANY item with a filename in ANY array
              for (const nodeId of Object.keys(retryOutputs)) {
                const nodeOut = retryOutputs[nodeId]
                if (!nodeOut || typeof nodeOut !== 'object') continue
                for (const key of Object.keys(nodeOut)) {
                  const val = nodeOut[key]
                  if (Array.isArray(val) && val.length > 0) {
                    const info = extractFromItem(val[0])
                    if (info) {
                      console.log(`[pollForResult] Retry found result in node ${nodeId}.${key}:`, info)
                      // Determine type by extension
                      if (isVideoFilename(info.filename)) return { type: 'video', ...info }
                      if (isAudioFilename(info.filename)) return { type: 'audio', ...info }
                      if (isImageFilename(info.filename)) return { type: 'images', items: [{ type: 'image', ...info }] }
                      // Unknown extension - assume video for video workflows
                      if (wfId === 'ltx2-t2v' || wfId === 'wan22-i2v') return { type: 'video', ...info }
                      return { type: 'images', items: [{ type: 'image', ...info }] }
                    }
                  }
                }
              }
              console.error('[pollForResult] Retry also found nothing. Outputs:', JSON.stringify(retryOutputs, null, 2))
            }
            break // exit loop
          }
          break
        }

      } catch (err) {
        console.warn('Poll error:', err)
      }
    }
    return null
  }

  // Save generation result to project assets
  const saveGenerationResult = async (result, wfId, job) => {
    if (!currentProjectHandle) return

    const jobPrompt = job?.prompt || ''
    const jobTags = job?.musicTags || ''
    const autoName = generateName(jobPrompt || jobTags || wfId)
    const jobDuration = job?.duration
    const jobFps = job?.fps
    const jobResolution = job?.resolution
    const jobSeed = job?.seed

    if (result.type === 'video') {
      try {
        const videoFile = await comfyui.downloadVideo(result.filename, result.subfolder, result.outputType)
        const assetInfo = await importAsset(currentProjectHandle, videoFile, 'video')
        const blobUrl = URL.createObjectURL(videoFile)
        const newAsset = addAsset({
          ...assetInfo,
          name: autoName,
          type: 'video',
          url: blobUrl,
          prompt: jobPrompt,
          isImported: true,
          settings: {
            duration: jobDuration,
            fps: jobFps,
            resolution: jobResolution ? `${jobResolution.width}x${jobResolution.height}` : undefined,
            seed: jobSeed
          }
        })
        if (isElectron() && currentProjectHandle && newAsset?.absolutePath) {
          enqueuePlaybackTranscode(currentProjectHandle, newAsset.id, newAsset.absolutePath).catch(() => {})
        }
      } catch (err) {
        console.error('Failed to save video:', err)
        // Fallback: use ComfyUI URL
        const url = comfyui.getMediaUrl(result.filename, result.subfolder, result.outputType)
        addAsset({
          name: autoName,
          type: 'video',
          url,
          prompt: jobPrompt,
          settings: { duration: jobDuration, fps: jobFps, seed: jobSeed }
        })
      }
    } else if (result.type === 'images') {
      for (const img of result.items) {
        try {
          const imageFile = await comfyui.downloadImage(img.filename, img.subfolder, img.outputType)
          const assetInfo = await importAsset(currentProjectHandle, imageFile, 'images')
          const blobUrl = URL.createObjectURL(imageFile)
          addAsset({ ...assetInfo, name: `${autoName}_${img.filename}`, type: 'image', url: blobUrl, prompt: jobPrompt, isImported: true })
        } catch (err) {
          console.warn('Failed to save image:', err)
          const url = comfyui.getMediaUrl(img.filename, img.subfolder, img.outputType)
          addAsset({ name: `${autoName}_${img.filename}`, type: 'image', url, prompt: jobPrompt })
        }
      }
    } else if (result.type === 'audio') {
      try {
        const url = comfyui.getMediaUrl(result.filename, result.subfolder, result.outputType)
        const resp = await fetch(url)
        const blob = await resp.blob()
        const file = new File([blob], result.filename, { type: 'audio/mpeg' })
        const assetInfo = await importAsset(currentProjectHandle, file, 'audio')
        const blobUrl = URL.createObjectURL(file)
        addAsset({
          ...assetInfo,
          name: autoName,
          type: 'audio',
          url: blobUrl,
          prompt: jobTags,
          isImported: true,
          settings: { duration: job?.musicDuration, bpm: job?.bpm, keyscale: job?.keyscale }
        })
      } catch (err) {
        console.warn('Failed to save audio:', err)
        const url = comfyui.getMediaUrl(result.filename, result.subfolder, result.outputType)
        addAsset({ name: autoName, type: 'audio', url, prompt: jobTags, settings: { duration: job?.musicDuration, bpm: job?.bpm } })
      }
    }
  }

  const runJob = useCallback(async (job) => {
    updateJob(job.id, { status: 'uploading', progress: 5, error: null })

    try {
      // Upload image if needed
      let uploadedFilename = null
      if (job.needsImage) {
        const inputAsset = assets.find(a => a.id === job.inputAssetId)
        if (!inputAsset) {
          throw new Error('Input asset not found')
        }

        let fileToUpload = null
        if (inputAsset.type === 'video') {
          fileToUpload = await extractFrameAsFile(inputAsset.url, job.frameTime || 0, `frame_${Date.now()}.png`)
        } else if (inputAsset.type === 'image') {
          const resp = await fetch(inputAsset.url)
          const blob = await resp.blob()
          fileToUpload = new File([blob], inputAsset.name || `input_${Date.now()}.png`, { type: blob.type })
        }

        if (!fileToUpload) {
          throw new Error('Unsupported input asset')
        }

        const uploadResult = await comfyui.uploadFile(fileToUpload)
        uploadedFilename = uploadResult?.name || fileToUpload.name
      }

      // Load workflow JSON
      updateJob(job.id, { status: 'configuring', progress: 20 })
      let workflowJson = null
      const workflowMap = {
        'ltx2-t2v': '/workflows/video_ltx2_t2v.json',
        'ltx2-i2v': '/workflows/ltx2_Image_to_Video.json',
        'wan22-i2v': '/workflows/video_wan2_2_14B_i2v.json',
        'multi-angles': '/workflows/1_click_multiple_angles.json',
        'image-edit': '/workflows/inflation.json',
        'music-gen': '/workflows/music_generation.json',
      }

      const workflowPath = workflowMap[job.workflowId]
      if (!workflowPath) throw new Error('Unknown workflow: ' + job.workflowId)

      const resp = await fetch(workflowPath)
      if (!resp.ok) throw new Error('Failed to load workflow file')
      workflowJson = await resp.json()

      // Modify workflow based on type
      updateJob(job.id, { status: 'configuring', progress: 30 })
      const {
        modifyLTX2Workflow,
        modifyLTX2I2VWorkflow,
        modifyWAN22Workflow,
        modifyMultipleAnglesWorkflow,
        modifyInflationWorkflow,
        modifyMusicWorkflow
      } = await import('../services/comfyui')

      let modifiedWorkflow = null
      switch (job.workflowId) {
        case 'ltx2-t2v':
          modifiedWorkflow = modifyLTX2Workflow(workflowJson, {
            prompt: job.prompt,
            negativePrompt: job.negativePrompt,
            width: job.resolution?.width,
            height: job.resolution?.height,
            frames: Math.round(job.duration * job.fps) + 1,
            seed: job.seed,
            fps: job.fps,
          })
          break
        case 'ltx2-i2v':
          modifiedWorkflow = modifyLTX2I2VWorkflow(workflowJson, {
            prompt: job.prompt,
            negativePrompt: job.negativePrompt,
            inputImage: uploadedFilename,
            width: job.resolution?.width,
            height: job.resolution?.height,
            frames: Math.round(job.duration * job.fps) + 1,
            fps: job.fps,
            seed: job.seed,
          })
          break
        case 'wan22-i2v':
          modifiedWorkflow = modifyWAN22Workflow(workflowJson, {
            prompt: job.prompt,
            negativePrompt: job.negativePrompt,
            inputImage: uploadedFilename,
            width: job.resolution?.width,
            height: job.resolution?.height,
            frames: Math.round(job.duration * job.fps) + 1,
            fps: job.fps,
            seed: job.seed,
          })
          break
        case 'multi-angles':
          modifiedWorkflow = modifyMultipleAnglesWorkflow(workflowJson, {
            inputImage: uploadedFilename,
            seed: job.seed,
          })
          break
        case 'image-edit':
          modifiedWorkflow = modifyInflationWorkflow(workflowJson, {
            prompt: job.prompt,
            inputImage: uploadedFilename,
            seed: job.seed,
            steps: job.editSteps,
            cfg: job.editCfg,
          })
          break
        case 'music-gen':
          modifiedWorkflow = modifyMusicWorkflow(workflowJson, {
            tags: job.musicTags,
            lyrics: job.lyrics,
            duration: job.musicDuration,
            bpm: job.bpm,
            seed: job.seed,
            keyscale: job.keyscale,
          })
          break
        default:
          throw new Error('Unhandled workflow: ' + job.workflowId)
      }

      // Queue the prompt
      updateJob(job.id, { status: 'queuing', progress: 40 })
      const promptId = await comfyui.queuePrompt(modifiedWorkflow)
      if (!promptId) throw new Error('Failed to queue prompt')

      updateJob(job.id, { status: 'running', progress: 45, promptId })

      // Poll for completion
      const result = await pollForResult(promptId, job.workflowId, (p) => {
        updateJob(job.id, (prev) => ({
          ...prev,
          progress: Math.max(prev.progress || 0, p)
        }))
      })

      // Save result to assets
      if (result) {
        updateJob(job.id, { status: 'saving', progress: 95 })
        await saveGenerationResult(result, job.workflowId, job)
        updateJob(job.id, { status: 'done', progress: 100 })
      } else {
        updateJob(job.id, {
          status: 'error',
          error: 'Generation finished but the output could not be detected',
          progress: 0
        })
      }
    } catch (err) {
      updateJob(job.id, {
        status: 'error',
        error: err?.message || 'Generation failed',
        progress: 0
      })
    }
  }, [assets, updateJob, saveGenerationResult, pollForResult])

  const processQueue = useCallback(async () => {
    if (processingRef.current) return
    const nextJob = queueRef.current.find(j => j.status === 'queued')
    if (!nextJob) return

    processingRef.current = true
    setActiveJobId(nextJob.id)
    await runJob(nextJob)
    processingRef.current = false
    setActiveJobId(null)

    // Continue with next job if any
    setTimeout(() => {
      processQueue()
    }, 0)
  }, [runJob])

  useEffect(() => {
    processQueue()
  }, [generationQueue, processQueue])

  const randomizeSeed = () => setSeed(Math.floor(Math.random() * 1000000000))

  // Determine if input column should show
  const showInputColumn = currentWorkflow?.needsImage

  // ============================================
  // Render
  // ============================================
  return (
    <div className="flex-1 flex flex-col min-w-0 bg-sf-dark-950">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-sf-dark-700">
        <div className="flex items-center gap-3">
          <Sparkles className="w-4 h-4 text-sf-accent" />
          <span className="text-sm font-semibold text-sf-text-primary">Generate</span>

          {/* Category tabs */}
          <div className="flex items-center gap-1 ml-4">
            {Object.entries(WORKFLOWS).map(([cat, workflows]) => {
              const Icon = CATEGORY_ICONS[cat]
              const isActive = category === cat
              return (
                <button key={cat} onClick={() => setCategory(cat)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${isActive ? 'bg-sf-accent text-white' : 'bg-sf-dark-800 text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-700'}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                  <span className="text-[9px] opacity-70">({workflows.length})</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-2">
          {activeCount > 0 && <span className="text-[10px] text-sf-text-muted">Running: {activeCount}</span>}
          {queuedCount > 0 && <span className="text-[10px] text-sf-text-muted">Queued: {queuedCount}</span>}
          {queueCount > 0 && <span className="text-[10px] text-sf-text-muted">ComfyUI Queue: {queueCount}</span>}
          <div className={`w-2 h-2 rounded-full ${isConnected ? (wsConnected ? 'bg-green-500' : 'bg-yellow-500') : 'bg-red-500'}`} title={isConnected ? (wsConnected ? 'Connected (WebSocket)' : 'Connected (HTTP)') : 'Disconnected'} />
          <span className="text-[10px] text-sf-text-muted">{isConnected ? 'ComfyUI' : 'Offline'}</span>
        </div>
      </div>

      {/* Main 3-column layout */}
      <div className="flex-1 min-h-0 flex">
        {/* Left: Input browser (conditional) */}
        {showInputColumn && (
          <div className="w-72 flex-shrink-0 border-r border-sf-dark-700 bg-sf-dark-900">
            <AssetInputBrowser
              selectedAsset={selectedAsset}
              onSelectAsset={(asset) => {
                setSelectedAsset(asset)
                setSelectedAssetId(asset?.id || null)
              }}
              filterType={currentWorkflow?.needsImage ? 'image' : null}
              frameTime={frameTime}
              onFrameTimeChange={setFrameTime}
            />
          </div>
        )}

        {/* Center: Settings */}
        <div className="flex-1 min-w-0 overflow-auto p-4">
          <div className="max-w-2xl mx-auto space-y-4">
            {/* Workflow selector */}
            <div>
              <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Workflow</label>
              <div className="flex gap-2 mt-1">
                {(WORKFLOWS[category] || []).map(wf => (
                  <button key={wf.id} onClick={() => setWorkflowId(wf.id)}
                    className={`flex-1 px-3 py-2 rounded-lg border text-xs transition-colors ${workflowId === wf.id ? 'bg-sf-accent/20 border-sf-accent text-sf-accent' : 'bg-sf-dark-800 border-sf-dark-600 text-sf-text-muted hover:border-sf-dark-500'}`}
                  >
                    <div className="font-medium">{wf.label}</div>
                    <div className="text-[9px] opacity-70 mt-0.5">{wf.description}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Workflow-specific settings */}
            {category === 'video' && (
              <>
                {/* Prompt */}
                <div>
                  <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Prompt</label>
                  <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
                    className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent resize-none"
                    placeholder="Describe the video you want to generate..."
                  />
                </div>
                <div>
                  <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Negative Prompt</label>
                  <textarea value={negativePrompt} onChange={e => setNegativePrompt(e.target.value)} rows={2}
                    className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent resize-none"
                    placeholder="What to avoid..."
                  />
                </div>
                {/* Cinematography tags */}
                <div>
                  <label className="text-[10px] text-sf-text-muted uppercase tracking-wider mb-1 block">Cinematography Tags</label>
                  <CinematographyTags selectedTags={selectedTags}
                    onAddTag={t => setSelectedTags(prev => [...prev, t])}
                    onRemoveTag={t => setSelectedTags(prev => prev.filter(x => x !== t))}
                  />
                </div>
                {/* Duration / Resolution / FPS / Seed */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Duration</label>
                    <div className="flex gap-1 mt-1">
                      {[2, 3, 5, 8].map(d => (
                        <button key={d} onClick={() => setDuration(d)}
                          className={`flex-1 py-1 rounded text-xs ${duration === d ? 'bg-sf-accent text-white' : 'bg-sf-dark-800 text-sf-text-muted hover:bg-sf-dark-700'}`}
                        >{d}s</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Resolution</label>
                    <select value={`${resolution.width}x${resolution.height}`}
                      onChange={e => { const [w, h] = e.target.value.split('x').map(Number); setResolution({ width: w, height: h }) }}
                      className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                    >
                      <optgroup label="16:9 Landscape">
                        <option value="1920x1080">1920x1080</option>
                        <option value="1280x720">1280x720</option>
                        <option value="1024x576">1024x576</option>
                        <option value="768x512">768x512</option>
                      </optgroup>
                      <optgroup label="9:16 Portrait">
                        <option value="1080x1920">1080x1920</option>
                        <option value="720x1280">720x1280</option>
                        <option value="576x1024">576x1024</option>
                        <option value="512x768">512x768</option>
                      </optgroup>
                    </select>
                    {aspectRatioWarning && (
                      <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-[10px] text-yellow-400">
                        <div className="font-medium mb-1">⚠ Aspect Ratio Mismatch</div>
                        <div className="text-[9px] opacity-90">
                          Input: <strong>{aspectRatioWarning.inputResolution}</strong> ({aspectRatioWarning.inputLabel})
                          <br />
                          Output: <strong>{aspectRatioWarning.outputResolution}</strong> ({aspectRatioWarning.outputLabel})
                          <br />
                          <span className="mt-1 block">
                            The input image will be resized/stretched to match the output resolution, which may cause distortion or cropping.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">FPS</label>
                    <select value={fps} onChange={e => setFps(Number(e.target.value))}
                      className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                    >
                      <option value={24}>24 fps</option>
                      <option value={30}>30 fps</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Seed</label>
                    <div className="flex gap-1 mt-1">
                      <input type="number" value={seed} onChange={e => setSeed(Number(e.target.value))}
                        className="flex-1 bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                      />
                      <button onClick={randomizeSeed} className="p-1 bg-sf-dark-700 hover:bg-sf-dark-600 rounded" title="Randomize">
                        <RefreshCw className="w-3 h-3 text-sf-text-muted" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {category === 'image' && (
              <>
                <div>
                  <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Prompt</label>
                  <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3}
                    className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent resize-none"
                    placeholder={workflowId === 'image-edit' ? 'Describe the edit (e.g. "inflate the subject")' : 'Camera angle prompts are preset for this workflow'}
                  />
                </div>
                {workflowId === 'image-edit' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Steps</label>
                      <input type="number" value={editSteps} onChange={e => setEditSteps(Number(e.target.value))} min={1} max={100}
                        className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">CFG Scale</label>
                      <input type="number" value={editCfg} onChange={e => setEditCfg(Number(e.target.value))} min={1} max={20} step={0.5}
                        className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                      />
                    </div>
                  </div>
                )}
                {workflowId === 'multi-angles' && (
                  <div className="p-3 bg-sf-dark-800/50 rounded-lg">
                    <div className="text-[10px] text-sf-text-muted">This workflow generates <strong className="text-sf-text-primary">8 camera angles</strong> from your input image:</div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {['Close-up', 'Wide', '45 Right', '90 Right', 'Aerial', 'Low Angle', '45 Left', '90 Left'].map(a => (
                        <span key={a} className="px-2 py-0.5 bg-sf-dark-700 rounded text-[9px] text-sf-text-secondary">{a}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Seed</label>
                  <div className="flex gap-1 mt-1">
                    <input type="number" value={seed} onChange={e => setSeed(Number(e.target.value))}
                      className="flex-1 bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                    />
                    <button onClick={randomizeSeed} className="p-1 bg-sf-dark-700 hover:bg-sf-dark-600 rounded">
                      <RefreshCw className="w-3 h-3 text-sf-text-muted" />
                    </button>
                  </div>
                </div>
              </>
            )}

            {category === 'audio' && (
              <>
                <div>
                  <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Style Tags</label>
                  <textarea value={musicTags} onChange={e => setMusicTags(e.target.value)} rows={2}
                    className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent resize-none"
                    placeholder="cinematic orchestral, epic, dramatic, strings, brass"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Lyrics (optional)</label>
                  <textarea value={lyrics} onChange={e => setLyrics(e.target.value)} rows={4}
                    className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent resize-none"
                    placeholder="Leave empty for instrumental..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Duration</label>
                    <div className="flex gap-1 mt-1">
                      {[15, 30, 60, 120].map(d => (
                        <button key={d} onClick={() => setMusicDuration(d)}
                          className={`flex-1 py-1 rounded text-xs ${musicDuration === d ? 'bg-sf-accent text-white' : 'bg-sf-dark-800 text-sf-text-muted hover:bg-sf-dark-700'}`}
                        >{d}s</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">BPM</label>
                    <input type="number" value={bpm} onChange={e => setBpm(Number(e.target.value))} min={40} max={240}
                      className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Key / Scale</label>
                    <select value={keyscale} onChange={e => setKeyscale(e.target.value)}
                      className="mt-1 w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                    >
                      {['C major', 'C minor', 'D major', 'D minor', 'E major', 'E minor', 'F major', 'F minor', 'G major', 'G minor', 'A major', 'A minor', 'B major', 'B minor'].map(k => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-sf-text-muted uppercase tracking-wider">Seed</label>
                    <div className="flex gap-1 mt-1">
                      <input type="number" value={seed} onChange={e => setSeed(Number(e.target.value))}
                        className="flex-1 bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1 text-xs text-sf-text-primary"
                      />
                      <button onClick={randomizeSeed} className="p-1 bg-sf-dark-700 hover:bg-sf-dark-600 rounded">
                        <RefreshCw className="w-3 h-3 text-sf-text-muted" />
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right: Progress + Generate */}
        <div className="w-80 flex-shrink-0 border-l border-sf-dark-700 bg-sf-dark-900 flex flex-col">
          <div className="flex-shrink-0 p-4 border-b border-sf-dark-700">
            <button
              onClick={handleGenerate}
              disabled={!isConnected}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                !isConnected ? 'bg-sf-dark-700 text-sf-text-muted cursor-not-allowed'
                : 'bg-sf-accent hover:bg-sf-accent-hover text-white'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              Queue {category === 'video' ? 'Video' : category === 'image' ? 'Image' : 'Audio'}
            </button>

            {!isConnected && (
              <div className="mt-2 text-[10px] text-sf-error text-center">ComfyUI is not running. Start it to generate.</div>
            )}

            {currentWorkflow?.needsImage && !selectedAsset && (
              <div className="mt-2 text-[10px] text-yellow-500 text-center">Select an input asset from the left panel</div>
            )}

            {formError && (
              <div className="mt-2 text-[10px] text-sf-error text-center">{formError}</div>
            )}
          </div>

          {/* Queue list */}
          {hasJobs && (
            <div className="p-4 border-b border-sf-dark-700 space-y-3">
              {generationQueue.map((job) => {
                const percent = Math.round(job.progress || 0)
                const statusLabel = job.status === 'queued' ? 'Queued'
                  : job.status === 'uploading' ? 'Uploading input'
                  : job.status === 'configuring' ? 'Configuring workflow'
                  : job.status === 'queuing' ? 'Queued in ComfyUI'
                  : job.status === 'running' ? 'Generating'
                  : job.status === 'saving' ? 'Saving to project'
                  : job.status === 'done' ? 'Complete'
                  : job.status === 'error' ? 'Failed'
                  : job.status
                const title = `${job.workflowLabel || job.workflowId}${job.prompt ? ` — ${job.prompt}` : ''}`
                return (
                  <div key={job.id} className="bg-sf-dark-800 rounded-lg p-3 border border-sf-dark-700">
                    <div className="flex items-center justify-between text-[10px] text-sf-text-muted mb-1">
                      <span className="text-sf-text-primary truncate" title={title}>
                        {job.workflowLabel || job.workflowId}
                      </span>
                      <span className="tabular-nums">{percent}%</span>
                    </div>
                    <div className="h-1.5 bg-sf-dark-900 rounded-full overflow-hidden">
                      <div className="h-full bg-sf-accent transition-all duration-300" style={{ width: `${percent}%` }} />
                    </div>
                    <div className="mt-1 text-[9px] text-sf-text-muted">
                      {statusLabel}{job.node ? ` · Node ${job.node}` : ''}
                    </div>
                    {job.error && (
                      <div className="mt-1 text-[9px] text-sf-error">{job.error}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Info panel */}
          <div className="flex-1 overflow-auto p-4">
            <div className="text-[10px] text-sf-text-muted uppercase tracking-wider mb-2">Workflow Info</div>
            <div className="space-y-2 text-[11px] text-sf-text-secondary">
              <div><span className="text-sf-text-muted">Category:</span> {category}</div>
              <div><span className="text-sf-text-muted">Workflow:</span> {currentWorkflow?.label}</div>
              <div><span className="text-sf-text-muted">Needs input:</span> {currentWorkflow?.needsImage ? 'Yes (image)' : 'No'}</div>
              {category === 'video' && (
                <>
                  <div><span className="text-sf-text-muted">Output:</span> {duration}s @ {fps}fps ({getFrameCount()} frames)</div>
                  <div><span className="text-sf-text-muted">Resolution:</span> {resolution.width}x{resolution.height}</div>
                </>
              )}
              {category === 'audio' && (
                <>
                  <div><span className="text-sf-text-muted">Duration:</span> {musicDuration}s</div>
                  <div><span className="text-sf-text-muted">BPM:</span> {bpm}</div>
                  <div><span className="text-sf-text-muted">Key:</span> {keyscale}</div>
                </>
              )}
              <div><span className="text-sf-text-muted">Seed:</span> {seed}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default GenerateWorkspace

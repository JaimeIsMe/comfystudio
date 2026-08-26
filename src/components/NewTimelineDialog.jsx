import { useState, useEffect } from 'react'
import { X, Film, Monitor, Gauge, Loader2, Copy } from 'lucide-react'
import useProjectStore, { RESOLUTION_PRESETS, FPS_PRESETS } from '../stores/projectStore'
import { useI18n } from '../i18n/I18nContext'

function NewTimelineDialog({ isOpen, onClose, onCreated }) {
  const { t } = useI18n()
  const [timelineName, setTimelineName] = useState('')
  const [selectedResolution, setSelectedResolution] = useState(RESOLUTION_PRESETS[0])
  const [customWidth, setCustomWidth] = useState(1920)
  const [customHeight, setCustomHeight] = useState(1080)
  const [isCustomResolution, setIsCustomResolution] = useState(false)
  const [useProjectSettings, setUseProjectSettings] = useState(true)
  const [selectedFps, setSelectedFps] = useState(FPS_PRESETS[2]) // Default to 24fps
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState(null)
  
  const { currentProject, createTimeline, switchTimeline, getTimelines } = useProjectStore()
  
  // Get project settings for "Use Project Settings" option
  const projectSettings = currentProject?.settings || { width: 1920, height: 1080, fps: 24 }
  
  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      const timelines = getTimelines()
      const timelineNumber = timelines.length + 1
      setTimelineName(t('timelineDialog.defaultName', { number: timelineNumber }))
      setUseProjectSettings(true)
      setSelectedResolution(RESOLUTION_PRESETS[0])
      setIsCustomResolution(false)
      setSelectedFps(FPS_PRESETS.find(f => f.value === projectSettings.fps) || FPS_PRESETS[2])
      setError(null)
    }
  }, [isOpen, getTimelines, projectSettings.fps, t])
  
  if (!isOpen) return null
  
  // Validate timeline name
  const isValidName = timelineName.trim().length > 0
  
  // Get final resolution values
  const finalWidth = useProjectSettings 
    ? projectSettings.width 
    : (isCustomResolution ? customWidth : selectedResolution.width)
  const finalHeight = useProjectSettings 
    ? projectSettings.height 
    : (isCustomResolution ? customHeight : selectedResolution.height)
  const finalFps = useProjectSettings ? projectSettings.fps : selectedFps.value
  
  // Calculate aspect ratio for custom resolution
  const gcd = (a, b) => b === 0 ? a : gcd(b, a % b)
  const getAspectRatio = (w, h) => {
    const divisor = gcd(w, h)
    return `${w / divisor}:${h / divisor}`
  }
  
  // Find matching preset or return custom label
  const getResolutionLabel = (w, h) => {
    const preset = RESOLUTION_PRESETS.find(p => p.width === w && p.height === h)
    return preset ? preset.name : t('common.custom')
  }
  
  const handleCreate = async () => {
    if (!isValidName) return
    
    setIsCreating(true)
    setError(null)
    
    try {
      const newTimeline = createTimeline({
        name: timelineName.trim(),
        width: finalWidth,
        height: finalHeight,
        fps: finalFps,
      })
      
      if (newTimeline) {
        // Switch to the new timeline
        await switchTimeline(newTimeline.id)
        onCreated?.(newTimeline)
        onClose()
      } else {
        setError(t('timelineDialog.createFailed'))
      }
    } catch (err) {
      setError(err.message || t('timelineDialog.createError'))
    }
    
    setIsCreating(false)
  }
  
  const handleClose = () => {
    if (!isCreating) {
      onClose()
    }
  }
  
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-sf-dark-900 border border-sf-dark-700 rounded-xl w-full max-w-md mx-4 overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-sf-dark-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-sf-accent rounded-lg flex items-center justify-center">
              <Film className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-lg font-semibold text-sf-text-primary">{t('timelineDialog.title')}</h2>
          </div>
          <button
            onClick={handleClose}
            disabled={isCreating}
            className="p-1.5 hover:bg-sf-dark-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5 text-sf-text-muted" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-5 space-y-5">
          {/* Error Display */}
          {error && (
            <div className="p-3 bg-sf-error/20 border border-sf-error/50 rounded-lg">
              <p className="text-sm text-sf-error">{error}</p>
            </div>
          )}
          
          {/* Timeline Name */}
          <div>
            <label className="block text-sm font-medium text-sf-text-primary mb-2">
              {t('timelineDialog.name')}
            </label>
            <input
              type="text"
              value={timelineName}
              onChange={(e) => setTimelineName(e.target.value)}
              placeholder={t('timelineDialog.namePlaceholder')}
              disabled={isCreating}
              className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-4 py-2.5 text-sm text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent disabled:opacity-50"
              autoFocus
            />
          </div>
          
          {/* Use Project Settings Toggle */}
          <div>
            <button
              onClick={() => setUseProjectSettings(!useProjectSettings)}
              disabled={isCreating}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
                useProjectSettings
                  ? 'bg-sf-accent/20 border-sf-accent text-sf-text-primary'
                  : 'bg-sf-dark-800 border-sf-dark-600 text-sf-text-secondary hover:border-sf-dark-500'
              } disabled:opacity-50`}
            >
              <Copy className={`w-4 h-4 ${useProjectSettings ? 'text-sf-accent' : 'text-sf-text-muted'}`} />
              <div className="flex-1 text-left">
                <p className="text-sm font-medium">{t('timelineDialog.useProjectSettings')}</p>
                <p className="text-xs opacity-70">
                  {t('projectDialog.summary', { width: projectSettings.width, height: projectSettings.height, fps: projectSettings.fps })}
                </p>
              </div>
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                useProjectSettings ? 'border-sf-accent bg-sf-accent' : 'border-sf-dark-500'
              }`}>
                {useProjectSettings && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
              </div>
            </button>
          </div>
          
          {/* Custom Settings (shown when not using project settings) */}
          {!useProjectSettings && (
            <>
              {/* Resolution */}
              <div>
                <label className="block text-sm font-medium text-sf-text-primary mb-2">
                  <Monitor className="w-4 h-4 inline mr-2" />
                  {t('projectDialog.resolution')}
                </label>
                
                {/* Preset buttons */}
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {RESOLUTION_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => {
                        setSelectedResolution(preset)
                        setIsCustomResolution(false)
                      }}
                      disabled={isCreating}
                      className={`px-3 py-2 rounded-lg text-left transition-colors ${
                        !isCustomResolution && selectedResolution.name === preset.name
                          ? 'bg-sf-accent text-white'
                          : 'bg-sf-dark-800 border border-sf-dark-600 text-sf-text-primary hover:border-sf-dark-500'
                      } disabled:opacity-50`}
                    >
                      <p className="text-xs font-medium">{preset.name}</p>
                      <p className="text-[10px] opacity-70">
                        {preset.width}x{preset.height} ({preset.aspect})
                      </p>
                    </button>
                  ))}
                  
                  {/* Custom option */}
                  <button
                    onClick={() => setIsCustomResolution(true)}
                    disabled={isCreating}
                    className={`px-3 py-2 rounded-lg text-left transition-colors ${
                      isCustomResolution
                        ? 'bg-sf-accent text-white'
                        : 'bg-sf-dark-800 border border-sf-dark-600 text-sf-text-primary hover:border-sf-dark-500'
                    } disabled:opacity-50`}
                  >
                    <p className="text-xs font-medium">{t('common.custom')}</p>
                    <p className="text-[10px] opacity-70">
                      {isCustomResolution ? `${customWidth}x${customHeight}` : t('projectDialog.enterDimensions')}
                    </p>
                  </button>
                </div>
                
                {/* Custom inputs */}
                {isCustomResolution && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={customWidth}
                      onChange={(e) => setCustomWidth(Math.max(1, parseInt(e.target.value) || 1))}
                      min="1"
                      max="7680"
                      disabled={isCreating}
                      className="flex-1 bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-sm text-sf-text-primary focus:outline-none focus:border-sf-accent disabled:opacity-50"
                      placeholder={t('projectDialog.width')}
                    />
                    <span className="text-sf-text-muted">×</span>
                    <input
                      type="number"
                      value={customHeight}
                      onChange={(e) => setCustomHeight(Math.max(1, parseInt(e.target.value) || 1))}
                      min="1"
                      max="4320"
                      disabled={isCreating}
                      className="flex-1 bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-3 py-2 text-sm text-sf-text-primary focus:outline-none focus:border-sf-accent disabled:opacity-50"
                      placeholder={t('projectDialog.height')}
                    />
                    <span className="text-xs text-sf-text-muted w-16 text-right">
                      {getAspectRatio(customWidth, customHeight)}
                    </span>
                  </div>
                )}
              </div>
              
              {/* Frame Rate */}
              <div>
                <label className="block text-sm font-medium text-sf-text-primary mb-2">
                  <Gauge className="w-4 h-4 inline mr-2" />
                  {t('projectDialog.frameRate')}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {FPS_PRESETS.map((fps) => (
                    <button
                      key={fps.value}
                      onClick={() => setSelectedFps(fps)}
                      disabled={isCreating}
                      className={`px-3 py-2 rounded-lg text-center transition-colors ${
                        selectedFps.value === fps.value
                          ? 'bg-sf-accent text-white'
                          : 'bg-sf-dark-800 border border-sf-dark-600 text-sf-text-primary hover:border-sf-dark-500'
                      } disabled:opacity-50`}
                    >
                      <p className="text-xs font-medium">{fps.value} fps</p>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          
          {/* Summary */}
          <div className="bg-sf-dark-800 rounded-lg p-3">
            <p className="text-xs text-sf-text-muted mb-1">{t('timelineDialog.settings')}</p>
            <p className="text-sm text-sf-text-primary">
              {t('projectDialog.summary', { width: finalWidth, height: finalHeight, fps: finalFps })}
              <span className="text-sf-text-muted"> ({getAspectRatio(finalWidth, finalHeight)})</span>
              {useProjectSettings && (
                <span className="text-sf-accent text-xs ml-2">({t('timelineDialog.projectDefault')})</span>
              )}
            </p>
          </div>
        </div>
        
        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-sf-dark-700 bg-sf-dark-850">
          <button
            onClick={handleClose}
            disabled={isCreating}
            className="px-4 py-2 text-sm text-sf-text-secondary hover:text-sf-text-primary transition-colors disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleCreate}
            disabled={!isValidName || isCreating}
            className="flex items-center gap-2 px-5 py-2 bg-sf-blue hover:bg-sf-blue-hover disabled:bg-sf-dark-700 disabled:cursor-not-allowed rounded-lg text-sm text-white font-medium transition-colors"
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('timelineDialog.creating')}
              </>
            ) : (
              t('timelineDialog.create')
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default NewTimelineDialog

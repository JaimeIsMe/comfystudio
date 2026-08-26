import { useState, useEffect } from 'react'
import { X, Loader2 } from 'lucide-react'
import useProjectStore, { RESOLUTION_PRESETS, FPS_PRESETS } from '../stores/projectStore'
import { useI18n } from '../i18n/I18nContext'

function NewProjectDialog({ isOpen, onClose }) {
  const { t } = useI18n()
  const { createProject, defaultResolution, defaultFps } = useProjectStore()
  const [projectName, setProjectName] = useState('')
  const [selectedResolution, setSelectedResolution] = useState(() => {
    const preset = RESOLUTION_PRESETS.find(p => p.name === (defaultResolution || 'HD 1080p'))
    return preset || RESOLUTION_PRESETS[0]
  })
  const [customWidth, setCustomWidth] = useState(1920)
  const [customHeight, setCustomHeight] = useState(1080)
  const [isCustomResolution, setIsCustomResolution] = useState(false)
  const [selectedFps, setSelectedFps] = useState(() => {
    const preset = FPS_PRESETS.find(f => f.value === (defaultFps ?? 24))
    return preset || FPS_PRESETS[2]
  })
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState(null)

  // Sync with store defaults when dialog opens
  useEffect(() => {
    if (isOpen) {
      const resPreset = RESOLUTION_PRESETS.find(p => p.name === (defaultResolution || 'HD 1080p')) || RESOLUTION_PRESETS[0]
      const fpsPreset = FPS_PRESETS.find(f => f.value === (defaultFps ?? 24)) || FPS_PRESETS[2]
      setSelectedResolution(resPreset)
      setSelectedFps(fpsPreset)
    }
  }, [isOpen, defaultResolution, defaultFps])
  
  if (!isOpen) return null
  
  // Validate project name
  const isValidName = projectName.trim().length > 0 && 
    !/[<>:"/\\|?*]/.test(projectName) // No invalid filename characters
  
  // Get final resolution values
  const finalWidth = isCustomResolution ? customWidth : selectedResolution.width
  const finalHeight = isCustomResolution ? customHeight : selectedResolution.height
  
  // Calculate aspect ratio for custom resolution
  const gcd = (a, b) => b === 0 ? a : gcd(b, a % b)
  const getAspectRatio = (w, h) => {
    const divisor = gcd(w, h)
    return `${w / divisor}:${h / divisor}`
  }
  
  const handleCreate = async () => {
    if (!isValidName) return
    
    setIsCreating(true)
    setError(null)
    
    try {
      const result = await createProject({
        name: projectName.trim(),
        width: finalWidth,
        height: finalHeight,
        fps: selectedFps.value,
      })
      
      if (result) {
        // Success - dialog will close as project opens
        onClose()
        resetForm()
      } else {
        setError(t('projectDialog.createFailed'))
      }
    } catch (err) {
      setError(err.message || t('projectDialog.createError'))
    }
    
    setIsCreating(false)
  }
  
  const resetForm = () => {
    setProjectName('')
    const resPreset = RESOLUTION_PRESETS.find(p => p.name === (defaultResolution || 'HD 1080p')) || RESOLUTION_PRESETS[0]
    const fpsPreset = FPS_PRESETS.find(f => f.value === (defaultFps ?? 24)) || FPS_PRESETS[2]
    setSelectedResolution(resPreset)
    setCustomWidth(1920)
    setCustomHeight(1080)
    setIsCustomResolution(false)
    setSelectedFps(fpsPreset)
    setError(null)
  }
  
  const handleClose = () => {
    if (!isCreating) {
      resetForm()
      onClose()
    }
  }
  
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-sf-dark-900 border border-sf-dark-700 rounded-xl w-full max-w-md mx-4 overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-sf-dark-700">
          <h2 className="text-lg font-semibold text-sf-text-primary">{t('projectDialog.title')}</h2>
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
          
          {/* Project Name */}
          <div>
            <label className="block text-sm font-medium text-sf-text-primary mb-2">
              {t('projectDialog.name')}
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder={t('projectDialog.namePlaceholder')}
              disabled={isCreating}
              className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-4 py-2.5 text-sm text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent disabled:opacity-50"
              autoFocus
            />
            {projectName && !isValidName && (
              <p className="text-xs text-sf-error mt-1">
                {t('projectDialog.invalidName')} {'< > : " / \\ | ? *'}
              </p>
            )}
          </div>
          
          {/* Resolution */}
          <div>
            <label className="block text-sm font-medium text-sf-text-primary mb-2">
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
          
          {/* Summary */}
          <div className="bg-sf-dark-800 rounded-lg p-3">
            <p className="text-xs text-sf-text-muted mb-1">{t('projectDialog.settings')}</p>
            <p className="text-sm text-sf-text-primary">
              {t('projectDialog.summary', { width: finalWidth, height: finalHeight, fps: selectedFps.value })}
              {isCustomResolution && (
                <span className="text-sf-text-muted"> ({getAspectRatio(finalWidth, finalHeight)})</span>
              )}
              {!isCustomResolution && (
                <span className="text-sf-text-muted"> ({selectedResolution.aspect})</span>
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
                {t('projectDialog.creating')}
              </>
            ) : (
              t('projectDialog.create')
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default NewProjectDialog

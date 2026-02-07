import { useState, useEffect } from 'react'
import { X, Wand2, Loader2, AlertCircle, Image, Video, Layers, Settings2 } from 'lucide-react'
import { useComfyUI } from '../hooks/useComfyUI'
import useAssetsStore from '../stores/assetsStore'
import useProjectStore from '../stores/projectStore'

/**
 * Dialog for generating masks from images/videos using SAM3 text prompts
 */
function MaskGenerationDialog({ asset, onClose, currentFolderId }) {
  const [textPrompt, setTextPrompt] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [scoreThreshold, setScoreThreshold] = useState(0.04)
  const [localError, setLocalError] = useState(null)
  
  const { 
    isConnected, 
    isGenerating, 
    progress, 
    error: comfyError, 
    generateMask,
    maskResult,
    clearMaskResult,
    wsConnected,
    currentNode 
  } = useComfyUI()
  
  const { addMaskAsset } = useAssetsStore()
  const { currentProjectHandle } = useProjectStore()
  
  // Track if we've already processed this result to prevent double-processing
  const [processedResultId, setProcessedResultId] = useState(null)
  
  // Handle successful mask generation
  useEffect(() => {
    // Only process if we have a result, it matches our asset, and we haven't processed it yet
    if (maskResult && maskResult.sourceAssetId === asset.id && processedResultId !== maskResult.url) {
      console.log('Processing mask result:', maskResult)
      
      // Mark as processed immediately to prevent re-entry
      setProcessedResultId(maskResult.url)
      
      try {
        // Add the mask as a new asset
        addMaskAsset({
          name: `${asset.name}_mask`,
          sourceAssetId: asset.id,
          prompt: textPrompt,
          url: maskResult.url,
          maskFrames: maskResult.maskFrames || [],
          frameCount: maskResult.frameCount || 1,
          folderId: currentFolderId,
          settings: {
            width: maskResult.width,
            height: maskResult.height,
          },
          mimeType: 'image/png',
        })
        
        console.log('Mask asset added successfully')
        
        // Clear result and close dialog after a small delay to let state settle
        setTimeout(() => {
          clearMaskResult()
          onClose()
        }, 100)
      } catch (err) {
        console.error('Error adding mask asset:', err)
        setLocalError('Failed to save mask: ' + err.message)
      }
    }
  }, [maskResult, asset.id, asset.name, textPrompt, currentFolderId, processedResultId])
  
  const handleGenerate = async () => {
    if (!textPrompt.trim()) {
      setLocalError('Please enter a text prompt describing what to mask')
      return
    }
    
    if (!isConnected) {
      setLocalError('ComfyUI is not connected. Please make sure it is running.')
      return
    }
    
    setLocalError(null)
    
    try {
      await generateMask({
        asset,
        textPrompt: textPrompt.trim(),
        scoreThreshold,
        projectHandle: currentProjectHandle,
      })
    } catch (err) {
      setLocalError(err.message || 'Failed to start mask generation')
    }
  }
  
  const handleClose = () => {
    if (!isGenerating) {
      onClose()
    }
  }
  
  const error = localError || comfyError
  
  // Get progress display text
  const getProgressText = () => {
    if (!isGenerating) return null
    if (currentNode) {
      // Map common node types to friendly names
      const nodeNames = {
        '8': 'Loading video...',
        '10': 'Loading SAM3 model...',
        '12': 'Segmenting with text prompt...',
        '9': 'Propagating mask...',
        '13': 'Processing mask output...',
        '1': 'Refining mask edges...',
        '4': 'Converting mask to image...',
        '5': 'Saving mask...',
      }
      return nodeNames[currentNode] || `Processing node ${currentNode}...`
    }
    if (progress.percent > 0) {
      return `Processing... ${progress.percent}%`
    }
    return 'Starting mask generation...'
  }
  
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-sf-dark-900 border border-sf-dark-700 rounded-xl w-full max-w-md mx-4 overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-sf-dark-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center">
              <Wand2 className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-sf-text-primary">Create Mask</h2>
              <p className="text-xs text-sf-text-muted">AI-powered segmentation</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={isGenerating}
            className="p-1.5 hover:bg-sf-dark-700 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5 text-sf-text-muted" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Error Display */}
          {error && (
            <div className="p-3 bg-sf-error/20 border border-sf-error/50 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-sf-error flex-shrink-0 mt-0.5" />
              <p className="text-sm text-sf-error">{error}</p>
            </div>
          )}
          
          {/* WebSocket Warning */}
          {isConnected && !wsConnected && (
            <div className="p-3 bg-sf-accent/20 border border-sf-accent/50 rounded-lg">
              <p className="text-xs text-sf-accent">
                WebSocket not connected. Progress updates may be limited.
              </p>
            </div>
          )}
          
          {/* Source Asset Preview */}
          <div className="flex items-center gap-3 p-3 bg-sf-dark-800 rounded-lg">
            <div className="w-16 h-16 bg-sf-dark-700 rounded overflow-hidden flex-shrink-0">
              {asset.type === 'video' && asset.url ? (
                <video
                  src={asset.url}
                  className="w-full h-full object-cover"
                  muted
                />
              ) : asset.type === 'image' && asset.url ? (
                <img
                  src={asset.url}
                  alt={asset.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  {asset.type === 'video' ? (
                    <Video className="w-6 h-6 text-sf-text-muted" />
                  ) : (
                    <Image className="w-6 h-6 text-sf-text-muted" />
                  )}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-sf-text-primary truncate">{asset.name}</p>
              <p className="text-xs text-sf-text-muted">
                {asset.type === 'video' ? 'Video' : 'Image'}
                {asset.settings?.width && asset.settings?.height && (
                  <span> • {asset.settings.width}x{asset.settings.height}</span>
                )}
                {asset.settings?.duration && (
                  <span> • {asset.settings.duration.toFixed(1)}s</span>
                )}
              </p>
            </div>
            <div className="px-2 py-1 bg-sf-dark-700 rounded text-[10px] text-sf-text-muted uppercase">
              Source
            </div>
          </div>
          
          {/* Text Prompt Input */}
          <div>
            <label className="block text-sm font-medium text-sf-text-primary mb-2">
              What to mask?
            </label>
            <textarea
              value={textPrompt}
              onChange={(e) => setTextPrompt(e.target.value)}
              placeholder="Describe what you want to select, e.g., 'person on the left', 'red car', 'the cat'..."
              disabled={isGenerating}
              rows={3}
              className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded-lg px-4 py-2.5 text-sm text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-purple-500 disabled:opacity-50 resize-none"
              autoFocus
            />
            <p className="text-xs text-sf-text-muted mt-1">
              Be specific about position, color, or other distinguishing features
            </p>
          </div>
          
          {/* Advanced Settings Toggle */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-xs text-sf-text-muted hover:text-sf-text-secondary transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5" />
            {showAdvanced ? 'Hide' : 'Show'} advanced settings
          </button>
          
          {/* Advanced Settings */}
          {showAdvanced && (
            <div className="p-3 bg-sf-dark-800 rounded-lg space-y-3">
              <div>
                <label className="flex items-center justify-between text-xs text-sf-text-secondary mb-1">
                  <span>Detection Sensitivity</span>
                  <span className="text-sf-text-muted">{scoreThreshold.toFixed(2)}</span>
                </label>
                <input
                  type="range"
                  min="0.01"
                  max="0.2"
                  step="0.01"
                  value={scoreThreshold}
                  onChange={(e) => setScoreThreshold(parseFloat(e.target.value))}
                  disabled={isGenerating}
                  className="w-full h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-purple-500 disabled:opacity-50"
                />
                <div className="flex justify-between text-[10px] text-sf-text-muted mt-1">
                  <span>More sensitive</span>
                  <span>Less sensitive</span>
                </div>
              </div>
            </div>
          )}
          
          {/* Progress Display */}
          {isGenerating && (
            <div className="p-4 bg-sf-dark-800 rounded-lg">
              <div className="flex items-center gap-3 mb-3">
                <Loader2 className="w-5 h-5 text-purple-500 animate-spin" />
                <div className="flex-1">
                  <p className="text-sm text-sf-text-primary">{getProgressText()}</p>
                </div>
              </div>
              <div className="w-full h-2 bg-sf-dark-600 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-purple-500 transition-all duration-300"
                  style={{ width: `${progress.percent || 0}%` }}
                />
              </div>
              <p className="text-xs text-sf-text-muted mt-2 text-center">
                {asset.type === 'video' 
                  ? 'Generating mask for all frames...' 
                  : 'Generating mask...'}
              </p>
            </div>
          )}
          
          {/* Output Preview Info */}
          <div className="flex items-center gap-2 p-3 bg-purple-600/10 border border-purple-600/30 rounded-lg">
            <Layers className="w-4 h-4 text-purple-400" />
            <p className="text-xs text-purple-300">
              {asset.type === 'video' 
                ? 'Output: PNG sequence mask (one per frame)'
                : 'Output: Single PNG mask image'}
            </p>
          </div>
        </div>
        
        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-sf-dark-700 bg-sf-dark-850">
          <button
            onClick={handleClose}
            disabled={isGenerating}
            className="px-4 py-2 text-sm text-sf-text-secondary hover:text-sf-text-primary transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={!textPrompt.trim() || isGenerating || !isConnected}
            className="flex items-center gap-2 px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-sf-dark-700 disabled:cursor-not-allowed rounded-lg text-sm text-white font-medium transition-colors"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" />
                Generate Mask
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default MaskGenerationDialog

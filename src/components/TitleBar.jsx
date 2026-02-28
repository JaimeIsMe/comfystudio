import { Fragment } from 'react'
import { Minus, Square, X } from 'lucide-react'

const TOP_TABS = [
  { id: 'editor', label: 'Editor' },
  { id: 'generate', label: 'Generate' },
  { id: 'remotion', label: 'Remotion' },
  { id: 'stock', label: 'Stock' },
  { id: 'comfyui', label: 'ComfyUI' },
  { id: 'llm-assistant', label: 'LLM' },
  { id: 'export', label: 'Export' },
]

function TitleBar({
  projectName,
  activeTab = 'editor',
  onTabChange,
  centerInsetLeft = 0,
  centerInsetRight = 0,
  showComfyUiTab = true,
}) {
  const tabs = showComfyUiTab ? TOP_TABS : TOP_TABS.filter(t => t.id !== 'comfyui')

  const handleMinimize = () => {
    window.electronAPI?.minimizeWindow?.()
  }

  const handleToggleMaximize = () => {
    window.electronAPI?.toggleMaximizeWindow?.()
  }

  const handleCloseWindow = () => {
    window.electronAPI?.closeWindow?.()
  }
  
  return (
    <div className="h-10 bg-black flex items-center justify-between px-4 drag-region relative">
      {/* Left - Spacer for center alignment */}
      <div className="w-[120px] flex-shrink-0" />
      
      {/* Center - App mode tabs; extend 1px into content so grey touches with no black line */}
      <div
        className="absolute top-0 flex items-center justify-center"
        style={{
          left: `${centerInsetLeft}px`,
          right: `${centerInsetRight}px`,
          bottom: -1,
          height: 'calc(100% + 1px)'
        }}
      >
        <div className="no-drag flex items-center gap-0 h-full bg-sf-dark-800 border-x border-sf-dark-700 border-t-0 rounded-none p-0.5">
          {tabs.map((tab, index) => (
            <Fragment key={tab.id}>
              {index > 0 && (
                <div className="w-px h-4 bg-sf-dark-600 flex-shrink-0" aria-hidden="true" />
              )}
              <button
                onClick={() => onTabChange?.(tab.id)}
                className={`px-3 py-1 text-[11px] rounded-none transition-colors ${
                  activeTab === tab.id
                    ? 'bg-sf-accent text-white'
                    : 'text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-700'
                }`}
              >
                {tab.label}
              </button>
            </Fragment>
          ))}
        </div>
      </div>
      
      {/* Right - Window Controls (Windows style) */}
      <div className="flex items-center">
        <button
          onClick={handleMinimize}
          className="no-drag w-10 h-10 flex items-center justify-center hover:bg-sf-dark-700 transition-colors"
          title="Minimize"
        >
          <Minus className="w-4 h-4 text-sf-text-secondary" />
        </button>
        <button
          onClick={handleToggleMaximize}
          className="no-drag w-10 h-10 flex items-center justify-center hover:bg-sf-dark-700 transition-colors"
          title="Maximize"
        >
          <Square className="w-3 h-3 text-sf-text-secondary" />
        </button>
        <button
          onClick={handleCloseWindow}
          className="no-drag w-10 h-10 flex items-center justify-center hover:bg-red-600 transition-colors"
          title="Close"
        >
          <X className="w-4 h-4 text-sf-text-secondary" />
        </button>
      </div>
    </div>
  )
}

export default TitleBar

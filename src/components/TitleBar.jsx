import { Minus, Square, X, Film, Home, Save } from 'lucide-react'
import useProjectStore from '../stores/projectStore'

const TOP_TABS = [
  { id: 'editor', label: 'Editor' },
  { id: 'generate', label: 'Generate' },
  { id: 'llm-assistant', label: 'LLM Assistant' },
  { id: 'export', label: 'Export' },
]

function TitleBar({
  projectName,
  activeTab = 'editor',
  onTabChange,
  centerInsetLeft = 0,
  centerInsetRight = 0
}) {
  const { closeProject, saveProject } = useProjectStore()
  
  const handleSave = async () => {
    await saveProject()
  }
  
  const handleGoHome = async () => {
    // Save and close current project, return to welcome screen
    await closeProject()
  }

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
    <div className="h-10 bg-sf-dark-900 border-b border-sf-dark-700 flex items-center justify-between px-4 drag-region relative">
      {/* Left - Logo, Home & Project Name */}
      <div className="flex items-center gap-2">
        {/* Home/Projects Button */}
        <button
          onClick={handleGoHome}
          className="no-drag flex items-center gap-1.5 px-2 py-1 hover:bg-sf-dark-700 rounded transition-colors group"
          title="Back to Projects"
        >
          <Home className="w-4 h-4 text-sf-text-muted group-hover:text-sf-accent transition-colors" />
        </button>
        
        <span className="text-sf-dark-600">|</span>
        
        {/* Logo */}
        <div className="flex items-center gap-2">
          <Film className="w-5 h-5 text-sf-accent" />
          <span className="font-semibold text-sf-text-primary">StoryFlow</span>
        </div>
        
        <span className="text-sf-dark-600">|</span>
        
        {/* Project Name */}
        <span className="text-sf-text-secondary text-sm">{projectName}</span>
        
        {/* Save Button */}
        <button
          onClick={handleSave}
          className="no-drag ml-2 p-1 hover:bg-sf-dark-700 rounded transition-colors group"
          title="Save Project (Auto-saves every 30s)"
        >
          <Save className="w-3.5 h-3.5 text-sf-text-muted group-hover:text-sf-accent transition-colors" />
        </button>
      </div>
      
      {/* Center - App mode tabs (aligned to preview area) */}
      <div
        className="absolute inset-y-0 flex items-center justify-center"
        style={{
          left: `${centerInsetLeft}px`,
          right: `${centerInsetRight}px`
        }}
      >
        <div className="no-drag flex items-center gap-1 bg-sf-dark-800/80 border border-sf-dark-700 rounded-full p-0.5">
          {TOP_TABS.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange?.(tab.id)}
                className={`px-3 py-1 text-[11px] rounded-full transition-colors ${
                  isActive
                    ? 'bg-sf-accent text-white'
                    : 'text-sf-text-muted hover:text-sf-text-primary hover:bg-sf-dark-700'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
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

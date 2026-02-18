import { useState, useCallback, useEffect } from 'react'
import TitleBar from './components/TitleBar'
import ExportPanel from './components/ExportPanel'
import GenerateWorkspace from './components/GenerateWorkspace'
import LLMAssistantWorkspace from './components/LLMAssistantWorkspace'
import StockPanel from './components/StockPanel'
import LeftPanel from './components/LeftPanel'
import PreviewPanel from './components/PreviewPanel'
import Timeline from './components/Timeline'
import DopeSheet from './components/DopeSheet'
import TransportControls from './components/TransportControls'
import InspectorPanel from './components/InspectorPanel'
import ResizeHandle from './components/ResizeHandle'
import AudioGenerateModal from './components/AudioGenerateModal'
import SettingsModal from './components/SettingsModal'
import WelcomeScreen from './components/WelcomeScreen'
import BottomBar from './components/BottomBar'
import useProjectStore from './stores/projectStore'

function App() {
  const [audioModalOpen, setAudioModalOpen] = useState(false)
  const [audioModalType, setAudioModalType] = useState('music')
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState({ type: 'shot', id: '2.1' })
  const [mainTab, setMainTab] = useState('editor')
  const [bottomEditorView, setBottomEditorView] = useState('timeline')
  
  // Left panel state
  const [leftPanelExpanded, setLeftPanelExpanded] = useState(true)
  const [leftPanelTab, setLeftPanelTab] = useState('assets')
  const [leftPanelFullHeight, setLeftPanelFullHeight] = useState(false) // Resolve-style full height mode
  
  // Right panel (Inspector) state
  const [inspectorExpanded, setInspectorExpanded] = useState(true)
  
  // Panel sizes (in pixels)
  const [leftPanelWidth, setLeftPanelWidth] = useState(280) // Content panel width (icon bar is 48px additional)
  const [inspectorWidth, setInspectorWidth] = useState(256) // Content panel width (icon bar is 48px additional)
  const [timelineHeight, setTimelineHeight] = useState(320) // Default: enough room for track headers; persisted in localStorage

  // Min/max constraints
  const ICON_BAR_WIDTH = 48 // Fixed icon toolbar width
  const MIN_LEFT_PANEL = 200 // Content panel min
  const MAX_LEFT_PANEL = 450 // Content panel max
  const MIN_INSPECTOR = 200 // Content panel min
  const MAX_INSPECTOR = 400 // Content panel max
  const MIN_TIMELINE = 180 // Accounts for transport controls (40px) + minimum timeline
  const MAX_TIMELINE = 450

  const LAYOUT_STORAGE_KEY = 'comfystudio-editor-layout'
  const SHOW_COMFYUI_TAB_KEY = 'comfystudio-show-comfyui-tab'

  const [showComfyUiTab, setShowComfyUiTab] = useState(() => {
    try {
      return localStorage.getItem(SHOW_COMFYUI_TAB_KEY) !== 'false'
    } catch {
      return true
    }
  })

  useEffect(() => {
    const handler = (e) => setShowComfyUiTab(e.detail === true)
    window.addEventListener('comfystudio-show-comfyui-tab-changed', handler)
    return () => window.removeEventListener('comfystudio-show-comfyui-tab-changed', handler)
  }, [])
  useEffect(() => {
    if (!showComfyUiTab && mainTab === 'comfyui') setMainTab('editor')
  }, [showComfyUiTab, mainTab])

  // When user sends timeline frame to Generate (right-click preview → Extend with AI / Starting keyframe for AI)
  useEffect(() => {
    const handler = () => setMainTab('generate')
    window.addEventListener('comfystudio-open-generate-with-frame', handler)
    return () => window.removeEventListener('comfystudio-open-generate-with-frame', handler)
  }, [])

  // Load persisted layout on mount (single read)
  const [layoutLoaded, setLayoutLoaded] = useState(false)
  useEffect(() => {
    if (layoutLoaded) return
    try {
      const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
      if (raw) {
        const saved = JSON.parse(raw)
        if (typeof saved.timelineHeight === 'number' && saved.timelineHeight >= MIN_TIMELINE && saved.timelineHeight <= MAX_TIMELINE) {
          setTimelineHeight(saved.timelineHeight)
        }
        if (typeof saved.leftPanelWidth === 'number' && saved.leftPanelWidth >= MIN_LEFT_PANEL && saved.leftPanelWidth <= MAX_LEFT_PANEL) {
          setLeftPanelWidth(saved.leftPanelWidth)
        }
        if (typeof saved.inspectorWidth === 'number' && saved.inspectorWidth >= MIN_INSPECTOR && saved.inspectorWidth <= MAX_INSPECTOR) {
          setInspectorWidth(saved.inspectorWidth)
        }
        if (typeof saved.leftPanelExpanded === 'boolean') setLeftPanelExpanded(saved.leftPanelExpanded)
        if (typeof saved.inspectorExpanded === 'boolean') setInspectorExpanded(saved.inspectorExpanded)
      }
    } catch (_) { /* ignore */ }
    setLayoutLoaded(true)
  }, [layoutLoaded])

  const persistLayout = useCallback((updates) => {
    try {
      const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
      const prev = raw ? JSON.parse(raw) : {}
      const next = { ...prev, ...updates }
      localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next))
    } catch (_) { /* ignore */ }
  }, [])

  const isFullScreenTab = mainTab === 'export' || mainTab === 'generate' || mainTab === 'llm-assistant' || mainTab === 'stock' || (showComfyUiTab && mainTab === 'comfyui')
  // Editor layout insets (used for content when on Editor, and always for tab bar so it doesn't shift)
  const editorLeftInset = leftPanelExpanded ? ICON_BAR_WIDTH + leftPanelWidth : ICON_BAR_WIDTH
  const editorRightInset = inspectorExpanded ? ICON_BAR_WIDTH + inspectorWidth : ICON_BAR_WIDTH
  const leftSidebarWidth = isFullScreenTab ? 0 : editorLeftInset
  const rightSidebarWidth = isFullScreenTab ? 0 : editorRightInset
  
  // Project state
  const { currentProject, initialize, isLoading, saveProject, autoSaveEnabled, autoSaveInterval } = useProjectStore()
  
  // Initialize project store on mount
  useEffect(() => {
    initialize()
  }, [initialize])
  
  // Auto-save functionality
  useEffect(() => {
    if (!currentProject || !autoSaveEnabled) return
    
    const autoSaveTimer = setInterval(() => {
      saveProject()
      console.log('Auto-saved project')
    }, autoSaveInterval)
    
    return () => clearInterval(autoSaveTimer)
  }, [currentProject, autoSaveEnabled, autoSaveInterval, saveProject])
  
  // Save on window close/refresh
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (currentProject) {
        saveProject()
      }
    }
    
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [currentProject, saveProject])

  // Resize handlers
  const handleLeftPanelResize = useCallback((clientX) => {
    const contentWidth = clientX - ICON_BAR_WIDTH
    const newWidth = Math.min(MAX_LEFT_PANEL, Math.max(MIN_LEFT_PANEL, contentWidth))
    setLeftPanelWidth(newWidth)
    persistLayout({ leftPanelWidth: newWidth })
  }, [persistLayout])

  const handleInspectorResize = useCallback((clientX) => {
    const contentWidth = window.innerWidth - clientX - ICON_BAR_WIDTH
    const newWidth = Math.min(MAX_INSPECTOR, Math.max(MIN_INSPECTOR, contentWidth))
    setInspectorWidth(newWidth)
    persistLayout({ inspectorWidth: newWidth })
  }, [persistLayout])

  const handleTimelineResize = useCallback((clientY) => {
    const newHeight = Math.min(MAX_TIMELINE, Math.max(MIN_TIMELINE, window.innerHeight - clientY))
    setTimelineHeight(newHeight)
    persistLayout({ timelineHeight: newHeight })
  }, [persistLayout])

  const handleToggleLeftPanelExpanded = useCallback(() => {
    setLeftPanelExpanded(prev => {
      const next = !prev
      persistLayout({ leftPanelExpanded: next })
      return next
    })
  }, [persistLayout])

  const handleToggleInspectorExpanded = useCallback(() => {
    setInspectorExpanded(prev => {
      const next = !prev
      persistLayout({ inspectorExpanded: next })
      return next
    })
  }, [persistLayout])

  const openAudioModal = (type = 'music') => {
    setAudioModalType(type)
    setAudioModalOpen(true)
  }

  // Show welcome screen if no project is open
  if (!currentProject) {
    return <WelcomeScreen />
  }

  return (
    <div className="h-screen flex flex-col bg-sf-dark-950 no-select">
      {/* Title Bar */}
      <TitleBar 
        projectName={currentProject?.name || 'Untitled'} 
        activeTab={mainTab}
        onTabChange={setMainTab}
        centerInsetLeft={editorLeftInset}
        centerInsetRight={editorRightInset}
        showComfyUiTab={showComfyUiTab}
      />
      
      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* ComfyUI tab – only when enabled in settings; kept mounted when visible so iframe does not reload */}
        {showComfyUiTab && (
          <div
            className="flex-1 flex flex-col min-h-0 bg-sf-dark-950"
            style={{ display: mainTab === 'comfyui' ? 'flex' : 'none' }}
          >
            <iframe
              src="http://127.0.0.1:8188"
              title="ComfyUI"
              className="flex-1 w-full min-h-0 border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        )}
        {mainTab === 'export' ? (
          <ExportPanel />
        ) : mainTab === 'stock' ? (
          <StockPanel />
        ) : mainTab === 'generate' ? (
          <GenerateWorkspace />
        ) : mainTab === 'llm-assistant' ? (
          <LLMAssistantWorkspace />
        ) : mainTab === 'comfyui' ? null : (
          <>
            {/* Left Panel - Full Height Mode (spans entire left side) */}
            {leftPanelFullHeight && (
              <>
                <div 
                  style={{ width: leftPanelExpanded ? ICON_BAR_WIDTH + leftPanelWidth : ICON_BAR_WIDTH }} 
                  className="flex-shrink-0 transition-[width] duration-200 ease-out h-full"
                >
                  <LeftPanel 
                    isExpanded={leftPanelExpanded}
                    onToggleExpanded={handleToggleLeftPanelExpanded}
                    activeTab={leftPanelTab}
                    onTabChange={setLeftPanelTab}
                    isFullHeight={true}
                    onToggleFullHeight={() => setLeftPanelFullHeight(false)}
                    onSettingsClick={() => setSettingsModalOpen(true)}
                  />
                </div>
                {/* Resize Handle for full-height left panel */}
                {leftPanelExpanded && (
                  <ResizeHandle 
                    direction="horizontal" 
                    onResize={handleLeftPanelResize}
                  />
                )}
              </>
            )}
            
            {/* Right Side Content (Preview + Inspector + Timeline) */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Upper Content Area - Preview + Inspector */}
              <div className="flex-1 flex overflow-hidden min-h-0">
                {/* Left Panel - Normal Mode (only in upper area) */}
                {!leftPanelFullHeight && (
                  <>
                    <div 
                      style={{ width: leftPanelExpanded ? ICON_BAR_WIDTH + leftPanelWidth : ICON_BAR_WIDTH }} 
                      className="flex-shrink-0 transition-[width] duration-200 ease-out"
                    >
                      <LeftPanel 
                        isExpanded={leftPanelExpanded}
                        onToggleExpanded={handleToggleLeftPanelExpanded}
                        activeTab={leftPanelTab}
                        onTabChange={setLeftPanelTab}
                        isFullHeight={false}
                        onToggleFullHeight={() => setLeftPanelFullHeight(true)}
                        onSettingsClick={() => setSettingsModalOpen(true)}
                      />
                    </div>
                    {/* Resize Handle - Left Panel (only when expanded) */}
                    {leftPanelExpanded && (
                      <ResizeHandle 
                        direction="horizontal" 
                        onResize={handleLeftPanelResize}
                      />
                    )}
                  </>
                )}
                
                {/* Center - Preview */}
                <div className="flex-1 min-w-0">
                  <PreviewPanel />
                </div>
                
                {/* Resize Handle - Inspector (only when expanded) */}
                {inspectorExpanded && (
                  <ResizeHandle 
                    direction="horizontal" 
                    onResize={handleInspectorResize}
                  />
                )}
                
                {/* Right Sidebar - Inspector with Icon Toolbar */}
                <div 
                  style={{ width: inspectorExpanded ? inspectorWidth + ICON_BAR_WIDTH : ICON_BAR_WIDTH }} 
                  className="flex-shrink-0 transition-[width] duration-200 ease-out"
                >
                  <InspectorPanel 
                    selectedItem={selectedItem}
                    isExpanded={inspectorExpanded}
                    onToggleExpanded={handleToggleInspectorExpanded}
                  />
                </div>
              </div>
              
              {/* Resize Handle - Timeline */}
              <ResizeHandle 
                direction="vertical" 
                onResize={handleTimelineResize}
              />
              
              {/* Bottom Section - Transport (centered to viewer) + Timeline */}
              <div style={{ height: timelineHeight }} className="flex-shrink-0 w-full flex flex-col min-h-0">
                {/* Transport row - same columns as Preview row so play button is centered under viewer */}
                <div className="flex-shrink-0 w-full flex min-h-0">
                  {!leftPanelFullHeight && (
                    <div
                      style={{ width: leftPanelExpanded ? ICON_BAR_WIDTH + leftPanelWidth : ICON_BAR_WIDTH }}
                      className="flex-shrink-0 transition-[width] duration-200 ease-out"
                      aria-hidden
                    />
                  )}
                  <div className="flex-1 min-w-0 flex items-center justify-center">
                    <TransportControls />
                  </div>
                  <div
                    style={{ width: inspectorExpanded ? inspectorWidth + ICON_BAR_WIDTH : ICON_BAR_WIDTH }}
                    className="flex-shrink-0 transition-[width] duration-200 ease-out"
                    aria-hidden
                  />
                </div>
                {/* Bottom editor view switcher */}
                <div className="flex-shrink-0 h-7 px-2 bg-sf-dark-900 border-y border-sf-dark-700 flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setBottomEditorView('timeline')}
                      className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                        bottomEditorView === 'timeline'
                          ? 'bg-sf-accent/20 text-sf-accent border border-sf-accent/40'
                          : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'
                      }`}
                      title="Clip and track editing view"
                    >
                      Timeline
                    </button>
                    <button
                      onClick={() => setBottomEditorView('dopesheet')}
                      className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                        bottomEditorView === 'dopesheet'
                          ? 'bg-sf-accent/20 text-sf-accent border border-sf-accent/40'
                          : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600'
                      }`}
                      title="Property keyframe editing view"
                    >
                      Dope Sheet
                    </button>
                  </div>
                  <span className="text-[10px] text-sf-text-muted">
                    {bottomEditorView === 'timeline' ? 'Clip edit mode' : 'Keyframe edit mode'}
                  </span>
                </div>
                {/* Selected bottom editor view - takes remaining height */}
                <div className="flex-1 min-h-0">
                  {bottomEditorView === 'timeline' ? (
                    <Timeline onOpenAudioGenerate={openAudioModal} />
                  ) : (
                    <DopeSheet />
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      
      {/* Bottom bar: settings menu + undo/redo */}
      <BottomBar
        projectName={currentProject?.name}
        onOpenSettings={() => {
          setMainTab('editor')
          setSettingsModalOpen(true)
        }}
      />

      {/* Audio Generate Modal */}
      <AudioGenerateModal 
        isOpen={audioModalOpen}
        onClose={() => setAudioModalOpen(false)}
        initialType={audioModalType}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
      />
    </div>
  )
}

export default App

import { useState, useCallback, useEffect } from 'react'
import TitleBar from './components/TitleBar'
import ExportPanel from './components/ExportPanel'
import GenerateWorkspace from './components/GenerateWorkspace'
import LLMAssistantWorkspace from './components/LLMAssistantWorkspace'
import LeftPanel from './components/LeftPanel'
import PreviewPanel from './components/PreviewPanel'
import Timeline from './components/Timeline'
import TransportControls from './components/TransportControls'
import InspectorPanel from './components/InspectorPanel'
import ResizeHandle from './components/ResizeHandle'
import AudioGenerateModal from './components/AudioGenerateModal'
import WelcomeScreen from './components/WelcomeScreen'
import useProjectStore from './stores/projectStore'

function App() {
  const [audioModalOpen, setAudioModalOpen] = useState(false)
  const [audioModalType, setAudioModalType] = useState('music')
  const [selectedItem, setSelectedItem] = useState({ type: 'shot', id: '2.1' })
  const [mainTab, setMainTab] = useState('editor')
  
  // Left panel state
  const [leftPanelExpanded, setLeftPanelExpanded] = useState(true)
  const [leftPanelTab, setLeftPanelTab] = useState('assets')
  const [leftPanelFullHeight, setLeftPanelFullHeight] = useState(false) // Resolve-style full height mode
  
  // Right panel (Inspector) state
  const [inspectorExpanded, setInspectorExpanded] = useState(true)
  
  // Panel sizes (in pixels)
  const [leftPanelWidth, setLeftPanelWidth] = useState(280) // Content panel width (icon bar is 48px additional)
  const [inspectorWidth, setInspectorWidth] = useState(256) // Content panel width (icon bar is 48px additional)
  const [timelineHeight, setTimelineHeight] = useState(240) // Includes transport controls + timeline

  // Min/max constraints
  const ICON_BAR_WIDTH = 48 // Fixed icon toolbar width
  const MIN_LEFT_PANEL = 200 // Content panel min
  const MAX_LEFT_PANEL = 450 // Content panel max
  const MIN_INSPECTOR = 200 // Content panel min
  const MAX_INSPECTOR = 400 // Content panel max
  const MIN_TIMELINE = 180 // Accounts for transport controls (40px) + minimum timeline
  const MAX_TIMELINE = 450

  const isFullScreenTab = mainTab === 'export' || mainTab === 'generate' || mainTab === 'llm-assistant'
  const leftSidebarWidth = isFullScreenTab
    ? 0
    : (leftPanelExpanded ? ICON_BAR_WIDTH + leftPanelWidth : ICON_BAR_WIDTH)
  const rightSidebarWidth = isFullScreenTab
    ? 0
    : (inspectorExpanded ? ICON_BAR_WIDTH + inspectorWidth : ICON_BAR_WIDTH)
  
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
    // Account for the icon bar width when calculating content panel width
    const contentWidth = clientX - ICON_BAR_WIDTH
    const newWidth = Math.min(MAX_LEFT_PANEL, Math.max(MIN_LEFT_PANEL, contentWidth))
    setLeftPanelWidth(newWidth)
  }, [])

  const handleInspectorResize = useCallback((clientX) => {
    // Account for the icon bar width when calculating content panel width
    const contentWidth = window.innerWidth - clientX - ICON_BAR_WIDTH
    const newWidth = Math.min(MAX_INSPECTOR, Math.max(MIN_INSPECTOR, contentWidth))
    setInspectorWidth(newWidth)
  }, [])

  const handleTimelineResize = useCallback((clientY) => {
    // Calculate from bottom - timeline is at the bottom of the viewport
    const newHeight = Math.min(MAX_TIMELINE, Math.max(MIN_TIMELINE, window.innerHeight - clientY))
    setTimelineHeight(newHeight)
  }, [])

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
        centerInsetLeft={leftSidebarWidth}
        centerInsetRight={rightSidebarWidth}
      />
      
      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {mainTab === 'export' ? (
          <ExportPanel />
        ) : mainTab === 'generate' ? (
          <GenerateWorkspace />
        ) : mainTab === 'llm-assistant' ? (
          <LLMAssistantWorkspace />
        ) : (
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
                    onToggleExpanded={() => setLeftPanelExpanded(!leftPanelExpanded)}
                    activeTab={leftPanelTab}
                    onTabChange={setLeftPanelTab}
                    isFullHeight={true}
                    onToggleFullHeight={() => setLeftPanelFullHeight(false)}
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
                        onToggleExpanded={() => setLeftPanelExpanded(!leftPanelExpanded)}
                        activeTab={leftPanelTab}
                        onTabChange={setLeftPanelTab}
                        isFullHeight={false}
                        onToggleFullHeight={() => setLeftPanelFullHeight(true)}
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
                    onToggleExpanded={() => setInspectorExpanded(!inspectorExpanded)}
                  />
                </div>
              </div>
              
              {/* Resize Handle - Timeline */}
              <ResizeHandle 
                direction="vertical" 
                onResize={handleTimelineResize}
              />
              
              {/* Bottom Section - Transport Controls + Timeline */}
              <div style={{ height: timelineHeight }} className="flex-shrink-0 w-full flex flex-col">
                {/* Transport Controls - Anchored to top of timeline section */}
                <TransportControls />
                {/* Timeline - Takes remaining space */}
                <div className="flex-1 min-h-0">
                  <Timeline onOpenAudioGenerate={openAudioModal} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      
      {/* Audio Generate Modal */}
      <AudioGenerateModal 
        isOpen={audioModalOpen}
        onClose={() => setAudioModalOpen(false)}
        initialType={audioModalType}
      />
    </div>
  )
}

export default App

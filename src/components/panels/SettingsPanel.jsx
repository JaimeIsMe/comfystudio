import { Server, FolderOpen, Palette, Monitor, Save, ChevronDown, ChevronRight, HardDrive, Film } from 'lucide-react'
import { useState, useEffect } from 'react'
import useProjectStore, { RESOLUTION_PRESETS, FPS_PRESETS } from '../../stores/projectStore'
import { getPexelsApiKey, setPexelsApiKey } from '../../services/pexelsSettings'
import {
  DEFAULT_COMFY_PORT,
  checkLocalComfyConnection,
  getLocalComfyConnectionSync,
  hydrateLocalComfyConnection,
  parseLocalComfyPortInput,
  saveLocalComfyConnectionPort,
} from '../../services/localComfyConnection'

function SettingsPanel() {
  const initialComfyConnection = getLocalComfyConnectionSync()
  const [comfyPortInput, setComfyPortInput] = useState(String(initialComfyConnection.port || DEFAULT_COMFY_PORT))
  const [comfyConnectionState, setComfyConnectionState] = useState({
    status: 'idle',
    message: `Local endpoint: ${initialComfyConnection.httpBase}`,
  })
  const [outputPath, setOutputPath] = useState('C:\\Users\\...\\ComfyStudio\\outputs')
  const [workflowPath, setWorkflowPath] = useState('C:\\Users\\...\\ComfyUI\\workflow_API')
  const [theme, setTheme] = useState('dark')
  const [pexelsApiKey, setPexelsApiKeyLocal] = useState('')
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [expandedSections, setExpandedSections] = useState(['connection', 'storage', 'stock'])

  const SHOW_COMFYUI_TAB_KEY = 'comfystudio-show-comfyui-tab'
  const [showComfyUiTab, setShowComfyUiTab] = useState(() => {
    try {
      const stored = localStorage.getItem(SHOW_COMFYUI_TAB_KEY)
      if (stored === null) return false
      return stored === 'true'
    } catch {
      return false
    }
  })
  const handleToggleShowComfyUiTab = () => {
    const next = !showComfyUiTab
    setShowComfyUiTab(next)
    try {
      localStorage.setItem(SHOW_COMFYUI_TAB_KEY, String(next))
      window.dispatchEvent(new CustomEvent('comfystudio-show-comfyui-tab-changed', { detail: next }))
    } catch (_) {}
  }
  
  const { 
    defaultProjectsLocation, 
    selectDefaultProjectsLocation,
    autoSaveEnabled,
    setAutoSaveEnabled,
    currentProject,
    closeProject,
  } = useProjectStore()

  useEffect(() => {
    getPexelsApiKey().then(key => setPexelsApiKeyLocal(key || ''))
    hydrateLocalComfyConnection().then((connection) => {
      setComfyPortInput(String(connection.port || DEFAULT_COMFY_PORT))
      setComfyConnectionState({
        status: 'idle',
        message: `Local endpoint: ${connection.httpBase}`,
      })
    }).catch(() => {
      setComfyConnectionState({
        status: 'error',
        message: `Could not load local ComfyUI port. Using ${DEFAULT_COMFY_PORT}.`,
      })
    })
  }, [])

  const toggleSection = (section) => {
    setExpandedSections(prev =>
      prev.includes(section) ? prev.filter(s => s !== section) : [...prev, section]
    )
  }

  const handleSavePexelsKey = () => {
    setPexelsApiKey(pexelsApiKey.trim()).catch(console.error)
  }

  const handleSaveComfyConnection = async () => {
    const result = await saveLocalComfyConnectionPort(comfyPortInput)
    if (!result.success) {
      setComfyConnectionState({
        status: 'error',
        message: result.error || 'Invalid local ComfyUI configuration.',
      })
      return false
    }
    setComfyPortInput(String(result.config.port))
    setComfyConnectionState({
      status: 'idle',
      message: `Saved local endpoint: ${result.config.httpBase}`,
    })
    return true
  }

  const handleTestComfyConnection = async () => {
    const parsed = parseLocalComfyPortInput(comfyPortInput)
    if (!parsed.success) {
      setComfyConnectionState({
        status: 'error',
        message: parsed.error || 'Invalid local ComfyUI port.',
      })
      return
    }
    setComfyConnectionState({
      status: 'testing',
      message: `Testing localhost:${parsed.port}...`,
    })
    const testResult = await checkLocalComfyConnection({ port: parsed.port })
    if (testResult.ok) {
      setComfyConnectionState({
        status: 'success',
        message: `Connected to ${testResult.httpBase}`,
      })
      return
    }
    setComfyConnectionState({
      status: 'error',
      message: testResult.error || `Could not connect to localhost:${parsed.port}.`,
    })
  }

  const handleResetComfyConnection = async () => {
    setComfyPortInput(String(DEFAULT_COMFY_PORT))
    const result = await saveLocalComfyConnectionPort(DEFAULT_COMFY_PORT)
    if (!result.success) {
      setComfyConnectionState({
        status: 'error',
        message: result.error || 'Could not reset local ComfyUI port.',
      })
      return
    }
    setComfyConnectionState({
      status: 'idle',
      message: `Reset to local endpoint: ${result.config.httpBase}`,
    })
  }

  const handleSaveAllSettings = async () => {
    await setPexelsApiKey(pexelsApiKey.trim())
    const connectionSaved = await handleSaveComfyConnection()
    if (connectionSaved) {
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 2000)
    } else {
      setSettingsSaved(false)
    }
  }

  const Section = ({ id, icon: Icon, title, children }) => {
    const isExpanded = expandedSections.includes(id)
    return (
      <div className="border-b border-sf-dark-700 last:border-b-0">
        <button
          onClick={() => toggleSection(id)}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-sf-dark-800 transition-colors"
        >
          {isExpanded ? <ChevronDown className="w-3 h-3 text-sf-text-muted" /> : <ChevronRight className="w-3 h-3 text-sf-text-muted" />}
          <Icon className="w-3.5 h-3.5 text-sf-text-muted" />
          <span className="text-xs font-medium text-sf-text-primary">{title}</span>
        </button>
        {isExpanded && (
          <div className="px-3 pb-3">
            {children}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-2 border-b border-sf-dark-700">
        <span className="text-xs font-medium text-sf-text-primary">Settings</span>
      </div>

      {/* Settings Sections */}
      <div className="flex-1 overflow-y-auto">
        {/* Storage/Projects */}
        <Section id="storage" icon={HardDrive} title="Projects & Storage">
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-sf-text-muted mb-1">Projects Location</label>
              <div className="flex gap-1">
                <div className="flex-1 min-w-0 bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-[10px] text-sf-text-primary truncate">
                  {defaultProjectsLocation || 'Not set'}
                </div>
                <button 
                  onClick={selectDefaultProjectsLocation}
                  className="px-2 py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-[10px] text-sf-text-secondary transition-colors flex-shrink-0"
                >
                  Change
                </button>
              </div>
              <p className="text-[9px] text-sf-text-muted mt-1">
                Where new projects are created
              </p>
            </div>
            
            {currentProject && (
              <div>
                <label className="block text-[10px] text-sf-text-muted mb-1">Current Project</label>
                <div className="bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5">
                  <p className="text-[11px] text-sf-text-primary truncate">{currentProject.name}</p>
                  <p className="text-[9px] text-sf-text-muted mt-0.5">
                    {currentProject.settings?.width}x{currentProject.settings?.height} @ {currentProject.settings?.fps}fps
                  </p>
                </div>
                <button
                  onClick={closeProject}
                  className="mt-2 w-full px-2 py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-[10px] text-sf-text-secondary transition-colors"
                >
                  Close Project
                </button>
              </div>
            )}
            
            <div className="flex items-center justify-between">
              <div>
                <label className="text-[11px] text-sf-text-primary">Auto-save</label>
                <p className="text-[9px] text-sf-text-muted">Save every 30 sec</p>
              </div>
              <button
                onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
                className={`w-8 h-4 rounded-full transition-colors ${autoSaveEnabled ? 'bg-sf-accent' : 'bg-sf-dark-600'}`}
              >
                <div className={`w-3 h-3 bg-white rounded-full transition-transform ${autoSaveEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>
        </Section>

        {/* Stock (Pexels) */}
        <Section id="stock" icon={Film} title="Stock (Pexels)">
          <div className="space-y-2">
            <div>
              <label className="block text-[10px] text-sf-text-muted mb-1">API Key</label>
              <input
                type="password"
                value={pexelsApiKey}
                onChange={(e) => setPexelsApiKeyLocal(e.target.value)}
                onBlur={handleSavePexelsKey}
                placeholder="Your Pexels API key"
                className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-[11px] text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent"
              />
              <p className="text-[9px] text-sf-text-muted mt-1">
                Free at{' '}
                <a href="https://www.pexels.com/api/" target="_blank" rel="noopener noreferrer" className="text-sf-accent hover:underline">
                  pexels.com/api
                </a>
                . Used by the Stock tab to search photos and videos.
              </p>
            </div>
          </div>
        </Section>

        {/* ComfyUI Connection */}
        <Section id="connection" icon={Server} title="ComfyUI Connection">
          <div className="space-y-2">
            <div>
              <label className="block text-[10px] text-sf-text-muted mb-1">Local ComfyUI Port</label>
              <input
                type="number"
                min={1}
                max={65535}
                step={1}
                value={comfyPortInput}
                onChange={(e) => setComfyPortInput(e.target.value)}
                onBlur={() => { void handleSaveComfyConnection() }}
                placeholder={String(DEFAULT_COMFY_PORT)}
                className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-[11px] text-sf-text-primary focus:outline-none focus:border-sf-accent"
              />
              <p className="text-[9px] text-sf-text-muted mt-1">
                Local-only mode. Remote/LAN ComfyUI is disabled in this build.
              </p>
            </div>
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${
                  comfyConnectionState.status === 'success'
                    ? 'bg-sf-success'
                    : comfyConnectionState.status === 'error'
                      ? 'bg-red-500'
                      : comfyConnectionState.status === 'testing'
                        ? 'bg-yellow-400 animate-pulse'
                        : 'bg-sf-dark-500'
                }`} />
                <span className="text-[10px] text-sf-text-muted">{comfyConnectionState.message}</span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => { void handleResetComfyConnection() }}
                  className="px-2 py-1 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-[10px] text-sf-text-secondary transition-colors"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => { void handleTestComfyConnection() }}
                  className="px-2 py-1 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-[10px] text-sf-text-secondary transition-colors"
                >
                  Test
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-sf-dark-700 mt-2">
              <div>
                <label className="text-[11px] text-sf-text-primary">Show ComfyUI tab</label>
                <p className="text-[9px] text-sf-text-muted">For advanced users. When off, the ComfyUI tab is hidden from the app bar.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showComfyUiTab}
                onClick={handleToggleShowComfyUiTab}
                className={`w-9 h-5 rounded-full transition-colors flex-shrink-0 relative ${showComfyUiTab ? 'bg-sf-accent' : 'bg-sf-dark-600'}`}
                title={showComfyUiTab ? 'Hide ComfyUI tab' : 'Show ComfyUI tab'}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${showComfyUiTab ? 'left-[calc(100%-1.25rem)]' : 'left-0.5'}`}
                  aria-hidden
                />
              </button>
            </div>
          </div>
        </Section>

        {/* File Paths */}
        <Section id="paths" icon={FolderOpen} title="File Paths">
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-sf-text-muted mb-1">Output Directory</label>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={outputPath}
                  onChange={(e) => setOutputPath(e.target.value)}
                  className="flex-1 min-w-0 bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-[10px] text-sf-text-primary focus:outline-none focus:border-sf-accent truncate"
                />
                <button className="px-2 py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-[10px] text-sf-text-secondary transition-colors flex-shrink-0">
                  ...
                </button>
              </div>
            </div>
            <div>
              <label className="block text-[10px] text-sf-text-muted mb-1">Workflows Directory</label>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={workflowPath}
                  onChange={(e) => setWorkflowPath(e.target.value)}
                  className="flex-1 min-w-0 bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-[10px] text-sf-text-primary focus:outline-none focus:border-sf-accent truncate"
                />
                <button className="px-2 py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-[10px] text-sf-text-secondary transition-colors flex-shrink-0">
                  ...
                </button>
              </div>
            </div>
          </div>
        </Section>

        {/* Appearance */}
        <Section id="appearance" icon={Palette} title="Appearance">
          <div>
            <label className="block text-[10px] text-sf-text-muted mb-1">Theme</label>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-[11px] text-sf-text-primary focus:outline-none focus:border-sf-accent"
            >
              <option value="dark">Dark (Default)</option>
              <option value="darker">Darker</option>
              <option value="light">Light</option>
            </select>
          </div>
        </Section>

        {/* Project Defaults */}
        <Section id="project" icon={Monitor} title="New Project Defaults">
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] text-sf-text-muted mb-1">Default Resolution</label>
              <select className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-[11px] text-sf-text-primary focus:outline-none focus:border-sf-accent">
                {RESOLUTION_PRESETS.map(preset => (
                  <option key={preset.name} value={preset.name}>
                    {preset.name} ({preset.width}x{preset.height})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-sf-text-muted mb-1">Default Frame Rate</label>
              <select className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-2 py-1.5 text-[11px] text-sf-text-primary focus:outline-none focus:border-sf-accent">
                {FPS_PRESETS.map(fps => (
                  <option key={fps.value} value={fps.value}>
                    {fps.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Section>
      </div>

      {/* Save Button */}
      <div className="p-2 border-t border-sf-dark-700">
        <button
          onClick={handleSaveAllSettings}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-sf-accent hover:bg-sf-accent-hover rounded text-xs text-white transition-colors"
        >
          <Save className="w-3.5 h-3.5" />
          {settingsSaved ? 'Saved' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}

export default SettingsPanel

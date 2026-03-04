import { useState, useEffect } from 'react'
import {
  X, Server, FolderOpen, Palette, Monitor, Save,
  HardDrive, Film, ChevronDown, ChevronRight
} from 'lucide-react'
import useProjectStore, { RESOLUTION_PRESETS, FPS_PRESETS } from '../stores/projectStore'
import { getPexelsApiKey, setPexelsApiKey } from '../services/pexelsSettings'
import {
  DEFAULT_COMFY_PORT,
  checkLocalComfyConnection,
  getLocalComfyConnectionSync,
  hydrateLocalComfyConnection,
  parseLocalComfyPortInput,
  saveLocalComfyConnectionPort,
} from '../services/localComfyConnection'
const COMFY_ORG_API_KEY_SETTING_KEY = 'comfyApiKeyComfyOrg'
const COMFY_ORG_API_KEY_LOCAL_KEY = 'comfystudio-comfy-api-key'

function GeneralTab() {
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
  const [comfyOrgApiKey, setComfyOrgApiKey] = useState('')
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
    defaultResolution,
    defaultFps,
    setDefaultProjectSettings,
  } = useProjectStore()

  useEffect(() => {
    getPexelsApiKey().then(key => setPexelsApiKeyLocal(key || ''))
    ;(async () => {
      try {
        let next = ''
        if (window?.electronAPI?.getSetting) {
          next = String(await window.electronAPI.getSetting(COMFY_ORG_API_KEY_SETTING_KEY) || '')
        }
        if (!next && typeof localStorage !== 'undefined') {
          next = String(localStorage.getItem(COMFY_ORG_API_KEY_LOCAL_KEY) || '')
        }
        setComfyOrgApiKey(next)
      } catch {
        setComfyOrgApiKey('')
      }

      try {
        const connection = await hydrateLocalComfyConnection()
        setComfyPortInput(String(connection.port || DEFAULT_COMFY_PORT))
        setComfyConnectionState({
          status: 'idle',
          message: `Local endpoint: ${connection.httpBase}`,
        })
      } catch {
        setComfyConnectionState({
          status: 'error',
          message: `Could not load local ComfyUI port. Using ${DEFAULT_COMFY_PORT}.`,
        })
      }
    })()
  }, [])

  const toggleSection = (section) => {
    setExpandedSections(prev =>
      prev.includes(section) ? prev.filter(s => s !== section) : [...prev, section]
    )
  }

  const handleSavePexelsKey = () => {
    setPexelsApiKey(pexelsApiKey.trim()).catch(console.error)
  }

  const handleSaveComfyOrgApiKey = async () => {
    const normalized = String(comfyOrgApiKey || '').trim()
    try {
      if (window?.electronAPI?.setSetting) {
        await window.electronAPI.setSetting(COMFY_ORG_API_KEY_SETTING_KEY, normalized)
      }
      if (typeof localStorage !== 'undefined') {
        if (normalized) {
          localStorage.setItem(COMFY_ORG_API_KEY_LOCAL_KEY, normalized)
        } else {
          localStorage.removeItem(COMFY_ORG_API_KEY_LOCAL_KEY)
        }
      }
    } catch (err) {
      console.error('Failed to save Comfy account API key:', err)
    }
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
    await handleSaveComfyOrgApiKey()
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
          className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-sf-dark-800 transition-colors text-left"
        >
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-sf-text-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-sf-text-muted" />}
          <Icon className="w-4 h-4 text-sf-text-muted" />
          <span className="text-sm font-medium text-sf-text-primary">{title}</span>
        </button>
        {isExpanded && (
          <div className="px-3 pb-4">
            {children}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <Section id="storage" icon={HardDrive} title="Projects & Storage">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-sf-text-muted mb-1">Projects Location</label>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0 bg-sf-dark-800 border border-sf-dark-600 rounded px-3 py-2 text-xs text-sf-text-primary truncate">
                {defaultProjectsLocation || 'Not set'}
              </div>
              <button
                onClick={selectDefaultProjectsLocation}
                className="px-3 py-2 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-xs text-sf-text-secondary transition-colors flex-shrink-0"
              >
                Change
              </button>
            </div>
            <p className="text-[10px] text-sf-text-muted mt-1">Where new projects are created</p>
          </div>

          {currentProject && (
            <div>
              <label className="block text-xs text-sf-text-muted mb-1">Current Project</label>
              <div className="bg-sf-dark-800 border border-sf-dark-600 rounded px-3 py-2">
                <p className="text-sm text-sf-text-primary truncate">{currentProject.name}</p>
                <p className="text-[10px] text-sf-text-muted mt-0.5">
                  {currentProject.settings?.width}x{currentProject.settings?.height} @ {currentProject.settings?.fps}fps
                </p>
              </div>
              <button
                onClick={closeProject}
                className="mt-2 w-full px-3 py-2 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-xs text-sf-text-secondary transition-colors"
              >
                Close Project
              </button>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-sf-text-primary">Auto-save</label>
              <p className="text-[10px] text-sf-text-muted">Save every 30 sec</p>
            </div>
            <button
              onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
              className={`w-10 h-5 rounded-full transition-colors ${autoSaveEnabled ? 'bg-sf-accent' : 'bg-sf-dark-600'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full transition-transform ${autoSaveEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>
      </Section>

      <Section id="stock" icon={Film} title="Stock (Pexels)">
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-sf-text-muted mb-1">API Key</label>
            <input
              type="password"
              value={pexelsApiKey}
              onChange={(e) => setPexelsApiKeyLocal(e.target.value)}
              onBlur={handleSavePexelsKey}
              placeholder="Your Pexels API key"
              className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-3 py-2 text-sm text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent"
            />
            <p className="text-[10px] text-sf-text-muted mt-1">
              Free at{' '}
              <a href="https://www.pexels.com/api/" target="_blank" rel="noopener noreferrer" className="text-sf-accent hover:underline">
                pexels.com/api
              </a>
              . Used by the Stock tab to search photos and videos.
            </p>
          </div>
        </div>
      </Section>

      <Section id="connection" icon={Server} title="ComfyUI Connection">
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-sf-text-muted mb-1">Local ComfyUI Port</label>
            <input
              type="number"
              min={1}
              max={65535}
              step={1}
              value={comfyPortInput}
              onChange={(e) => setComfyPortInput(e.target.value)}
              onBlur={() => { void handleSaveComfyConnection() }}
              placeholder={String(DEFAULT_COMFY_PORT)}
              className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-3 py-2 text-sm text-sf-text-primary focus:outline-none focus:border-sf-accent"
            />
            <p className="text-[10px] text-sf-text-muted mt-1">
              Local-only mode. Remote/LAN ComfyUI is disabled in this build.
            </p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${
                comfyConnectionState.status === 'success'
                  ? 'bg-sf-success'
                  : comfyConnectionState.status === 'error'
                    ? 'bg-red-500'
                    : comfyConnectionState.status === 'testing'
                      ? 'bg-yellow-400 animate-pulse'
                      : 'bg-sf-dark-500'
              }`} />
              <span className="text-xs text-sf-text-muted">{comfyConnectionState.message}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                onClick={() => { void handleResetComfyConnection() }}
                className="px-3 py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-xs text-sf-text-secondary transition-colors"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => { void handleTestComfyConnection() }}
                className="px-3 py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-xs text-sf-text-secondary transition-colors"
              >
                Test
              </button>
            </div>
          </div>
          <div className="pt-2 border-t border-sf-dark-700 mt-2">
            <label className="block text-xs text-sf-text-muted mb-1">Comfy Account API Key (for partner nodes)</label>
            <input
              type="password"
              autoComplete="off"
              value={comfyOrgApiKey}
              onChange={(e) => setComfyOrgApiKey(e.target.value)}
              onBlur={handleSaveComfyOrgApiKey}
              placeholder="comfyui-..."
              className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-3 py-2 text-sm text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent"
            />
            <p className="text-[10px] text-sf-text-muted mt-1">
              Used as <code>extra_data.api_key_comfy_org</code> when queueing prompts so paid API nodes can authenticate in headless/custom frontend flows.
            </p>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-sf-dark-700 mt-2">
            <div>
              <label className="text-sm text-sf-text-primary">Show ComfyUI tab</label>
              <p className="text-[10px] text-sf-text-muted">For advanced users. When off, the ComfyUI tab is hidden from the app bar.</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={showComfyUiTab}
              onClick={handleToggleShowComfyUiTab}
              className={`w-10 h-5 rounded-full transition-colors flex-shrink-0 relative ${showComfyUiTab ? 'bg-sf-accent' : 'bg-sf-dark-600'}`}
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

      <Section id="paths" icon={FolderOpen} title="File Paths">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-sf-text-muted mb-1">Output Directory</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={outputPath}
                onChange={(e) => setOutputPath(e.target.value)}
                className="flex-1 min-w-0 bg-sf-dark-800 border border-sf-dark-600 rounded px-3 py-2 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent truncate"
              />
              <button className="px-3 py-2 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-xs text-sf-text-secondary transition-colors flex-shrink-0">
                ...
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs text-sf-text-muted mb-1">Workflows Directory</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={workflowPath}
                onChange={(e) => setWorkflowPath(e.target.value)}
                className="flex-1 min-w-0 bg-sf-dark-800 border border-sf-dark-600 rounded px-3 py-2 text-xs text-sf-text-primary focus:outline-none focus:border-sf-accent truncate"
              />
              <button className="px-3 py-2 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-xs text-sf-text-secondary transition-colors flex-shrink-0">
                ...
              </button>
            </div>
          </div>
        </div>
      </Section>

      <Section id="appearance" icon={Palette} title="Appearance">
        <div>
          <label className="block text-xs text-sf-text-muted mb-1">Theme</label>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-3 py-2 text-sm text-sf-text-primary focus:outline-none focus:border-sf-accent"
          >
            <option value="dark">Dark (Default)</option>
            <option value="darker">Darker</option>
            <option value="light">Light</option>
          </select>
        </div>
      </Section>

      <Section id="project" icon={Monitor} title="New Project Defaults">
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-sf-text-muted mb-1">Default Resolution</label>
            <select
              value={defaultResolution || 'HD 1080p'}
              onChange={(e) => setDefaultProjectSettings(e.target.value, defaultFps)}
              className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-3 py-2 text-sm text-sf-text-primary focus:outline-none focus:border-sf-accent"
            >
              {RESOLUTION_PRESETS.map(preset => (
                <option key={preset.name} value={preset.name}>
                  {preset.name} ({preset.width}x{preset.height})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-sf-text-muted mb-1">Default Frame Rate</label>
            <select
              value={defaultFps ?? 24}
              onChange={(e) => setDefaultProjectSettings(defaultResolution, Number(e.target.value))}
              className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-3 py-2 text-sm text-sf-text-primary focus:outline-none focus:border-sf-accent"
            >
              {FPS_PRESETS.map(fps => (
                <option key={fps.value} value={fps.value}>
                  {fps.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Section>

      <div className="pt-4 border-t border-sf-dark-700">
        <button
          onClick={handleSaveAllSettings}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-sf-accent hover:bg-sf-accent-hover rounded text-sm text-white transition-colors"
        >
          <Save className="w-4 h-4" />
          {settingsSaved ? 'Saved' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}

export default function SettingsModal({ isOpen, onClose }) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-start justify-center z-50 pt-4 pb-4 px-4"
      onClick={onClose}
    >
      <div
        className="bg-sf-dark-900 border border-sf-dark-600 rounded-xl w-full max-w-2xl max-h-[calc(100vh-2rem)] overflow-hidden shadow-2xl flex flex-col flex-shrink-0"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-sf-dark-700 flex-shrink-0">
          <h2 className="text-lg font-medium text-sf-text-primary">Settings</h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-sf-dark-700 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-sf-text-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          <GeneralTab />
        </div>
      </div>
    </div>
  )
}

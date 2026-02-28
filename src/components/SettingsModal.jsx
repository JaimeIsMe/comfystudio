import { useState, useEffect } from 'react'
import {
  X, Settings, GitBranch, Server, FolderOpen, Palette, Monitor, Save,
  HardDrive, Film, ChevronDown, ChevronRight, Download, Trash2, RefreshCw
} from 'lucide-react'
import useProjectStore, { RESOLUTION_PRESETS, FPS_PRESETS } from '../stores/projectStore'
import { getPexelsApiKey, setPexelsApiKey } from '../services/pexelsSettings'
import useWorkflowsStore from '../stores/workflowsStore'
import {
  BUILTIN_WORKFLOWS,
  AVAILABLE_WORKFLOWS,
  CATEGORY_LABELS as CAT_LABELS,
} from '../config/workflowRegistry'
import { fetchComfyUITemplates } from '../services/comfyuiTemplates'
import { Video, Image as ImageIcon, Music } from 'lucide-react'

const CATEGORY_ICONS = { video: Video, image: ImageIcon, audio: Music }
const COMFY_ORG_API_KEY_SETTING_KEY = 'comfyApiKeyComfyOrg'
const COMFY_ORG_API_KEY_LOCAL_KEY = 'comfystudio-comfy-api-key'

function GeneralTab() {
  const [comfyUrl, setComfyUrl] = useState('http://127.0.0.1:8188')
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
      return localStorage.getItem(SHOW_COMFYUI_TAB_KEY) !== 'false'
    } catch {
      return true
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

  const handleSaveAllSettings = async () => {
    await setPexelsApiKey(pexelsApiKey.trim())
    await handleSaveComfyOrgApiKey()
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 2000)
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
            <label className="block text-xs text-sf-text-muted mb-1">Server URL</label>
            <input
              type="text"
              value={comfyUrl}
              onChange={(e) => setComfyUrl(e.target.value)}
              className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded px-3 py-2 text-sm text-sf-text-primary focus:outline-none focus:border-sf-accent"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 bg-sf-success rounded-full" />
              <span className="text-xs text-sf-text-muted">Connected</span>
            </div>
            <button className="px-3 py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-xs text-sf-text-secondary transition-colors">
              Test
            </button>
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

function WorkflowsTab({
  comfyTemplates,
  comfyLoading,
  comfyError,
  onRefreshComfyTemplates,
}) {
  const { isInstalled, installWorkflow, uninstallWorkflow, isComfyInstalled, installComfyUITemplate, uninstallComfyUITemplate } = useWorkflowsStore()
  const [filterCategory, setFilterCategory] = useState('all')
  const [loadingId, setLoadingId] = useState(null)
  const [error, setError] = useState(null)

  const categories = ['all', 'video', 'image', 'audio']
  const allWorkflows = [...BUILTIN_WORKFLOWS, ...AVAILABLE_WORKFLOWS]
  const filtered = filterCategory === 'all'
    ? allWorkflows
    : allWorkflows.filter(w => w.category === filterCategory)

  const handleInstall = async (wf) => {
    if (isInstalled(wf.id)) return
    setLoadingId(wf.id)
    setError(null)
    try {
      await installWorkflow(wf.id)
    } catch (err) {
      setError(err.message || 'Download failed')
    } finally {
      setLoadingId(null)
    }
  }

  const handleUninstall = async (wf) => {
    if (!isInstalled(wf.id)) return
    const builtinIds = new Set(BUILTIN_WORKFLOWS.map(w => w.id))
    if (builtinIds.has(wf.id)) return
    setLoadingId(wf.id)
    setError(null)
    try {
      await uninstallWorkflow(wf.id)
    } catch (err) {
      setError(err.message || 'Delete failed')
    } finally {
      setLoadingId(null)
    }
  }

  const handleInstallComfy = async (template) => {
    if (isComfyInstalled(template.id)) return
    setLoadingId(template.id)
    setError(null)
    try {
      await installComfyUITemplate(template)
    } catch (err) {
      setError(err.message || 'Download failed')
    } finally {
      setLoadingId(null)
    }
  }

  const handleUninstallComfy = async (template) => {
    if (!isComfyInstalled(template.id)) return
    setLoadingId(template.id)
    setError(null)
    try {
      await uninstallComfyUITemplate(template.id)
    } catch (err) {
      setError(err.message || 'Delete failed')
    } finally {
      setLoadingId(null)
    }
  }

  const builtinIds = new Set(BUILTIN_WORKFLOWS.map(w => w.id))

  return (
    <div className="flex flex-col h-full">
      <p className="text-xs text-sf-text-muted mb-4">
        Manage workflows for the Generate tab. Installed workflows appear in Generate. Download optional workflows to enable them.
      </p>

      {/* Category filter */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setFilterCategory(cat)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              filterCategory === cat
                ? 'bg-sf-accent text-white'
                : 'bg-sf-dark-700 text-sf-text-muted hover:bg-sf-dark-600 hover:text-sf-text-secondary'
            }`}
          >
            {cat === 'all' ? 'All' : CAT_LABELS[cat]}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 bg-red-900/30 border border-red-700/50 rounded text-xs text-red-300">
          {error}
        </div>
      )}

      {/* ComfyStudio workflows */}
      <div className="mb-4">
        <span className="text-[10px] font-medium text-sf-text-muted uppercase tracking-wider">ComfyStudio</span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
        {filtered.map(wf => {
          const installed = isInstalled(wf.id)
          const isBuiltin = builtinIds.has(wf.id)
          const Icon = CATEGORY_ICONS[wf.category] || GitBranch
          const isLoading = loadingId === wf.id

          return (
            <div
              key={wf.id}
              className="flex items-center gap-3 p-3 bg-sf-dark-800 border border-sf-dark-600 rounded-lg hover:border-sf-dark-500 transition-colors"
            >
              <div className="w-9 h-9 rounded-lg bg-sf-dark-700 flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4 text-sf-text-muted" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-sf-text-primary">{wf.label}</span>
                  {installed && (
                    <span className="px-1.5 py-0.5 bg-sf-accent/20 text-sf-accent rounded text-[10px] font-medium">
                      Installed
                    </span>
                  )}
                  {isBuiltin && (
                    <span className="px-1.5 py-0.5 bg-sf-dark-600 text-sf-text-muted rounded text-[10px]">
                      Built-in
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-sf-text-muted mt-0.5 line-clamp-2">{wf.description}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {installed ? (
                  isBuiltin ? (
                    <span className="text-[10px] text-sf-text-muted">installed</span>
                  ) : (
                    <button
                      onClick={() => handleUninstall(wf)}
                      disabled={isLoading}
                      className="flex items-center gap-1 px-2 py-1.5 rounded text-xs text-sf-text-muted hover:bg-sf-dark-600 hover:text-red-300 transition-colors disabled:opacity-50"
                      title="Remove workflow"
                    >
                      {isLoading ? <span className="animate-pulse">...</span> : <Trash2 className="w-3.5 h-3.5" />}
                      <span>Remove</span>
                    </button>
                  )
                ) : (
                  <button
                    onClick={() => handleInstall(wf)}
                    disabled={isLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-sf-accent hover:bg-sf-accent-hover text-white transition-colors disabled:opacity-50"
                    title="Download workflow"
                  >
                    {isLoading ? (
                      <span className="animate-pulse">...</span>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ComfyUI templates (from running ComfyUI instance) */}
      {comfyTemplates.length > 0 && (
        <>
          <div className="mt-6 mb-4 flex items-center justify-between">
            <span className="text-[10px] font-medium text-sf-text-muted uppercase tracking-wider">From ComfyUI</span>
            <button
              onClick={onRefreshComfyTemplates}
              disabled={comfyLoading}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-secondary disabled:opacity-50"
              title="Refresh template list"
            >
              <RefreshCw className={`w-3 h-3 ${comfyLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
          <div className="space-y-2 mb-4">
            {comfyTemplates.map(template => {
              const installed = isComfyInstalled(template.id)
              const isLoading = loadingId === template.id
              return (
                <div
                  key={template.id}
                  className="flex items-center gap-3 p-3 bg-sf-dark-800 border border-sf-dark-600 rounded-lg hover:border-sf-dark-500 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-sf-dark-700 flex items-center justify-center flex-shrink-0">
                    <GitBranch className="w-4 h-4 text-sf-text-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-sf-text-primary">{template.name}</span>
                      {installed && (
                        <span className="px-1.5 py-0.5 bg-sf-accent/20 text-sf-accent rounded text-[10px] font-medium">
                          Installed
                        </span>
                      )}
                      <span className="px-1.5 py-0.5 bg-sf-dark-600 text-sf-text-muted rounded text-[10px]">
                        {template.category}
                      </span>
                    </div>
                    <p className="text-[11px] text-sf-text-muted mt-0.5 line-clamp-2">
                      Workflow from ComfyUI templates
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {installed ? (
                      <button
                        onClick={() => handleUninstallComfy(template)}
                        disabled={isLoading}
                        className="flex items-center gap-1 px-2 py-1.5 rounded text-xs text-sf-text-muted hover:bg-sf-dark-600 hover:text-red-300 transition-colors disabled:opacity-50"
                        title="Remove workflow"
                      >
                        {isLoading ? <span className="animate-pulse">...</span> : <Trash2 className="w-3.5 h-3.5" />}
                        <span>Remove</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleInstallComfy(template)}
                        disabled={isLoading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-sf-accent hover:bg-sf-accent-hover text-white transition-colors disabled:opacity-50"
                        title="Download workflow"
                      >
                        {isLoading ? (
                          <span className="animate-pulse">...</span>
                        ) : (
                          <>
                            <Download className="w-3.5 h-3.5" />
                            <span>Download</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ComfyUI not available */}
      {!comfyLoading && comfyTemplates.length === 0 && comfyError && (
        <div className="mt-6 p-4 bg-sf-dark-800 border border-sf-dark-600 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <GitBranch className="w-4 h-4 text-sf-text-muted" />
            <span className="text-sm font-medium text-sf-text-primary">ComfyUI Templates</span>
          </div>
          <p className="text-xs text-sf-text-muted mb-3">
            {comfyError}
          </p>
          <button
            onClick={onRefreshComfyTemplates}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-sf-dark-700 hover:bg-sf-dark-600 text-sf-text-secondary transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Try again
          </button>
        </div>
      )}
    </div>
  )
}

export default function SettingsModal({ isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('general')
  const [comfyTemplates, setComfyTemplates] = useState([])
  const [comfyLoading, setComfyLoading] = useState(true)
  const [comfyError, setComfyError] = useState(null)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    async function load() {
      setComfyLoading(true)
      setComfyError(null)
      const result = await fetchComfyUITemplates()
      if (cancelled) return
      setComfyLoading(false)
      if (result.success) {
        setComfyTemplates(result.templates || [])
      } else {
        setComfyError(result.error || 'Could not load templates')
        setComfyTemplates([])
      }
    }
    load()
    return () => { cancelled = true }
  }, [isOpen])

  const refreshComfyTemplates = async () => {
    setComfyLoading(true)
    setComfyError(null)
    const result = await fetchComfyUITemplates()
    setComfyLoading(false)
    if (result.success) {
      setComfyTemplates(result.templates || [])
    } else {
      setComfyError(result.error || 'Could not load templates')
      // Don't clear templates on refresh failure - keep existing data
    }
  }

  if (!isOpen) return null

  const tabs = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'workflows', label: 'Workflows', icon: GitBranch },
  ]

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

        {/* Tabs */}
        <div className="flex border-b border-sf-dark-700 px-4">
          {tabs.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-3 -mb-px border-b-2 transition-colors ${
                  isActive
                    ? 'border-sf-accent text-sf-accent'
                    : 'border-transparent text-sf-text-muted hover:text-sf-text-secondary'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="text-sm font-medium">{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          {activeTab === 'general' && <GeneralTab />}
          {activeTab === 'workflows' && (
            <WorkflowsTab
              comfyTemplates={comfyTemplates}
              comfyLoading={comfyLoading}
              comfyError={comfyError}
              onRefreshComfyTemplates={refreshComfyTemplates}
            />
          )}
        </div>
      </div>
    </div>
  )
}

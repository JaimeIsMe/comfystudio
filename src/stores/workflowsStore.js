/**
 * Workflows store - tracks which workflows are installed (built-in + user-downloaded).
 * GenerateWorkspace reads from this to show available workflows.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { BUILTIN_WORKFLOWS, AVAILABLE_WORKFLOWS, BUILTIN_WORKFLOW_PATHS } from '../config/workflowRegistry'
import { isElectron } from '../services/fileSystem'

const STORAGE_KEY = 'comfystudio-workflows'

// Built-in workflow IDs are always installed
const BUILTIN_IDS = new Set(BUILTIN_WORKFLOWS.map(w => w.id))

// Get workflows directory path (Electron only)
const getWorkflowsDir = async () => {
  if (!isElectron() || !window.electronAPI?.getAppPath) return null
  const userData = await window.electronAPI.getAppPath('userData')
  if (!userData) return null
  const pathJoin = window.electronAPI.pathJoin
  return pathJoin(userData, 'workflows')
}

const useWorkflowsStore = create(
  persist(
    (set, get) => ({
      // User-downloaded workflow IDs (in addition to built-in)
      downloadedIds: [],
      // ComfyUI templates downloaded from running ComfyUI instance
      downloadedComfyIds: [],

      /** Check if a workflow is installed (built-in or downloaded) */
      isInstalled: (workflowId) => {
        if (BUILTIN_IDS.has(workflowId)) return true
        return get().downloadedIds.includes(workflowId)
      },

      /** Check if a ComfyUI template is installed */
      isComfyInstalled: (templateId) => get().downloadedComfyIds.includes(templateId),

      /** Get all installed workflow IDs */
      getInstalledIds: () => {
        const { downloadedIds } = get()
        return [...BUILTIN_WORKFLOWS.map(w => w.id), ...downloadedIds]
      },

      /** Install (download) a workflow by ID */
      installWorkflow: async (workflowId) => {
        const w = [...BUILTIN_WORKFLOWS, ...AVAILABLE_WORKFLOWS].find(wf => wf.id === workflowId)
        if (!w) throw new Error('Unknown workflow: ' + workflowId)
        if (BUILTIN_IDS.has(workflowId)) return // Built-in already installed

        if (isElectron()) {
          const dir = await getWorkflowsDir()
          if (!dir) throw new Error('Could not get workflows directory')
          const { createDirectory, writeFile, pathJoin } = window.electronAPI
          // Fetch workflow JSON from public
          const base = import.meta.env.BASE_URL || '/'
          const url = `${base}workflows/${w.file}`.replace(/\/+/g, '/')
          const resp = await fetch(url)
          if (!resp.ok) throw new Error('Failed to fetch workflow')
          const json = await resp.json()
          await createDirectory(dir, { recursive: true })
          const destPath = await pathJoin(dir, w.file)
          const writeResult = await writeFile(destPath, json)
          if (writeResult?.success === false) throw new Error(writeResult.error || 'Failed to write workflow')
          set(state => ({
            downloadedIds: state.downloadedIds.includes(workflowId)
              ? state.downloadedIds
              : [...state.downloadedIds, workflowId]
          }))
        } else {
          // Web: store in localStorage
          const url = `/workflows/${w.file}`
          const resp = await fetch(url)
          if (!resp.ok) throw new Error('Failed to fetch workflow')
          const json = await resp.json()
          const stored = JSON.parse(localStorage.getItem(STORAGE_KEY + '-downloaded') || '{}')
          stored[workflowId] = json
          localStorage.setItem(STORAGE_KEY + '-downloaded', JSON.stringify(stored))
          set(state => ({
            downloadedIds: state.downloadedIds.includes(workflowId)
              ? state.downloadedIds
              : [...state.downloadedIds, workflowId]
          }))
        }
      },

      /** Uninstall (delete) a workflow. Only for user-downloaded, not built-in. */
      uninstallWorkflow: async (workflowId) => {
        if (BUILTIN_IDS.has(workflowId)) return // Cannot delete built-in

        if (isElectron()) {
          const dir = await getWorkflowsDir()
          if (dir) {
            const w = AVAILABLE_WORKFLOWS.find(wf => wf.id === workflowId)
            if (w) {
              const { deleteFile, pathJoin } = window.electronAPI
              const filePath = pathJoin(dir, w.file)
              try {
                await deleteFile(filePath)
              } catch (_) { /* ignore if file missing */ }
            }
          }
          set(state => ({ downloadedIds: state.downloadedIds.filter(id => id !== workflowId) }))
        } else {
          const stored = JSON.parse(localStorage.getItem(STORAGE_KEY + '-downloaded') || '{}')
          delete stored[workflowId]
          localStorage.setItem(STORAGE_KEY + '-downloaded', JSON.stringify(stored))
          set(state => ({ downloadedIds: state.downloadedIds.filter(id => id !== workflowId) }))
        }
      },

      /** Get workflow JSON for execution. For built-in: fetch from public. For downloaded: load from disk/localStorage. */
      getWorkflowJson: async (workflowId) => {
        const path = BUILTIN_WORKFLOW_PATHS[workflowId]
        if (path) {
          const resp = await fetch(path)
          if (!resp.ok) throw new Error('Failed to load workflow')
          return resp.json()
        }
        const w = AVAILABLE_WORKFLOWS.find(wf => wf.id === workflowId)
        if (!w) throw new Error('Unknown workflow: ' + workflowId)
        if (isElectron()) {
          const dir = await getWorkflowsDir()
          if (!dir) throw new Error('Workflows directory not available')
          const { readFile, pathJoin } = window.electronAPI
          const filePath = await pathJoin(dir, w.file)
          const result = await readFile(filePath, { encoding: 'utf8' })
          if (!result.success) throw new Error(result.error || 'Failed to read workflow')
          return typeof result.data === 'string' ? JSON.parse(result.data) : result.data
        }
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY + '-downloaded') || '{}')
        const json = stored[workflowId]
        if (!json) throw new Error('Workflow not installed')
        return json
      },

      /** Get path/URL for workflow (for runJob) - built-in use public paths */
      getWorkflowPath: (workflowId) => {
        return BUILTIN_WORKFLOW_PATHS[workflowId] || null
      },

      /** Install a ComfyUI template (fetches from ComfyUI, saves locally) */
      installComfyUITemplate: async (template) => {
        const { fetchComfyUIWorkflow } = await import('../services/comfyuiTemplates')
        const result = await fetchComfyUIWorkflow(template.path)
        if (!result.success) throw new Error(result.error || 'Failed to fetch workflow')
        const safeName = `${template.id}.json`.replace(/[^a-zA-Z0-9_\-.]/g, '_')
        if (isElectron()) {
          const dir = await getWorkflowsDir()
          if (!dir) throw new Error('Could not get workflows directory')
          const { createDirectory, writeFile, pathJoin } = window.electronAPI
          await createDirectory(dir, { recursive: true })
          const destPath = await pathJoin(dir, safeName)
          const writeResult = await writeFile(destPath, result.workflow)
          if (writeResult?.success === false) throw new Error(writeResult.error || 'Failed to write workflow')
        } else {
          const stored = JSON.parse(localStorage.getItem(STORAGE_KEY + '-comfy') || '{}')
          stored[template.id] = result.workflow
          localStorage.setItem(STORAGE_KEY + '-comfy', JSON.stringify(stored))
        }
        set(state => ({
          downloadedComfyIds: state.downloadedComfyIds.includes(template.id)
            ? state.downloadedComfyIds
            : [...state.downloadedComfyIds, template.id]
        }))
      },

      /** Uninstall a ComfyUI template */
      uninstallComfyUITemplate: async (templateId) => {
        const safeName = `${templateId}.json`.replace(/[^a-zA-Z0-9_\-.]/g, '_')
        if (isElectron()) {
          const dir = await getWorkflowsDir()
          if (dir) {
            const { deleteFile, pathJoin } = window.electronAPI
            const filePath = await pathJoin(dir, safeName)
            try {
              await deleteFile(filePath)
            } catch (_) { /* ignore */ }
          }
        } else {
          const stored = JSON.parse(localStorage.getItem(STORAGE_KEY + '-comfy') || '{}')
          delete stored[templateId]
          localStorage.setItem(STORAGE_KEY + '-comfy', JSON.stringify(stored))
        }
        set(state => ({ downloadedComfyIds: state.downloadedComfyIds.filter(id => id !== templateId) }))
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (state) => ({ downloadedIds: state.downloadedIds, downloadedComfyIds: state.downloadedComfyIds }),
    }
  )
)

export default useWorkflowsStore

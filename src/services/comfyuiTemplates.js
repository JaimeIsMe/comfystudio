/**
 * ComfyUI Workflow Templates API
 * Fetches available workflow templates from a running ComfyUI instance.
 * ComfyUI docs: /workflow_templates returns a map of custom node modules and their template workflows.
 */
import {
  getLocalComfyHttpBaseSync,
  isLoopbackHttpUrl,
} from './localComfyConnection'

/**
 * Fetch workflow templates from ComfyUI.
 * @returns {Promise<{ success: boolean, templates?: Array<{ id: string, name: string, category: string, path?: string }>, error?: string }>}
 */
export async function fetchComfyUITemplates() {
  const comfyBase = getLocalComfyHttpBaseSync()
  try {
    const url = `${comfyBase}/workflow_templates`
    const resp = await fetch(url)
    if (!resp.ok) {
      return { success: false, error: `ComfyUI returned ${resp.status}` }
    }
    const data = await resp.json()

    // Parse response - ComfyUI returns object like { "moduleName": { "templateName": path } } or similar
    const templates = parseComfyUITemplates(data)
    return { success: true, templates }
  } catch (err) {
    console.warn('[ComfyUI Templates]', err)
    return {
      success: false,
      error: err.message || `Failed to fetch templates. Is ComfyUI running at ${comfyBase}?`
    }
  }
}

/**
 * Parse ComfyUI workflow_templates response into a flat list.
 * Handles various formats ComfyUI may return.
 * Docs: returns "a map of custom node modules and associated template workflows"
 */
function parseComfyUITemplates(data) {
  const templates = []
  if (!data || typeof data !== 'object') return templates

  // Format: { "moduleName": { "templateId": "path" } } or { "moduleName": { "templateId": { path, ... } } }
  // Or: { "templates": [...] } or direct array
  let categories = data
  if (Array.isArray(data)) {
    return data.map((item, i) => ({
      id: item?.id ?? `comfy-template-${i}`,
      name: item?.name ?? item?.title ?? `Template ${i + 1}`,
      category: item?.category ?? 'default',
      path: item?.path ?? item?.url ?? '',
    })).filter(t => t.path)
  }
  if (data.templates && Array.isArray(data.templates)) {
    return data.templates.map((item, i) => ({
      id: item?.id ?? `comfy-template-${i}`,
      name: item?.name ?? item?.title ?? `Template ${i + 1}`,
      category: item?.category ?? data.moduleName ?? 'default',
      path: item?.path ?? item?.url ?? item?.file ?? '',
    })).filter(t => t.path)
  }

  for (const [category, items] of Object.entries(categories)) {
    if (category === 'templates' || !items || typeof items !== 'object') continue
    if (Array.isArray(items)) {
      items.forEach((item, i) => {
        const name = item?.name ?? item?.id ?? `template-${i}`
        const path = item?.path ?? item?.url ?? item?.file
        if (path) {
          templates.push({
            id: `comfy-${category}-${String(name).replace(/\s+/g, '_')}`,
            name: typeof name === 'string' ? name : String(name),
            category: category,
            path: path,
          })
        }
      })
    } else {
      for (const [name, value] of Object.entries(items)) {
        const path = typeof value === 'string' ? value : value?.path ?? value?.url ?? value?.file
        const displayName = typeof value === 'object' && value?.title ? value.title : (value?.name ?? name)
        templates.push({
          id: `comfy-${category}-${String(name).replace(/\s+/g, '_')}`,
          name: typeof displayName === 'string' ? displayName : name,
          category: category,
          path: path ?? `/extensions/${category}/example_workflows/${name}.json`,
        })
      }
    }
  }
  return templates
}

/**
 * Fetch a single workflow JSON from ComfyUI by path.
 * @param {string} path - Relative path like "extensions/core/templates/wan.json" or full path
 * @returns {Promise<{ success: boolean, workflow?: object, error?: string }>}
 */
export async function fetchComfyUIWorkflow(path) {
  const comfyBase = getLocalComfyHttpBaseSync()
  try {
    const workflowPath = String(path || '')
    if (workflowPath.startsWith('http') && !isLoopbackHttpUrl(workflowPath)) {
      return {
        success: false,
        error: 'Remote template URLs are disabled. Use local ComfyUI only.',
      }
    }
    const url = workflowPath.startsWith('http')
      ? workflowPath
      : `${comfyBase}/${workflowPath.replace(/^\//, '')}`
    const resp = await fetch(url)
    if (!resp.ok) {
      return { success: false, error: `Failed to fetch: ${resp.status}` }
    }
    const workflow = await resp.json()
    return { success: true, workflow }
  } catch (err) {
    return { success: false, error: err.message || 'Failed to fetch workflow' }
  }
}

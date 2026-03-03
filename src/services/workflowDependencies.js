import { comfyui } from './comfyui'
import { getWorkflowDependencyPack } from '../config/workflowDependencyPacks'

function asStringList(values) {
  if (!Array.isArray(values)) return []
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
}

function extractChoiceListFromSpec(inputSpec) {
  if (!inputSpec) return []

  if (Array.isArray(inputSpec)) {
    const [first] = inputSpec
    if (Array.isArray(first)) return asStringList(first)
    if (first && typeof first === 'object') {
      return asStringList(first.values || first.choices || first.options || first.enum)
    }
  }

  if (inputSpec && typeof inputSpec === 'object') {
    return asStringList(inputSpec.values || inputSpec.choices || inputSpec.options || inputSpec.enum)
  }

  return []
}

function getInputSpec(nodeSchema, inputKey) {
  const requiredSpec = nodeSchema?.input?.required?.[inputKey]
  if (requiredSpec !== undefined) return requiredSpec
  const optionalSpec = nodeSchema?.input?.optional?.[inputKey]
  if (optionalSpec !== undefined) return optionalSpec
  return null
}

function uniqueBy(items, keyBuilder) {
  const seen = new Set()
  const out = []
  for (const item of items || []) {
    const key = keyBuilder(item)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

export async function checkWorkflowDependencies(workflowId) {
  const pack = getWorkflowDependencyPack(workflowId)
  const checkedAt = Date.now()

  if (!pack) {
    return {
      workflowId,
      checkedAt,
      hasPack: false,
      status: 'no-pack',
      missingNodes: [],
      missingModels: [],
      unresolvedModels: [],
      missingAuth: false,
      hasBlockingIssues: false,
      pack: null,
    }
  }

  let objectInfo = null
  try {
    objectInfo = await comfyui.getObjectInfo()
  } catch (error) {
    return {
      workflowId,
      checkedAt,
      hasPack: true,
      status: 'error',
      error: error instanceof Error ? error.message : String(error || 'Failed to fetch object info'),
      missingNodes: [],
      missingModels: [],
      unresolvedModels: [],
      missingAuth: false,
      hasBlockingIssues: false,
      pack,
    }
  }

  const missingNodes = uniqueBy(
    (pack.requiredNodes || [])
      .filter((node) => !objectInfo?.[node.classType])
      .map((node) => ({
        classType: node.classType,
        notes: node.notes || '',
      })),
    (node) => node.classType
  )

  const missingModels = []
  const unresolvedModels = []

  for (const model of pack.requiredModels || []) {
    const classType = String(model.classType || '').trim()
    const inputKey = String(model.inputKey || '').trim()
    const filename = String(model.filename || '').trim()
    if (!classType || !inputKey || !filename) continue

    const nodeSchema = objectInfo?.[classType]
    if (!nodeSchema) {
      // Missing node will already block. Keep this as unresolved context.
      unresolvedModels.push({
        classType,
        inputKey,
        filename,
        reason: 'missing-node',
        targetSubdir: model.targetSubdir || '',
      })
      continue
    }

    const inputSpec = getInputSpec(nodeSchema, inputKey)
    const choices = extractChoiceListFromSpec(inputSpec)

    if (choices.length === 0) {
      unresolvedModels.push({
        classType,
        inputKey,
        filename,
        reason: 'choices-unavailable',
        targetSubdir: model.targetSubdir || '',
      })
      continue
    }

    const installedChoices = new Set(choices.map((item) => item.toLowerCase()))
    if (!installedChoices.has(filename.toLowerCase())) {
      missingModels.push({
        classType,
        inputKey,
        filename,
        targetSubdir: model.targetSubdir || '',
      })
    }
  }

  let missingAuth = false
  if (pack.requiresComfyOrgApiKey) {
    const apiKey = await comfyui.getComfyOrgApiKey()
    missingAuth = !String(apiKey || '').trim()
  }

  const hasBlockingIssues = missingNodes.length > 0 || missingModels.length > 0 || missingAuth
  const status = hasBlockingIssues
    ? 'missing'
    : (unresolvedModels.length > 0 ? 'partial' : 'ready')

  return {
    workflowId,
    checkedAt,
    hasPack: true,
    status,
    missingNodes,
    missingModels,
    unresolvedModels,
    missingAuth,
    hasBlockingIssues,
    pack,
  }
}

export function buildMissingDependencyClipboardText(checkResult) {
  if (!checkResult || !checkResult.hasPack) return 'No dependency pack found for this workflow.'

  const lines = []
  const title = checkResult.pack?.displayName || checkResult.workflowId
  lines.push(`Workflow dependency report: ${title}`)
  lines.push('')

  if (checkResult.missingNodes?.length > 0) {
    lines.push('Missing custom nodes:')
    for (const node of checkResult.missingNodes) {
      lines.push(`- ${node.classType}`)
    }
    lines.push('')
  }

  if (checkResult.missingModels?.length > 0) {
    lines.push('Missing models:')
    for (const model of checkResult.missingModels) {
      const folderHint = model.targetSubdir ? ` -> ComfyUI/models/${model.targetSubdir}` : ''
      lines.push(`- ${model.filename}${folderHint}`)
    }
    lines.push('')
  }

  if (checkResult.missingAuth) {
    lines.push('Missing API key:')
    lines.push('- Configure "Comfy Partner API Key" in Settings before running this workflow.')
    lines.push('')
  }

  if ((checkResult.missingNodes?.length || 0) === 0 && (checkResult.missingModels?.length || 0) === 0 && !checkResult.missingAuth) {
    lines.push('No blocking dependencies detected.')
  }

  return lines.join('\n').trim()
}

export const QWEN3_TTS_ENGINE_CLASS_TYPE = 'Qwen3TTSEngineNode'

const CURRENT_MODEL_INPUT = 'model_variant'
const LEGACY_MODEL_INPUT = 'model_size'

function schemaDeclaresInput(nodeSchema, category, inputName) {
  return Boolean(
    nodeSchema?.input?.[category]
      && Object.prototype.hasOwnProperty.call(nodeSchema.input[category], inputName)
  )
}

function resolveNodeSchema(objectInfo) {
  if (!objectInfo || typeof objectInfo !== 'object') return null
  if (objectInfo[QWEN3_TTS_ENGINE_CLASS_TYPE]) {
    return objectInfo[QWEN3_TTS_ENGINE_CLASS_TYPE]
  }
  if (objectInfo.input && typeof objectInfo.input === 'object') return objectInfo
  if (objectInfo.name === QWEN3_TTS_ENGINE_CLASS_TYPE) return objectInfo
  return null
}

export function workflowHasQwen3TtsEngine(workflow) {
  if (!workflow || typeof workflow !== 'object') return false
  return Object.values(workflow).some(
    (node) => String(node?.class_type || '').trim() === QWEN3_TTS_ENGINE_CLASS_TYPE
  )
}

/**
 * TTS-Audio-Suite renamed the Qwen3 engine's required model input from
 * `model_size` to `model_variant`. Select the key declared by the connected
 * ComfyUI schema so Velorn's bundled caption workflow works with either
 * version.
 *
 * If object info is unavailable or does not describe either key, include both
 * aliases. ComfyUI ignores undeclared prompt inputs, so either old or new node
 * versions can consume the one they understand. The bundled workflow uses the
 * current `model_variant` contract as its default.
 */
export function resolveQwen3TtsWorkflowInputs(workflow, objectInfo) {
  if (!workflowHasQwen3TtsEngine(workflow)) return workflow

  const nodeSchema = resolveNodeSchema(objectInfo)
  const requiredInputs = [CURRENT_MODEL_INPUT, LEGACY_MODEL_INPUT].filter(
    (inputName) => schemaDeclaresInput(nodeSchema, 'required', inputName)
  )
  const optionalInputs = [CURRENT_MODEL_INPUT, LEGACY_MODEL_INPUT].filter(
    (inputName) => schemaDeclaresInput(nodeSchema, 'optional', inputName)
  )
  const targetInputs = requiredInputs.length > 0
    ? requiredInputs
    : (optionalInputs.length > 0 ? [optionalInputs[0]] : [CURRENT_MODEL_INPUT, LEGACY_MODEL_INPUT])

  let resolvedWorkflow = workflow
  let cloned = false

  for (const [nodeId, node] of Object.entries(workflow)) {
    if (String(node?.class_type || '').trim() !== QWEN3_TTS_ENGINE_CLASS_TYPE) continue
    const inputs = node?.inputs
    if (!inputs || typeof inputs !== 'object') continue

    const hasCurrentValue = Object.prototype.hasOwnProperty.call(inputs, CURRENT_MODEL_INPUT)
    const hasLegacyValue = Object.prototype.hasOwnProperty.call(inputs, LEGACY_MODEL_INPUT)
    if (!hasCurrentValue && !hasLegacyValue) continue

    const preferredInput = targetInputs.length === 1 ? targetInputs[0] : CURRENT_MODEL_INPUT
    const sourceValue = Object.prototype.hasOwnProperty.call(inputs, preferredInput)
      ? inputs[preferredInput]
      : (hasCurrentValue ? inputs[CURRENT_MODEL_INPUT] : inputs[LEGACY_MODEL_INPUT])
    const alreadyResolved = targetInputs.every((inputName) => inputs[inputName] === sourceValue)
      && [CURRENT_MODEL_INPUT, LEGACY_MODEL_INPUT]
        .filter((inputName) => !targetInputs.includes(inputName))
        .every((inputName) => !Object.prototype.hasOwnProperty.call(inputs, inputName))
    if (alreadyResolved) continue

    if (!cloned) {
      resolvedWorkflow = JSON.parse(JSON.stringify(workflow))
      cloned = true
    }

    const resolvedInputs = resolvedWorkflow[nodeId].inputs
    for (const inputName of targetInputs) resolvedInputs[inputName] = sourceValue
    for (const inputName of [CURRENT_MODEL_INPUT, LEGACY_MODEL_INPUT]) {
      if (!targetInputs.includes(inputName)) delete resolvedInputs[inputName]
    }
  }

  return resolvedWorkflow
}

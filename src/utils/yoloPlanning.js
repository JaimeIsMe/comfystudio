const DEFAULT_ANGLE_PRESETS = [
  'Wide shot',
  'Medium shot',
  'Close-up',
  'Low angle',
  'High angle',
  'Over-the-shoulder',
  'POV',
  'Tracking shot',
]

const SCENE_HEADING_PATTERN = /^(?:scene\s+\d+|sc\s*\d+|#\s*scene|\d+\.)\b/i
const SHOT_HEADING_PATTERN = /^(?:shot\s+\d+|sh\s*\d+)\b/i
const STRUCTURED_FIELD_PATTERNS = Object.freeze([
  { key: 'sceneContext', pattern: /^scene\s+context\s*:\s*(.*)$/i },
  { key: 'shotType', pattern: /^(?:shot\s*type|framing)\s*:\s*(.*)$/i },
  { key: 'keyframePrompt', pattern: /^(?:keyframe\s*prompt|image\s*action|opening\s*frame|keyframe)\s*:\s*(.*)$/i },
  { key: 'motionPrompt', pattern: /^(?:motion\s*prompt|video\s*action|video\s*prompt|motion)\s*:\s*(.*)$/i },
  { key: 'camera', pattern: /^(?:camera|camera\s*direction|camera\s*setup)\s*:\s*(.*)$/i },
  { key: 'duration', pattern: /^duration(?:\s*\(s\))?\s*:\s*(.*)$/i },
  { key: 'takes', pattern: /^takes?\s*:\s*(.*)$/i },
])

function parseSceneHeadingLine(line = '') {
  const text = String(line || '').trim()
  if (!text || !SCENE_HEADING_PATTERN.test(text)) {
    return { isHeading: false, label: '' }
  }
  const label = text
    .replace(/^(?:scene\s+\d+|sc\s*\d+|#\s*scene|\d+\.)\s*[:\-]?\s*/i, '')
    .trim()
  return { isHeading: true, label }
}

function getSceneLines(sceneText = '') {
  return String(sceneText)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function getSceneBodyText(sceneText = '') {
  const lines = getSceneLines(sceneText)
  if (lines.length === 0) return ''

  const { isHeading, label } = parseSceneHeadingLine(lines[0])
  if (!isHeading) return lines.join(' ')

  const bodyLines = lines.slice(1).filter(Boolean)
  if (bodyLines.length > 0) return bodyLines.join(' ')
  return label
}

function getSceneLabel(sceneText = '') {
  const firstLine = getSceneLines(sceneText)[0] || ''
  const { isHeading, label } = parseSceneHeadingLine(firstLine)
  return isHeading ? label : ''
}

function parseShotHeadingLine(line = '') {
  const text = String(line || '').trim()
  if (!text || !SHOT_HEADING_PATTERN.test(text)) {
    return { isHeading: false, label: '' }
  }
  const label = text
    .replace(/^(?:shot\s+\d+|sh\s*\d+)\s*[:\-]?\s*/i, '')
    .trim()
  return { isHeading: true, label }
}

function matchStructuredFieldLine(line = '') {
  const text = String(line || '').trim()
  for (const entry of STRUCTURED_FIELD_PATTERNS) {
    const match = text.match(entry.pattern)
    if (!match) continue
    return {
      key: entry.key,
      value: String(match[1] || '').trim(),
    }
  }
  return null
}

function splitScriptIntoScenes(script = '') {
  const normalized = String(script || '').replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const explicitScenes = normalized
    .split(/\n(?=\s*(?:scene\s+\d+|sc\s*\d+|#\s*scene|\d+\.)\b)/i)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
  if (explicitScenes.length > 1) return explicitScenes

  const paragraphScenes = normalized
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
  if (paragraphScenes.length > 1) return paragraphScenes

  return [normalized]
}

function splitSceneIntoBeats(sceneText = '') {
  const lines = getSceneLines(sceneText)
  const nonHeadingLines = lines.filter((line, index) => !(index === 0 && parseSceneHeadingLine(line).isHeading))
  const lineBeats = nonHeadingLines.length > 0 ? nonHeadingLines : lines
  if (lineBeats.length > 1) return lineBeats

  const sentenceBeats = getSceneBodyText(sceneText)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
  if (sentenceBeats.length > 0) return sentenceBeats

  return [String(getSceneBodyText(sceneText) || sceneText).trim()]
}

function sanitizeSnippet(text = '', maxLength = 180) {
  const compact = String(text).replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) return compact
  return `${compact.slice(0, maxLength - 3)}...`
}

function extractKeyframeMoment(text = '') {
  const compact = String(text || '').replace(/\s+/g, ' ').trim()
  if (!compact) return ''
  const sequenceSplit = compact
    .split(/\b(?:then|after|before|while|as soon as|followed by)\b/i)
    .map((part) => part.trim())
    .filter(Boolean)
  const firstSequence = sequenceSplit[0] || compact
  const firstSentence = firstSequence.split(/(?<=[.!?])\s+/)[0] || firstSequence
  return firstSentence.trim()
}

function seededUnit(seed) {
  const x = Math.sin(Number(seed) * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

function randomizedShotDurationSeconds(baseSeed, sceneIndex, shotIndex) {
  const unit = seededUnit(baseSeed + sceneIndex * 101 + shotIndex * 37)
  const min = 2
  const max = 5
  const duration = min + (max - min) * unit
  return Number(duration.toFixed(2))
}

function parseOptionalShotDurationSeconds(value, fallback) {
  const text = String(value || '').trim()
  if (!text) return fallback
  const match = text.match(/(\d+(?:\.\d+)?)/)
  if (!match) return fallback
  const parsed = Number(match[1])
  if (!Number.isFinite(parsed)) return fallback
  return Number(Math.min(5, Math.max(2, parsed)).toFixed(2))
}

function parseOptionalShotTakes(value, fallback) {
  const text = String(value || '').trim()
  if (!text) return fallback
  const match = text.match(/(\d+)/)
  if (!match) return fallback
  const parsed = Number(match[1])
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(4, Math.max(1, Math.round(parsed)))
}

function buildStructuredSceneSummary(sceneLabel, sceneContext, fallbackText = '') {
  return sanitizeSnippet(
    [sceneLabel ? `${sceneLabel}.` : '', sceneContext || fallbackText]
      .filter(Boolean)
      .join(' '),
    280
  )
}

function parseStructuredDirectorScript(script = '', options = {}) {
  const normalized = String(script || '').replace(/\r\n/g, '\n').trim()
  if (!normalized) return null

  const takesPerAngle = Math.max(1, Number(options.takesPerAngle) || 1)
  const targetDurationSeconds = Math.max(5, Number(options.targetDurationSeconds) || 30)
  const variationSeed = Math.max(0, Number(options.variationSeed) || 0)
  const styleNotes = sanitizeSnippet(options.styleNotes || '', 220)
  const anglePresets = Array.isArray(options.anglePresets) && options.anglePresets.length > 0
    ? options.anglePresets
    : DEFAULT_ANGLE_PRESETS
  const lines = normalized.split('\n')

  const scenes = []
  let currentScene = null
  let currentShot = null
  let activeField = ''
  let sawStructuredField = false

  const ensureScene = () => {
    if (currentScene) return currentScene
    currentScene = {
      label: '',
      rawLines: [],
      contextLines: [],
      shots: [],
    }
    return currentScene
  }

  const appendToActiveField = (target, fieldName, value) => {
    const text = String(value || '').trim()
    if (!text) return
    const existing = String(target[fieldName] || '').trim()
    target[fieldName] = existing ? `${existing} ${text}` : text
  }

  const appendSceneContextLine = (scene, value) => {
    const text = String(value || '').trim()
    if (!text) return
    scene.contextLines.push(text)
  }

  const flushShot = () => {
    if (!currentScene || !currentShot) return

    const shotIndex = currentScene.shots.length
    const shotId = `S${scenes.length + 1}_SH${shotIndex + 1}`
    const fallbackAngle = anglePresets[(variationSeed + scenes.length * 2 + shotIndex) % anglePresets.length]
    const fallbackDuration = randomizedShotDurationSeconds(variationSeed + targetDurationSeconds, scenes.length, shotIndex)
    const shotContext = sanitizeSnippet(currentShot.notes || currentShot.label || currentScene.contextLines.join(' '), 220)
    const imageBeat = sanitizeSnippet(
      currentShot.keyframePrompt || shotContext || currentScene.contextLines.join(' '),
      220
    )
    const videoBeat = sanitizeSnippet(
      currentShot.motionPrompt || currentShot.keyframePrompt || shotContext || currentScene.contextLines.join(' '),
      220
    )
    const shotType = sanitizeSnippet(currentShot.shotType || currentShot.label || fallbackAngle, 90)
    const cameraDirection = sanitizeSnippet(currentShot.camera || '', 160)

    currentScene.shots.push({
      id: shotId,
      index: shotIndex + 1,
      beat: videoBeat,
      imageBeat,
      videoBeat,
      durationSeconds: parseOptionalShotDurationSeconds(currentShot.duration, fallbackDuration),
      takesPerAngle: parseOptionalShotTakes(currentShot.takes, takesPerAngle),
      angles: [shotType || fallbackAngle],
      cameraPresetId: 'auto',
      shotType,
      cameraDirection,
      locked: false,
    })

    currentShot = null
    activeField = ''
  }

  const flushScene = () => {
    if (!currentScene) return
    flushShot()
    if (currentScene.shots.length === 0) {
      currentScene = null
      activeField = ''
      return
    }

    const sceneIndex = scenes.length
    const sceneId = `S${sceneIndex + 1}`
    const sceneContext = sanitizeSnippet(currentScene.contextLines.join(' '), 280)
    const sceneSummary = buildStructuredSceneSummary(currentScene.label, sceneContext, currentScene.rawLines.join(' '))

    scenes.push({
      id: sceneId,
      index: sceneIndex + 1,
      rawText: currentScene.rawLines.join('\n'),
      contextText: sceneContext,
      summary: sceneSummary,
      styleNotes,
      shots: currentScene.shots.map((shot, shotIndex) => ({
        ...shot,
        id: `${sceneId}_SH${shotIndex + 1}`,
        index: shotIndex + 1,
      })),
    })

    currentScene = null
    activeField = ''
  }

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim()
    if (!line) {
      activeField = ''
      continue
    }

    const sceneHeading = parseSceneHeadingLine(line)
    if (sceneHeading.isHeading) {
      flushScene()
      currentScene = {
        label: sceneHeading.label,
        rawLines: [line],
        contextLines: [],
        shots: [],
      }
      continue
    }

    const scene = ensureScene()
    scene.rawLines.push(line)

    const shotHeading = parseShotHeadingLine(line)
    if (shotHeading.isHeading) {
      flushShot()
      currentShot = {
        label: shotHeading.label,
        shotType: '',
        keyframePrompt: '',
        motionPrompt: '',
        camera: '',
        duration: '',
        takes: '',
        notes: '',
      }
      continue
    }

    const structuredField = matchStructuredFieldLine(line)
    if (structuredField) {
      sawStructuredField = true
      activeField = structuredField.key
      if (currentShot) {
        appendToActiveField(currentShot, structuredField.key, structuredField.value)
      } else {
        appendSceneContextLine(scene, structuredField.value)
      }
      continue
    }

    if (currentShot) {
      if (activeField && activeField !== 'sceneContext') {
        appendToActiveField(currentShot, activeField, line)
      } else {
        appendToActiveField(currentShot, 'notes', line)
      }
      continue
    }

    scene.contextLines.push(line)
  }

  flushScene()

  if (!sawStructuredField || scenes.length === 0) return null
  return scenes
}

export function buildYoloPlanFromScript(script = '', options = {}) {
  const shotsPerScene = Math.max(1, Number(options.shotsPerScene) || 3)
  const anglesPerShot = Math.max(1, Number(options.anglesPerShot) || 2)
  const takesPerAngle = Math.max(1, Number(options.takesPerAngle) || 1)
  const targetDurationSeconds = Math.max(5, Number(options.targetDurationSeconds) || 30)
  const variationSeed = Math.max(0, Number(options.variationSeed) || 0)
  const styleNotes = sanitizeSnippet(options.styleNotes || '', 220)
  const anglePresets = Array.isArray(options.anglePresets) && options.anglePresets.length > 0
    ? options.anglePresets
    : DEFAULT_ANGLE_PRESETS

  const structuredPlan = parseStructuredDirectorScript(script, {
    takesPerAngle,
    targetDurationSeconds,
    variationSeed,
    styleNotes,
    anglePresets,
  })
  if (Array.isArray(structuredPlan) && structuredPlan.length > 0) {
    return structuredPlan
  }

  const sceneBlocks = splitScriptIntoScenes(script)
  if (sceneBlocks.length === 0) return []

  return sceneBlocks.map((sceneText, sceneIndex) => {
    const sceneId = `S${sceneIndex + 1}`
    const sceneLabel = getSceneLabel(sceneText)
    const sceneBody = getSceneBodyText(sceneText)
    const beats = splitSceneIntoBeats(sceneText)
    const beatOffset = beats.length > 0 ? variationSeed % beats.length : 0
    const sceneSummaryBase = sceneBody || beats[0] || sceneText
    const sceneSummary = sanitizeSnippet(
      [sceneLabel ? `${sceneLabel}.` : '', sceneSummaryBase]
        .filter(Boolean)
        .join(' '),
      280
    )

    const shots = Array.from({ length: shotsPerScene }, (_, shotIndex) => {
      const beat = beats[(beatOffset + shotIndex) % beats.length] || sceneSummary
      const shotId = `${sceneId}_SH${shotIndex + 1}`
      const angleOffset = (variationSeed + sceneIndex * 2 + shotIndex) % anglePresets.length
      const angles = Array.from({ length: anglesPerShot }, (_, angleIndex) => (
        anglePresets[(angleOffset + angleIndex) % anglePresets.length]
      ))

      return {
        id: shotId,
        index: shotIndex + 1,
        beat: sanitizeSnippet(beat, 220), // Legacy field
        imageBeat: sanitizeSnippet(beat, 220), // Storyboard keyframe moment
        videoBeat: sanitizeSnippet(beat, 220), // Video action/motion beat
        durationSeconds: randomizedShotDurationSeconds(variationSeed + targetDurationSeconds, sceneIndex, shotIndex),
        takesPerAngle,
        angles,
        locked: false,
      }
    })

    return {
      id: sceneId,
      index: sceneIndex + 1,
      rawText: sceneText,
      contextText: sceneBody,
      summary: sceneSummary,
      styleNotes,
      shots,
    }
  })
}

export function flattenYoloPlanVariants(plan = []) {
  const variants = []

  for (const scene of plan || []) {
    const sceneBody = String(scene?.contextText || getSceneBodyText(scene?.rawText || scene?.summary || '')).trim()
    const strictConsistency = String(scene?.styleNotes || '').toLowerCase().includes('consistency mode: strict')

    for (const shot of scene?.shots || []) {
      const takes = Math.max(1, Number(shot?.takesPerAngle) || 1)
      const angles = Array.isArray(shot?.angles) && shot.angles.length > 0
        ? shot.angles
        : DEFAULT_ANGLE_PRESETS.slice(0, 1)
      const imageBeat = String(shot?.imageBeat || shot?.beat || '').trim()
      const videoBeat = String(shot?.videoBeat || shot?.beat || '').trim()
      const cameraDirection = String(shot?.cameraDirection || '').trim()

      for (const angle of angles) {
        for (let take = 1; take <= takes; take += 1) {
          const key = `${scene.id}|${shot.id}|${angle}|T${take}`
          const videoPrompt = [
            sceneBody ? `${sceneBody}.` : scene.summary,
            videoBeat,
            `Compose with a ${String(angle || 'medium shot').toLowerCase()} camera setup.`,
            cameraDirection ? `Camera direction: ${cameraDirection}.` : '',
            'No on-screen text, no captions, no subtitles, no labels, no watermarks.',
            strictConsistency
              ? 'Maintain strict continuity with adjacent shots: same person identity, same wardrobe, and same key props/actions from the script.'
              : 'Maintain continuity with adjacent shots and preserve key props/actions from the script.',
            scene.styleNotes,
            take > 1
              ? (
                strictConsistency
                  ? 'Create a micro-variation only (timing/expression), but keep identity, wardrobe, and staging locked.'
                  : 'Create an alternate variation while keeping staging and continuity consistent.'
              )
              : '',
          ]
            .filter(Boolean)
            .join(' ')
          const keyframeMoment = extractKeyframeMoment(imageBeat || scene?.summary || sceneBody)
          const storyboardPrompt = [
            `Single cinematic keyframe still for ${scene.id} ${shot.id}.`,
            sceneBody ? `Scene context: ${sceneBody}.` : '',
            keyframeMoment ? `Capture this exact moment: ${keyframeMoment}.` : '',
            `Camera framing: ${String(angle || 'medium shot').toLowerCase()}.`,
            cameraDirection ? `Camera treatment: ${cameraDirection}.` : '',
            'Render one image only: one frame, one moment, one continuous camera view.',
            'Do not create split-screen, collage, diptych, triptych, storyboard grid, comic panels, or multiple images in one frame.',
            'Do not depict a before/after sequence or montage in a single image.',
            'Show one primary subject instance only unless the script explicitly requires extra characters.',
            'No on-screen text, no captions, no subtitles, no labels, no watermarks.',
            strictConsistency
              ? 'Keep the same person identity and wardrobe fully locked to references.'
              : 'Keep character identity and wardrobe reasonably consistent with adjacent shots.',
            scene.styleNotes,
          ]
            .filter(Boolean)
            .join(' ')

          variants.push({
            key,
            sceneId: scene.id,
            shotId: shot.id,
            angle,
            take,
            durationSeconds: shot.durationSeconds,
            prompt: sanitizeSnippet(videoPrompt, 1100),
            videoPrompt: sanitizeSnippet(videoPrompt, 1100),
            storyboardPrompt: sanitizeSnippet(storyboardPrompt, 1100),
          })
        }
      }
    }
  }

  return variants
}

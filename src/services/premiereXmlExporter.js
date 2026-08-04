import { applySoloAsMute } from '../utils/audioTrackAudibility.js'
import { applyVideoSoloAsHidden } from '../utils/videoTrackVisibility.js'

const XMEML_VERSION = '5'
const DEFAULT_FPS = 24
const DEFAULT_AUDIO_SAMPLE_RATE = 48000
const DEFAULT_AUDIO_DEPTH = 16
const SUPPORTED_CLIP_TYPES = new Set(['video', 'audio', 'image'])

function safeNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function sanitizeName(value, fallback = 'Untitled') {
  const trimmed = String(value || '').trim()
  return trimmed || fallback
}

function sanitizeId(value, fallback = 'item') {
  const base = String(value || fallback).trim()
  return base.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^([^a-zA-Z_])/, '_$1') || fallback
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function resolveRate(value) {
  const fps = Math.max(1, safeNumber(value, DEFAULT_FPS))
  if (Math.abs(fps - 23.976) < 0.01 || Math.abs(fps - (24000 / 1001)) < 0.01) {
    return { fps: 24000 / 1001, timebase: 24, ntsc: true }
  }
  if (Math.abs(fps - 29.97) < 0.01 || Math.abs(fps - (30000 / 1001)) < 0.01) {
    return { fps: 30000 / 1001, timebase: 30, ntsc: true }
  }
  if (Math.abs(fps - 59.94) < 0.01 || Math.abs(fps - (60000 / 1001)) < 0.01) {
    return { fps: 60000 / 1001, timebase: 60, ntsc: true }
  }
  const timebase = Math.max(1, Math.round(fps))
  return { fps: timebase, timebase, ntsc: false }
}

function secondsToFrames(seconds, rate) {
  return Math.max(0, Math.round(Math.max(0, safeNumber(seconds, 0)) * rate.fps))
}

function buildRateElement(rate, indent) {
  return [
    `${indent}<rate>`,
    `${indent}  <timebase>${rate.timebase}</timebase>`,
    `${indent}  <ntsc>${rate.ntsc ? 'TRUE' : 'FALSE'}</ntsc>`,
    `${indent}</rate>`,
  ]
}

function getFileName(filePath, fallback) {
  const normalized = String(filePath || '').replace(/\\/g, '/')
  const name = normalized.split('/').filter(Boolean).pop()
  return sanitizeName(name, fallback)
}

export function filePathToPremiereUri(filePath) {
  const raw = String(filePath || '').trim()
  if (!raw) return ''

  const normalized = raw.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file://localhost/${encodeURI(normalized).replace(/#/g, '%23')}`
  }
  if (normalized.startsWith('//')) {
    return `file:${encodeURI(normalized).replace(/#/g, '%23')}`
  }
  const absolutePath = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `file://localhost${encodeURI(absolutePath).replace(/#/g, '%23')}`
}

function getClipTimeScale(clip) {
  const sourceTimeScale = safeNumber(clip?.sourceTimeScale, 0)
  const fpsScale = clip?.timelineFps && clip?.sourceFps
    ? safeNumber(clip.timelineFps, 1) / safeNumber(clip.sourceFps, 1)
    : 1
  const speed = safeNumber(clip?.speed, 1)
  return Math.max(0.0001, (sourceTimeScale > 0 ? sourceTimeScale : fpsScale) * (speed > 0 ? speed : 1))
}

function getMediaRole(clip, track, asset) {
  if (track?.type === 'audio' || clip?.type === 'audio' || asset?.type === 'audio') return 'audio'
  if (clip?.type === 'image' || asset?.type === 'image') return 'image'
  return 'video'
}

function shouldExportClip(clip, track, asset) {
  if (!clip || clip.enabled === false) return false
  if (!SUPPORTED_CLIP_TYPES.has(clip.type)) return false
  if (!asset?.absolutePath) return false
  if (track?.type === 'video' && track.visible === false) return false
  if (track?.type === 'audio' && (track.muted === true || track.visible === false)) return false
  return safeNumber(clip.duration, 0) > 0
}

function getAssetDurationSeconds(asset, clip) {
  if (clip?.type === 'image' || asset?.type === 'image') {
    return Math.max(safeNumber(clip?.duration, 5), 1 / DEFAULT_FPS)
  }
  const clipSourceDuration = safeNumber(clip?.sourceDuration, 0)
  const assetDuration = safeNumber(asset?.duration ?? asset?.settings?.duration, 0)
  return Math.max(clipSourceDuration || assetDuration || safeNumber(clip?.duration, 1), 1 / DEFAULT_FPS)
}

function getSourceRate(asset, clip, sequenceRate) {
  const sourceFps = safeNumber(
    clip?.sourceFps ?? asset?.fps ?? asset?.settings?.fps,
    sequenceRate.fps
  )
  return resolveRate(sourceFps)
}

function getSourceDimensions(asset, timelineSettings) {
  return {
    width: Math.max(1, Math.round(safeNumber(asset?.width ?? asset?.settings?.width, timelineSettings.width))),
    height: Math.max(1, Math.round(safeNumber(asset?.height ?? asset?.settings?.height, timelineSettings.height))),
  }
}

function getAudioProperties(asset) {
  const sampleRate = Math.max(1, Math.round(safeNumber(
    asset?.sampleRate ?? asset?.settings?.sampleRate,
    DEFAULT_AUDIO_SAMPLE_RATE
  )))
  const depth = Math.max(1, Math.round(safeNumber(
    asset?.bitDepth ?? asset?.settings?.bitDepth,
    DEFAULT_AUDIO_DEPTH
  )))
  const channels = Math.max(1, Math.round(safeNumber(
    asset?.channels ?? asset?.channelCount ?? asset?.settings?.channels,
    2
  )))
  return { sampleRate, depth, channels }
}

function buildVideoSampleCharacteristics(rate, width, height, indent) {
  return [
    `${indent}<samplecharacteristics>`,
    ...buildRateElement(rate, `${indent}  `),
    `${indent}  <width>${width}</width>`,
    `${indent}  <height>${height}</height>`,
    `${indent}  <anamorphic>FALSE</anamorphic>`,
    `${indent}  <pixelaspectratio>square</pixelaspectratio>`,
    `${indent}  <fielddominance>none</fielddominance>`,
    `${indent}</samplecharacteristics>`,
  ]
}

function buildFileElement({
  asset,
  clip,
  fileId,
  mediaRole,
  sequenceRate,
  timelineSettings,
  defineFile,
  indent,
}) {
  if (!defineFile) return [`${indent}<file id="${escapeXml(fileId)}"/>`]

  const sourceRate = getSourceRate(asset, clip, sequenceRate)
  const sourceDurationFrames = Math.max(secondsToFrames(getAssetDurationSeconds(asset, clip), sourceRate), 1)
  const fileName = getFileName(asset.absolutePath, asset.name || 'Media')
  const pathUrl = filePathToPremiereUri(asset.absolutePath)
  const lines = [
    `${indent}<file id="${escapeXml(fileId)}">`,
    `${indent}  <name>${escapeXml(fileName)}</name>`,
    `${indent}  <pathurl>${escapeXml(pathUrl)}</pathurl>`,
    ...buildRateElement(sourceRate, `${indent}  `),
    `${indent}  <duration>${sourceDurationFrames}</duration>`,
    `${indent}  <media>`,
  ]

  if (mediaRole === 'audio') {
    const audio = getAudioProperties(asset)
    lines.push(
      `${indent}    <audio>`,
      `${indent}      <samplecharacteristics>`,
      `${indent}        <depth>${audio.depth}</depth>`,
      `${indent}        <samplerate>${audio.sampleRate}</samplerate>`,
      `${indent}      </samplecharacteristics>`,
      `${indent}      <channelcount>${audio.channels}</channelcount>`,
      `${indent}    </audio>`
    )
  } else {
    const dimensions = getSourceDimensions(asset, timelineSettings)
    lines.push(
      `${indent}    <video>`,
      ...buildVideoSampleCharacteristics(sourceRate, dimensions.width, dimensions.height, `${indent}      `),
      `${indent}    </video>`
    )
  }

  lines.push(
    `${indent}  </media>`,
    `${indent}</file>`
  )
  return lines
}

function buildClipItem({
  item,
  sequenceRate,
  timelineSettings,
  fileIds,
  definedFiles,
  clipItemIndex,
  indent,
}) {
  const { clip, asset, mediaRole } = item
  const sourceRate = getSourceRate(asset, clip, sequenceRate)
  const timelineStart = secondsToFrames(clip.startTime, sequenceRate)
  const timelineDuration = Math.max(secondsToFrames(clip.duration, sequenceRate), 1)
  const sourceStartSeconds = Math.max(0, safeNumber(clip.trimStart, 0))
  const sourceSpanSeconds = Math.max(clip.duration * getClipTimeScale(clip), 1 / sourceRate.fps)
  const sourceStart = secondsToFrames(sourceStartSeconds, sourceRate)
  const sourceOut = Math.max(sourceStart + 1, secondsToFrames(sourceStartSeconds + sourceSpanSeconds, sourceRate))
  const clipDuration = Math.max(sourceOut - sourceStart, 1)
  const fileKey = `${asset.id}:${mediaRole}`
  const fileId = fileIds.get(fileKey)
  const defineFile = !definedFiles.has(fileKey)
  definedFiles.add(fileKey)

  const clipItemId = sanitizeId(`clipitem-${clip.id || clipItemIndex}`, `clipitem-${clipItemIndex}`)
  const name = sanitizeName(clip.name || asset.name, `Clip ${clipItemIndex}`)
  const lines = [
    `${indent}<clipitem id="${escapeXml(clipItemId)}">`,
    `${indent}  <name>${escapeXml(name)}</name>`,
    `${indent}  <enabled>TRUE</enabled>`,
    `${indent}  <duration>${clipDuration}</duration>`,
    ...buildRateElement(sourceRate, `${indent}  `),
    `${indent}  <start>${timelineStart}</start>`,
    `${indent}  <end>${timelineStart + timelineDuration}</end>`,
    `${indent}  <in>${sourceStart}</in>`,
    `${indent}  <out>${sourceOut}</out>`,
  ]

  if (mediaRole === 'image') {
    lines.push(`${indent}  <stillframe>TRUE</stillframe>`)
  }

  lines.push(
    ...buildFileElement({
      asset,
      clip,
      fileId,
      mediaRole,
      sequenceRate,
      timelineSettings,
      defineFile,
      indent: `${indent}  `,
    })
  )

  if (mediaRole === 'audio') {
    lines.push(
      `${indent}  <sourcetrack>`,
      `${indent}    <mediatype>audio</mediatype>`,
      `${indent}    <trackindex>1</trackindex>`,
      `${indent}  </sourcetrack>`
    )
  }

  lines.push(`${indent}</clipitem>`)
  return lines
}

function collectExportTracks(clips, tracks, assetsById) {
  const tracksById = new Map(tracks.map((track) => [track.id, track]))
  const orphanTracks = new Map()
  const items = clips
    .map((clip) => {
      const asset = assetsById.get(clip.assetId)
      let track = tracksById.get(clip.trackId)
      if (!track) {
        const fallbackType = clip.type === 'audio' ? 'audio' : 'video'
        const fallbackId = `velorn-orphan-${fallbackType}`
        if (!orphanTracks.has(fallbackId)) {
          orphanTracks.set(fallbackId, {
            id: fallbackId,
            name: fallbackType === 'audio' ? 'Unassigned Audio' : 'Unassigned Video',
            type: fallbackType,
          })
        }
        track = orphanTracks.get(fallbackId)
      }
      return {
        clip,
        asset,
        track,
        mediaRole: getMediaRole(clip, track, asset),
      }
    })
    .filter(({ clip, asset, track }) => shouldExportClip(clip, track, asset))

  const allTracks = [...tracks, ...orphanTracks.values()]
  const visibleVideoTracks = allTracks
    .filter((track) => track?.type === 'video' && track.visible !== false)
    .reverse()
  const audibleAudioTracks = allTracks
    .filter((track) => track?.type === 'audio' && track.muted !== true && track.visible !== false)

  const buildTrackEntries = (sourceTracks, role) => sourceTracks
    .map((track) => ({
      track,
      items: items
        .filter((item) => item.track.id === track.id && (role === 'audio'
          ? item.mediaRole === 'audio'
          : item.mediaRole !== 'audio'))
        .sort((a, b) => (
          safeNumber(a.clip.startTime, 0) - safeNumber(b.clip.startTime, 0)
          || String(a.clip.id).localeCompare(String(b.clip.id))
        )),
    }))
    .filter((entry) => entry.items.length > 0)

  return {
    videoTracks: buildTrackEntries(visibleVideoTracks, 'video'),
    audioTracks: buildTrackEntries(audibleAudioTracks, 'audio'),
    items,
  }
}

function buildTrackElements({
  trackEntries,
  sequenceRate,
  timelineSettings,
  fileIds,
  definedFiles,
  clipIndex,
  indent,
}) {
  const lines = []
  for (const entry of trackEntries) {
    lines.push(`${indent}<track>`)
    for (const item of entry.items) {
      clipIndex.value += 1
      lines.push(...buildClipItem({
        item,
        sequenceRate,
        timelineSettings,
        fileIds,
        definedFiles,
        clipItemIndex: clipIndex.value,
        indent: `${indent}  `,
      }))
    }
    lines.push(
      `${indent}  <enabled>TRUE</enabled>`,
      `${indent}  <locked>${entry.track?.locked ? 'TRUE' : 'FALSE'}</locked>`
    )
    lines.push(`${indent}</track>`)
  }
  return lines
}

export function buildPremiereXml({
  projectName = 'Velorn Project',
  timelineName = 'Timeline',
  timelineSettings = {},
  timeline = {},
  assets = [],
} = {}) {
  const sequenceRate = resolveRate(timelineSettings.fps || timeline.timelineFps || DEFAULT_FPS)
  const width = Math.max(1, Math.round(safeNumber(timelineSettings.width, 1920)))
  const height = Math.max(1, Math.round(safeNumber(timelineSettings.height, 1080)))
  const normalizedTimelineSettings = { width, height, fps: sequenceRate.fps }
  const clips = Array.isArray(timeline.clips) ? timeline.clips : []
  const tracks = applyVideoSoloAsHidden(applySoloAsMute(Array.isArray(timeline.tracks) ? timeline.tracks : []))
  const assetsById = new Map((Array.isArray(assets) ? assets : []).map((asset) => [asset.id, asset]))
  const { videoTracks, audioTracks, items } = collectExportTracks(clips, tracks, assetsById)

  const computedEnd = items.reduce((max, item) => (
    Math.max(max, safeNumber(item.clip.startTime, 0) + safeNumber(item.clip.duration, 0))
  ), 0)
  const sequenceDuration = Math.max(
    secondsToFrames(Math.max(computedEnd, safeNumber(timeline.duration, 0), 1 / sequenceRate.fps), sequenceRate),
    1
  )

  const fileIds = new Map()
  for (const item of items) {
    const fileKey = `${item.asset.id}:${item.mediaRole}`
    if (!fileIds.has(fileKey)) {
      fileIds.set(fileKey, sanitizeId(`file-${fileIds.size + 1}-${item.asset.id}`, `file-${fileIds.size + 1}`))
    }
  }

  const definedFiles = new Set()
  const clipIndex = { value: 0 }
  const videoTrackElements = buildTrackElements({
    trackEntries: videoTracks,
    sequenceRate,
    timelineSettings: normalizedTimelineSettings,
    fileIds,
    definedFiles,
    clipIndex,
    indent: '        ',
  })
  const audioTrackElements = buildTrackElements({
    trackEntries: audioTracks,
    sequenceRate,
    timelineSettings: normalizedTimelineSettings,
    fileIds,
    definedFiles,
    clipIndex,
    indent: '        ',
  })

  const sequenceId = sanitizeId(`sequence-${timelineName}`, 'sequence-1')
  const projectLabel = sanitizeName(projectName, 'Velorn Project')
  const sequenceLabel = sanitizeName(timelineName, 'Timeline')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE xmeml>',
    `<xmeml version="${XMEML_VERSION}">`,
    `  <sequence id="${escapeXml(sequenceId)}">`,
    `    <name>${escapeXml(sequenceLabel)}</name>`,
    `    <duration>${sequenceDuration}</duration>`,
    ...buildRateElement(sequenceRate, '    '),
    `    <in>-1</in>`,
    `    <out>-1</out>`,
    `    <timecode>`,
    ...buildRateElement(sequenceRate, '      '),
    `      <string>00:00:00:00</string>`,
    `      <frame>0</frame>`,
    `      <displayformat>NDF</displayformat>`,
    `    </timecode>`,
    `    <media>`,
    `      <video>`,
    `        <format>`,
    ...buildVideoSampleCharacteristics(sequenceRate, width, height, '          '),
    `        </format>`,
    ...videoTrackElements,
    `      </video>`,
    `      <audio>`,
    `        <numOutputChannels>2</numOutputChannels>`,
    `        <format>`,
    `          <samplecharacteristics>`,
    `            <depth>${DEFAULT_AUDIO_DEPTH}</depth>`,
    `            <samplerate>${DEFAULT_AUDIO_SAMPLE_RATE}</samplerate>`,
    `          </samplecharacteristics>`,
    `        </format>`,
    ...audioTrackElements,
    `      </audio>`,
    `    </media>`,
    `    <description>Exported from Velorn project: ${escapeXml(projectLabel)}</description>`,
    `  </sequence>`,
    `</xmeml>`,
    '',
  ].join('\n')
}

export default buildPremiereXml

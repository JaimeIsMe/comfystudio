import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addEdge,
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  NodeResizer,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  getSmoothStepPath,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  AudioLines,
  Check,
  CircleUserRound,
  Clapperboard,
  Edit3,
  Film,
  FolderOpen,
  Image as ImageIcon,
  ImagePlus,
  Inbox,
  LayoutPanelLeft,
  LayoutPanelTop,
  MapPin,
  MessageCircle,
  Move,
  Plus,
  RotateCcw,
  ScrollText,
  Scissors,
  Settings2,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import {
  CANVAS_BLOCK_LIBRARY,
  CANVAS_BLOCK_TYPES,
  CANVAS_CHILD_LAYOUTS,
  CANVAS_IMAGE_ASPECT_RATIOS,
  CANVAS_IMAGE_RESOLUTIONS,
  CANVAS_SHOT_CUE_TYPES,
  CANVAS_VISUAL_FAMILIES,
  CANVAS_RULES,
  canAddCanvasNode,
  canAddCanvasChild,
  canContainCanvasNode,
  canDeleteCanvasNodes,
  createCanvasDocument,
  createCanvasNode,
  createInitialCanvasDocument,
  getCanvasBlockDefinition,
  formatCanvasTime,
  isValidCanvasConnection,
  normalizeCanvasDocument,
  normalizeCanvasShotAssignments,
  parseCanvasTime,
} from '../services/canvasSchema'
import useProjectStore from '../stores/projectStore'
import useAssetsStore from '../stores/assetsStore'
import { importAsset, getProjectFileUrl, isElectron } from '../services/fileSystem'
import { comfyui } from '../services/comfyui'
import { runCanvasImageGeneration } from '../services/flowAiRuntime'
import { getImageWorkflowOptions, getTextToImageWorkflowOptions } from '../config/generateWorkflowCatalog'
import { IMPORTED_WORKFLOWS_CHANGED_EVENT } from '../config/importedWorkflowRegistry'
import { useCanvasGenerationStore } from '../stores/canvasGenerationStore'
import { LLM_AGENTS_SETTING_KEY, normalizeLlmAgentConfiguration, resolveLlmAgent } from '../services/llmAgents'
import { createCanvasChatContext } from '../services/canvasChatContext'
import CanvasChatPanel from './CanvasChatPanel'

const BLOCK_ICONS = {
  character: CircleUserRound,
  image: ImageIcon,
  characterSheet: ScrollText,
  location: MapPin,
  locationSheet: ScrollText,
  audio: AudioLines,
  timeline: Clapperboard,
  scene: FolderOpen,
  shot: Film,
  configuration: Settings2,
}

const GALLERY_CARD_WIDTH = 112
const GALLERY_CARD_HEIGHT = 72
const GALLERY_GAP = 24
const GALLERY_COLUMN_GAP = 40
const GALLERY_LABEL_HEIGHT = 30
const PROMPT_COLUMN_WIDTH = 280
const TITLE_BAR_HEIGHT = 54
const CHILD_BORDER_GAP = 20

function effectiveChildLayout(node) {
  if ([CANVAS_BLOCK_TYPES.character, CANVAS_BLOCK_TYPES.location, CANVAS_BLOCK_TYPES.timeline, CANVAS_BLOCK_TYPES.scene].includes(node?.type)) return CANVAS_CHILD_LAYOUTS.portrait
  return node?.data?.layout || CANVAS_CHILD_LAYOUTS.landscape
}

function CanvasConnectionEdge({ id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data }) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 8 })
  return (
    <>
      <BaseEdge id={id} path={edgePath} style={{ stroke: '#c084fc', strokeWidth: 2.5 }} />
      <EdgeLabelRenderer>
        <button
          type="button"
          className="nodrag nopan absolute z-50 flex h-6 w-6 items-center justify-center rounded-full border border-sf-dark-500 bg-sf-dark-900 text-sf-text-muted shadow-lg hover:border-red-400 hover:bg-red-950 hover:text-red-300"
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all' }}
          title="Delete connection"
          onClick={(event) => {
            event.stopPropagation()
            data?.onDelete?.(id)
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Scissors className="h-3.5 w-3.5" />
        </button>
      </EdgeLabelRenderer>
    </>
  )
}

function isCanvasImageAsset(asset) {
  if (!asset) return false
  if (asset.type === 'image') return true
  if (String(asset.mimeType || '').toLowerCase().startsWith('image/')) return true
  return /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(String(asset.name || asset.path || asset.url || ''))
}

function clampSize(size, minimum, fallback) {
  return {
    width: Math.max(Number(size?.width) || fallback.width, minimum.width),
    height: Math.max(Number(size?.height) || fallback.height, minimum.height),
  }
}

function imageDimensions(aspectRatio = '1:1', size = '1080p') {
  const longEdge = { '512p': 512, '720p': 720, '1080p': 1080, '2k': 2048, '4k': 3840 }[size] || 1080
  const [ratioWidth, ratioHeight] = String(aspectRatio || '1:1').split(':').map(Number)
  const safeWidth = Number(ratioWidth) > 0 ? Number(ratioWidth) : 1
  const safeHeight = Number(ratioHeight) > 0 ? Number(ratioHeight) : 1
  const width = safeWidth >= safeHeight ? longEdge : Math.round(longEdge * safeWidth / safeHeight)
  const height = safeHeight >= safeWidth ? longEdge : Math.round(longEdge * safeHeight / safeWidth)
  return {
    width: Math.max(256, Math.round(width / 8) * 8),
    height: Math.max(256, Math.round(height / 8) * 8),
  }
}

function propertyOptionLabel(definition, propertyId, value) {
  const property = definition?.properties?.find((candidate) => candidate.id === propertyId)
  return property?.options?.find((option) => option.value === value)?.label || String(value || '')
}

function getNodeMetadata(definition, data) {
  const properties = data.properties || {}
  const childCounts = data.childCounts || {}
  const totalChildren = Object.values(childCounts).reduce((total, count) => total + Number(count || 0), 0)
  if (data.kind === CANVAS_BLOCK_TYPES.configuration) return [{ label: '4 workflows' }, { label: `Agent ${data.canvasAgent?.label || 'not configured'}` }]
  if (data.kind === CANVAS_BLOCK_TYPES.character) return [
    { label: `${childCounts[CANVAS_BLOCK_TYPES.image] || 0} images` },
    { label: `${childCounts[CANVAS_BLOCK_TYPES.characterSheet] || 0} sheets` },
  ]
  if (data.kind === CANVAS_BLOCK_TYPES.location) return [
    { label: `${childCounts[CANVAS_BLOCK_TYPES.image] || 0} images` },
    { label: `${childCounts[CANVAS_BLOCK_TYPES.locationSheet] || 0} sheets` },
  ]
  if (data.kind === CANVAS_BLOCK_TYPES.timeline) {
    const metadata = [{ label: `${childCounts[CANVAS_BLOCK_TYPES.scene] || 0} scenes` }]
    if (properties.videoStyle) metadata.push({ label: propertyOptionLabel(definition, 'videoStyle', properties.videoStyle) })
    if (properties.cameraFlow) metadata.push({ label: propertyOptionLabel(definition, 'cameraFlow', properties.cameraFlow) })
    return metadata
  }
  if (data.kind === CANVAS_BLOCK_TYPES.scene) return [{ label: `${childCounts[CANVAS_BLOCK_TYPES.shot] || 0} shots` }]
  if (data.kind === CANVAS_BLOCK_TYPES.shot) {
    const duration = Math.max(0, (Number(properties.duration_end) || 0) - (Number(properties.duration_start) || 0))
    const metadata = [{ label: formatCanvasTime(duration), emphasis: true }]
    if (properties.performanceMode) metadata.push({ label: propertyOptionLabel(definition, 'performanceMode', properties.performanceMode) })
    if (properties.framing) metadata.push({ label: propertyOptionLabel(definition, 'framing', properties.framing) })
    if (properties.cameraFlow && properties.cameraFlow !== 'off') metadata.push({ label: propertyOptionLabel(definition, 'cameraFlow', properties.cameraFlow) })
    return metadata
  }
  if (data.kind === CANVAS_BLOCK_TYPES.image) return [
    { label: properties.aspectRatio || '1:1' },
    { label: String(properties.size || '1080p').toUpperCase() },
    { label: `Seed ${properties.seed ?? 1}` },
  ]
  if ([CANVAS_BLOCK_TYPES.characterSheet, CANVAS_BLOCK_TYPES.locationSheet].includes(data.kind)) {
    const referenceCount = data.sheetImages?.filter((image) => image.connected).length || 0
    return [{ label: `${referenceCount} references` }, { label: `Seed ${properties.seed ?? 1}` }]
  }
  if (data.kind === CANVAS_BLOCK_TYPES.audio) return [{ label: `Seed ${properties.seed ?? 1}` }]
  return totalChildren ? [{ label: `${totalChildren} elements` }] : []
}

function MetadataChips({ items, accent }) {
  if (!items.length) return null
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
      {items.slice(0, 4).map((item, index) => (
        <span
          key={`${item.label}-${index}`}
          className={`max-w-32 truncate rounded-full border px-1.5 py-0.5 text-[8px] leading-none ${item.emphasis ? 'font-semibold text-white' : 'text-sf-text-secondary'}`}
          style={{ borderColor: `${accent}55`, background: item.emphasis ? `${accent}55` : `${accent}12` }}
          title={item.label}
        >
          {item.label}
        </span>
      ))}
    </div>
  )
}

function PromptSurface({ prompt, label = 'Prompt', accent = '#64748b', className = '', style }) {
  return (
    <div className={`relative min-w-0 overflow-hidden border border-slate-300/90 bg-slate-50 text-slate-900 shadow-inner ${className}`} style={style}>
      <div className="flex min-h-[34px] items-center justify-between gap-2 border-b border-slate-200 bg-white/90 px-2.5 py-1.5">
        <div className="min-w-0"><div className="text-[6px] font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>Creative direction</div><div className="truncate text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-700">{label}</div></div>
        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: accent }} />
      </div>
      <div className="h-[calc(100%-34px)] overflow-hidden whitespace-pre-wrap break-words px-2.5 py-2 text-[10px] leading-4">{prompt || ''}</div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-slate-50 to-transparent" />
    </div>
  )
}

function AudioWaveform() {
  const bars = [18, 34, 24, 46, 30, 56, 38, 62, 30, 48, 22, 40, 26, 54, 36, 20]
  return (
    <div className="flex h-full items-center justify-center gap-1 px-3" aria-hidden="true">
      {bars.map((height, index) => <span key={index} className="w-1 rounded-full bg-amber-400/80" style={{ height: `${height}%` }} />)}
    </div>
  )
}

function getChildDimensions(child) {
  const definition = getCanvasBlockDefinition(child?.type)
  return clampSize(
    child?.data?.size,
    definition?.minSize || { width: 150, height: 100 },
    definition?.defaultSize || { width: 190, height: 132 },
  )
}

function getNodeDimensions(node) {
  const definition = getCanvasBlockDefinition(node?.type)
  return clampSize(
    node?.data?.size,
    definition?.minSize || { width: 150, height: 100 },
    definition?.defaultSize || { width: 190, height: 132 },
  )
}

function getGalleryGroups(children) {
  const groups = []
  for (const child of children) {
    let group = groups.find((candidate) => candidate.type === child.type)
    if (!group) {
      group = { type: child.type, children: [] }
      groups.push(group)
    }
    group.children.push(child)
  }
  return groups
}

function getFirstGalleryChild(parentDefinition, children) {
  const typeOrder = parentDefinition?.contains || []
  return [...children].sort((a, b) => {
    const aIndex = typeOrder.indexOf(a.type)
    const bIndex = typeOrder.indexOf(b.type)
    return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex)
  })[0] || null
}

function getGalleryLayout(parentDefinition, children, orientation = CANVAS_CHILD_LAYOUTS.landscape, requestedSize, resolveDimensions = getChildDimensions) {
  if (orientation === CANVAS_CHILD_LAYOUTS.freeform) {
    const sizes = children.map(resolveDimensions)
    const maxRight = children.length
      ? Math.max(...children.map((child, index) => (Number(child.position?.x) || 0) + sizes[index].width))
      : CHILD_BORDER_GAP
    const maxBottom = children.length
      ? Math.max(...children.map((child, index) => (Number(child.position?.y) || TITLE_BAR_HEIGHT + CHILD_BORDER_GAP) + sizes[index].height))
      : TITLE_BAR_HEIGHT + CHILD_BORDER_GAP
    const minimum = parentDefinition?.minSize || { width: 220, height: 120 }
    const required = {
      width: Math.max(minimum.width, maxRight + CHILD_BORDER_GAP),
      height: Math.max(minimum.height, maxBottom + CHILD_BORDER_GAP),
    }
    return {
      minWidth: required.width,
      minHeight: required.height,
      width: Math.max(required.width, Number(requestedSize?.width) || 0),
      height: Math.max(required.height, Number(requestedSize?.height) || 0),
    }
  }

  const groups = getGalleryGroups(children)
  const groupSizes = groups.map((group) => {
    const sizes = group.children.map(resolveDimensions)
    return {
      width: orientation === CANVAS_CHILD_LAYOUTS.portrait
        ? Math.max(...sizes.map((size) => size.width), GALLERY_CARD_WIDTH)
        : sizes.reduce((total, size) => total + size.width, 0) + Math.max(0, sizes.length - 1) * GALLERY_GAP,
      height: orientation === CANVAS_CHILD_LAYOUTS.portrait
        ? sizes.reduce((total, size) => total + size.height, 0) + Math.max(0, sizes.length - 1) * GALLERY_GAP
        : Math.max(...sizes.map((size) => size.height), GALLERY_CARD_HEIGHT),
    }
  })
  const hasPromptColumn = [CANVAS_BLOCK_TYPES.character, CANVAS_BLOCK_TYPES.location].includes(parentDefinition?.type)
  const contentWidth = orientation === CANVAS_CHILD_LAYOUTS.portrait
    ? groupSizes.reduce((total, size) => total + size.width, 0) + Math.max(0, groupSizes.length - 1) * GALLERY_COLUMN_GAP + (hasPromptColumn ? GALLERY_COLUMN_GAP + PROMPT_COLUMN_WIDTH : 0)
    : Math.max(...groupSizes.map((size) => size.width), GALLERY_CARD_WIDTH)
  const contentHeight = orientation === CANVAS_CHILD_LAYOUTS.portrait
    ? Math.max(...groupSizes.map((size) => size.height), GALLERY_CARD_HEIGHT)
    : groupSizes.reduce((total, size) => total + size.height, 0) + Math.max(0, groupSizes.length - 1) * GALLERY_GAP
  const minimum = parentDefinition?.minSize || { width: 220, height: 120 }
  const required = {
    width: Math.max(minimum.width, CHILD_BORDER_GAP * 2 + contentWidth),
    height: Math.max(minimum.height, TITLE_BAR_HEIGHT + CHILD_BORDER_GAP * 2 + contentHeight + (orientation === CANVAS_CHILD_LAYOUTS.portrait ? GALLERY_LABEL_HEIGHT : 0)),
  }
  return {
    minWidth: required.width,
    minHeight: required.height,
    width: Math.max(required.width, Number(requestedSize?.width) || 0),
    height: Math.max(required.height, Number(requestedSize?.height) || 0),
  }
}

function getResolvedNodeDimensions(node, allNodes, cache = new Map()) {
  if (!node) return { width: GALLERY_CARD_WIDTH, height: GALLERY_CARD_HEIGHT }
  if (cache.has(node.id)) return cache.get(node.id)
  const definition = getCanvasBlockDefinition(node.type)
  const base = getNodeDimensions(node)
  if (!definition?.contains) {
    cache.set(node.id, base)
    return base
  }
  const children = allNodes.filter((candidate) => candidate.parentId === node.id)
  const resolved = getGalleryLayout(
    definition,
    children,
    effectiveChildLayout(node),
    node.data?.size,
    (child) => getResolvedNodeDimensions(child, allNodes, cache),
  )
  cache.set(node.id, resolved)
  return resolved
}

function getFreeformPosition(index, siblings = []) {
  const column = index % 3
  const row = Math.floor(index / 3)
  const width = siblings[index - 1] ? getChildDimensions(siblings[index - 1]).width : GALLERY_CARD_WIDTH
  const height = siblings[index - 1] ? getChildDimensions(siblings[index - 1]).height : GALLERY_CARD_HEIGHT
  return {
    x: CHILD_BORDER_GAP + column * (width + GALLERY_GAP),
    y: TITLE_BAR_HEIGHT + CHILD_BORDER_GAP + row * (height + GALLERY_GAP),
  }
}

function getLeadingPromptWidth(parentDefinition) {
  if (![CANVAS_BLOCK_TYPES.character, CANVAS_BLOCK_TYPES.location].includes(parentDefinition?.type)) return 0
  return PROMPT_COLUMN_WIDTH
}

function getPortraitGroupWidths(parentDefinition, children, availableWidth, resolveDimensions = getChildDimensions) {
  const groups = getGalleryGroups(children)
  const baseWidths = groups.map((group) => Math.max(...group.children.map((child) => resolveDimensions(child).width), GALLERY_CARD_WIDTH))
  if (![CANVAS_BLOCK_TYPES.character, CANVAS_BLOCK_TYPES.location].includes(parentDefinition?.type) || !groups.length) return baseWidths
  const fixedWidth = CHILD_BORDER_GAP * 2 + PROMPT_COLUMN_WIDTH + groups.length * GALLERY_COLUMN_GAP + baseWidths.reduce((total, width) => total + width, 0)
  const extraPerGroup = Math.max(0, (Number(availableWidth) || 0) - fixedWidth) / groups.length
  return baseWidths.map((width) => width + extraPerGroup)
}

function getGalleryPosition(index, orientation = CANVAS_CHILD_LAYOUTS.landscape, siblings = [], parentDefinition = null, availableWidth = 0, resolveDimensions = getChildDimensions) {
  if (orientation === CANVAS_CHILD_LAYOUTS.freeform) return getFreeformPosition(index, siblings)

  const groups = getGalleryGroups(siblings)
  const current = siblings[index]
  const groupIndex = groups.findIndex((group) => group.type === current?.type)
  const group = groups[groupIndex] || { children: [] }
  const childIndex = group.children.findIndex((child) => child.id === current?.id)
  const precedingGroups = groups.slice(0, groupIndex)
  const portraitWidths = getPortraitGroupWidths(parentDefinition, siblings, availableWidth, resolveDimensions)
  const x = orientation === CANVAS_CHILD_LAYOUTS.portrait
    ? portraitWidths.slice(0, groupIndex).reduce((total, width) => total + width, 0) + groupIndex * GALLERY_COLUMN_GAP
    : group.children.slice(0, childIndex).reduce((total, child) => total + resolveDimensions(child).width, 0) + childIndex * GALLERY_GAP
  const y = orientation === CANVAS_CHILD_LAYOUTS.portrait
    ? group.children.slice(0, childIndex).reduce((total, child) => total + resolveDimensions(child).height, 0) + childIndex * GALLERY_GAP + GALLERY_LABEL_HEIGHT
    : precedingGroups.reduce((total, candidate) => total + Math.max(...candidate.children.map((child) => resolveDimensions(child).height), GALLERY_CARD_HEIGHT), 0) + groupIndex * GALLERY_GAP
  const promptOffset = orientation === CANVAS_CHILD_LAYOUTS.portrait
    ? getLeadingPromptWidth(parentDefinition) + (getLeadingPromptWidth(parentDefinition) ? GALLERY_COLUMN_GAP : 0)
    : 0
  return { x: CHILD_BORDER_GAP + promptOffset + x, y: TITLE_BAR_HEIGHT + CHILD_BORDER_GAP + y }
}

function getGalleryColumnLabels(parentDefinition, children, orientation, availableWidth, resolveDimensions = getChildDimensions) {
  if (orientation !== CANVAS_CHILD_LAYOUTS.portrait || !parentDefinition?.contains) return []
  const labels = []
  let x = CHILD_BORDER_GAP
  if ([CANVAS_BLOCK_TYPES.character, CANVAS_BLOCK_TYPES.location].includes(parentDefinition.type)) {
    const promptWidth = getLeadingPromptWidth(parentDefinition)
    labels.push({ label: `${parentDefinition.label} prompt`, x, width: promptWidth, prompt: true })
    x += promptWidth + GALLERY_COLUMN_GAP
  }
  const groups = getGalleryGroups(children)
  const portraitWidths = getPortraitGroupWidths(parentDefinition, children, availableWidth, resolveDimensions)
  for (const [index, group] of groups.entries()) {
    const width = portraitWidths[index]
    const definition = getCanvasBlockDefinition(group.type)
    labels.push({ label: `${definition?.label || group.type}${group.children.length === 1 ? '' : 's'}`, x, width })
    x += width + GALLERY_COLUMN_GAP
  }
  return labels
}

function reorderSceneShots(nodes, sceneId, shotId, shotPosition) {
  const shots = nodes.filter((node) => node.parentId === sceneId && node.type === CANVAS_BLOCK_TYPES.shot)
  const dragged = shots.find((node) => node.id === shotId)
  if (!dragged) return nodes
  const remaining = shots.filter((node) => node.id !== shotId)
  const draggedY = Number(shotPosition?.y) || 0
  const insertAt = remaining.findIndex((node) => draggedY < (Number(node.position?.y) || 0) + getChildDimensions(node).height / 2)
  const ordered = [...remaining]
  ordered.splice(insertAt < 0 ? ordered.length : insertAt, 0, dragged)
  const replacements = new Map(ordered.map((node, index) => [node.id, {
    ...node,
    data: { ...node.data, title: `Shot ${index + 1}` },
  }]))
  const updated = nodes.map((node) => replacements.get(node.id) || node)
  const order = new Map(ordered.map((node, index) => [node.id, index]))
  return updated.slice().sort((a, b) => {
    if (!order.has(a.id) || !order.has(b.id)) return 0
    return order.get(a.id) - order.get(b.id)
  })
}

function normalizeFreeformParent(nodes, parentId) {
  const parent = nodes.find((node) => node.id === parentId)
  const children = nodes.filter((node) => node.parentId === parentId)
  if (!parent || !children.length) return nodes

  const sizes = children.map(getChildDimensions)
  const minX = Math.min(...children.map((child) => Number(child.position?.x) || 0))
  const minY = Math.min(...children.map((child) => Number(child.position?.y) || TITLE_BAR_HEIGHT + CHILD_BORDER_GAP))
  const shiftX = minX - CHILD_BORDER_GAP
  const shiftY = minY - TITLE_BAR_HEIGHT - CHILD_BORDER_GAP
  const maxRight = Math.max(...children.map((child, index) => (Number(child.position?.x) || 0) + sizes[index].width))
  const maxBottom = Math.max(...children.map((child, index) => (Number(child.position?.y) || TITLE_BAR_HEIGHT + CHILD_BORDER_GAP) + sizes[index].height))
  const definition = getCanvasBlockDefinition(parent.type)
  const size = {
    width: Math.max(definition?.minSize?.width || 220, maxRight - shiftX + CHILD_BORDER_GAP),
    height: Math.max(definition?.minSize?.height || 120, maxBottom - shiftY + CHILD_BORDER_GAP),
  }

  return nodes.map((node) => {
    if (node.id === parentId) {
      return {
        ...node,
        position: { x: (Number(node.position?.x) || 0) + shiftX, y: (Number(node.position?.y) || 0) + shiftY },
        data: { ...node.data, size },
      }
    }
    if (node.parentId === parentId) {
      return { ...node, position: { x: (Number(node.position?.x) || 0) - shiftX, y: (Number(node.position?.y) || 0) - shiftY } }
    }
    return node
  })
}

function CanvasNode({ data, selected, dragging }) {
  const definition = getCanvasBlockDefinition(data.kind)
  const Icon = BLOCK_ICONS[definition?.icon] || Sparkles
  const accent = data.accent || '#94a3b8'
  const inputs = definition?.inputs || []
  const outputs = definition?.outputs || []
  const isImage = data.kind === CANVAS_BLOCK_TYPES.image
  const isAudio = data.kind === CANVAS_BLOCK_TYPES.audio
  const isConfiguration = data.kind === CANVAS_BLOCK_TYPES.configuration
  const isSheet = [CANVAS_BLOCK_TYPES.characterSheet, CANVAS_BLOCK_TYPES.locationSheet].includes(data.kind)
  const isShot = data.kind === CANVAS_BLOCK_TYPES.shot
  const isScene = data.kind === CANVAS_BLOCK_TYPES.scene
  const visualFamily = definition?.visualFamily || CANVAS_VISUAL_FAMILIES.asset
  const fixedVerticalLayout = [CANVAS_BLOCK_TYPES.character, CANVAS_BLOCK_TYPES.location, CANVAS_BLOCK_TYPES.timeline, CANVAS_BLOCK_TYPES.scene].includes(data.kind) || isSheet
  const isCompact = false
  const showToolbar = true
  const nodeTitle = data.title || 'Untitled'
  const [mode, setMode] = useState(data.mode || null)
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false)
  const [draft, setDraft] = useState({ title: data.title, imageMode: data.imageMode, ...(data.properties || {}) })
  const assets = useAssetsStore((state) => state.assets)
  const addAsset = useAssetsStore((state) => state.addAsset)
  const currentProjectHandle = useProjectStore((state) => state.currentProjectHandle)
  const [assetPickerOpen, setAssetPickerOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [comfyAssets, setComfyAssets] = useState([])
  const [comfyAssetsLoading, setComfyAssetsLoading] = useState(false)
  const [workflowCatalogVersion, setWorkflowCatalogVersion] = useState(0)
  const textToImageWorkflowOptions = useMemo(() => getTextToImageWorkflowOptions(), [workflowCatalogVersion])
  const imageWorkflowOptions = useMemo(() => getImageWorkflowOptions(), [workflowCatalogVersion])
  const selectedWorkflowId = data.properties?.characterImageWorkflow || data.properties?.imageGenerationWorkflow || definition?.defaults?.properties?.characterImageWorkflow || 'z-image-turbo'
  const selectedWorkflow = textToImageWorkflowOptions.find((option) => option.value === selectedWorkflowId)
  const selectedCharacterSheetWorkflowId = data.properties?.characterSheetWorkflow || definition?.defaults?.properties?.characterSheetWorkflow || 'image-edit'
  const selectedCharacterSheetWorkflow = imageWorkflowOptions.find((option) => option.value === selectedCharacterSheetWorkflowId)
  const generationWorkflowId = data.generationWorkflowId || 'z-image-turbo'
  const addGenerationJob = useCanvasGenerationStore((state) => state.addJob)
  const updateGenerationJob = useCanvasGenerationStore((state) => state.updateJob)
  const selectedAsset = [...assets, ...comfyAssets].find((asset) => asset.id === (draft.assetId || data.assetId)) || (data.assetUrl ? { id: data.assetId, name: data.assetName, url: data.assetUrl } : null)
  const computedShotDuration = isShot
    ? Math.max(0, (Math.max(0, Number(draft.duration_end) || 0) - Math.max(0, Number(draft.duration_start) || 0)) / 1000)
    : null
  const quickEditProperties = (definition?.properties || []).filter((property) => property.inToolbar)
  const metadata = getNodeMetadata(definition, data)
  const isSelected = Boolean(selected || data.selected)
  const familyShellClass = {
    [CANVAS_VISUAL_FAMILIES.organization]: 'rounded-2xl border-dashed bg-sf-dark-950/90 shadow-lg shadow-black/20',
    [CANVAS_VISUAL_FAMILIES.production]: 'rounded-xl border-solid bg-sf-dark-900 shadow-2xl shadow-black/45',
    [CANVAS_VISUAL_FAMILIES.subject]: 'rounded-2xl border-solid bg-sf-dark-900 shadow-xl shadow-black/35',
    [CANVAS_VISUAL_FAMILIES.asset]: 'rounded-lg border-solid bg-sf-dark-900 shadow-lg shadow-black/30',
    [CANVAS_VISUAL_FAMILIES.system]: 'rounded-xl border-dashed bg-sf-dark-950 shadow-xl shadow-black/30',
  }[visualFamily]
  const updateQuickProperty = (property, value) => data.onUpdate?.(data.nodeId, { properties: { ...(data.properties || {}), [property.id]: value } })

  useEffect(() => {
    setMode(data.mode || null)
  }, [data.mode])

  useEffect(() => {
    if (mode === 'edit') setDraft({ title: data.title, imageMode: data.imageMode, ...(data.properties || {}) })
  }, [data.properties, data.title, mode])

  useEffect(() => {
    const refreshWorkflowOptions = () => setWorkflowCatalogVersion((version) => version + 1)
    window.addEventListener(IMPORTED_WORKFLOWS_CHANGED_EVENT, refreshWorkflowOptions)
    return () => window.removeEventListener(IMPORTED_WORKFLOWS_CHANGED_EVENT, refreshWorkflowOptions)
  }, [])

  useEffect(() => {
    if (!assetPickerOpen || !isImage) return undefined
    let cancelled = false
    setComfyAssetsLoading(true)
    comfyui.getHistory().then((history) => {
      const found = new Map()
      Object.values(history || {}).forEach((entry) => {
        Object.values(entry?.outputs || {}).forEach((output) => {
          ;(output?.images || []).forEach((image) => {
            if (!image?.filename) return
            const key = `${image.type || 'output'}:${image.subfolder || ''}:${image.filename}`
            found.set(key, {
              id: `comfy:${key}`,
              name: image.filename,
              url: comfyui.getMediaUrl(image.filename, image.subfolder || '', image.type || 'output'),
              comfyFilename: image.filename,
              comfySubfolder: image.subfolder || '',
              comfyType: image.type || 'output',
              source: 'comfyui',
              type: 'image',
            })
          })
        })
      })
      if (!cancelled) setComfyAssets([...found.values()].reverse())
    }).catch((error) => {
      if (!cancelled) console.warn('Could not load ComfyUI image gallery', error)
    }).finally(() => {
      if (!cancelled) setComfyAssetsLoading(false)
    })
    return () => { cancelled = true }
  }, [assetPickerOpen, isImage])

  const updateDraft = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
  const setNodeMode = (next) => {
    setMode(next)
    data.onModeChange?.(data.nodeId, next)
  }
  const persistDraft = () => {
    const persistedProperties = Object.fromEntries((definition?.properties || []).map((property) => [property.id, draft[property.id] ?? '']))
    if (isShot) persistedProperties.duration = computedShotDuration
    data.onUpdate?.(data.nodeId, {
      title: draft.title,
      properties: persistedProperties,
      ...(isImage ? { imageMode: draft.imageMode || 'create-from-prompt' } : {}),
      ...(isImage ? { assetId: draft.assetId || null } : {}),
      ...(isImage ? { assetUrl: selectedAsset?.url || null, assetName: selectedAsset?.name || null, assetSource: selectedAsset?.source || 'project' } : {}),
      ...(isSheet ? { assetId: draft.assetId || data.assetId || null, assetUrl: selectedAsset?.url || null, assetName: selectedAsset?.name || null, assetSource: selectedAsset?.source || 'generated' } : {}),
    })
  }
  const saveDraft = () => {
    persistDraft()
    setNodeMode(null)
  }
  const closeDraft = () => {
    setNodeMode(null)
    setDraft({ title: data.title, imageMode: data.imageMode, ...(data.properties || {}) })
  }

  const handlePropertyChange = (property, event) => {
    if (property.type === 'readonly') return
    if (property.type === 'checkbox') updateDraft(property.id, event.target.checked)
    else if (property.type === 'timecode') {
      const value = parseCanvasTime(event.target.value)
      if (value == null) return
      setDraft((current) => {
        const next = { ...current, [property.id]: value }
        if (isShot) {
          const start = Math.max(0, Number(next.duration_start) || 0)
          const end = Math.max(start, Number(next.duration_end) || start)
          next.duration = (end - start) / 1000
        }
        return next
      })
    } else if (property.type === 'number') {
      const value = event.target.value === '' ? null : Number(event.target.value)
      setDraft((current) => {
        const next = { ...current, [property.id]: value }
        if (isShot && (property.id === 'duration_start' || property.id === 'duration_end')) {
          const start = Math.max(0, Number(next.duration_start) || 0)
          const end = Math.max(start, Number(next.duration_end) || start)
          next.duration = (end - start) / 1000
        }
        return next
      })
    } else updateDraft(property.id, event.target.value)
  }

  const shotStartMs = Math.max(0, Number(draft.duration_start) || 0)
  const shotEndMs = Math.max(shotStartMs, Number(draft.duration_end) || shotStartMs)
  const shotAssignments = normalizeCanvasShotAssignments(draft.characterAssignments, shotStartMs, shotEndMs)
  const updateShotAssignments = (nextAssignments) => updateDraft('characterAssignments', normalizeCanvasShotAssignments(nextAssignments, shotStartMs, shotEndMs))
  const assignmentForCharacter = (characterId) => shotAssignments.find((assignment) => assignment.characterId === characterId) || { characterId, cues: [] }
  const updateCharacterCues = (characterId, cues) => {
    const existing = shotAssignments.filter((assignment) => assignment.characterId !== characterId)
    updateShotAssignments([...existing, { characterId, cues }])
  }

  const selectAsset = (asset) => {
    updateDraft('assetId', asset.id)
    updateDraft('imageMode', 'pick-from-comfy')
    setAssetPickerOpen(false)
  }

  const generateImage = async () => {
    if (generating || !generationWorkflowId) return
    const dimensions = imageDimensions(draft.aspectRatio, draft.size)
    persistDraft()
    const jobId = addGenerationJob({
      title: draft.title || 'Canvas image',
      workflowId: generationWorkflowId,
      statusMessage: `Queueing ${textToImageWorkflowOptions.find((option) => option.value === generationWorkflowId)?.label || generationWorkflowId}…`,
    })
    setGenerating(true)
    try {
      const result = await runCanvasImageGeneration({
        workflowId: generationWorkflowId,
        prompt: draft.prompt,
        width: dimensions.width,
        height: dimensions.height,
        seed: draft.seed,
        documentId: `canvas:${data.nodeId}`,
        onStatus: (status) => updateGenerationJob(jobId, {
          status: status?.status === 'checking' ? 'queued' : status?.status === 'done' ? 'completed' : 'running',
          statusMessage: status?.statusMessage || 'Generating…',
        }),
      })
      const generatedAsset = useAssetsStore.getState().assets.find((asset) => result.importedAssetIds?.includes(asset.id))
      if (!generatedAsset) throw new Error('Generation completed without an imported image asset.')
      data.onUpdate?.(data.nodeId, {
        assetId: generatedAsset.id,
        assetUrl: generatedAsset.url || null,
        assetName: generatedAsset.name || null,
        assetSource: 'generated',
        imageMode: 'create-from-prompt',
      })
      updateGenerationJob(jobId, { status: 'completed', statusMessage: 'Image generated and added to the Canvas.' })
    } catch (error) {
      updateGenerationJob(jobId, { status: 'failed', statusMessage: 'Image generation failed.', error: error instanceof Error ? error.message : String(error) })
    } finally {
      setGenerating(false)
    }
  }

  const generateCharacterSheet = async () => {
    if (generating || !data.generationSheetWorkflowId || !String(draft.prompt || '').trim()) return
    persistDraft()
    const references = (data.sheetImages || []).filter((image) => image.connected && image.url).map((image) => ({ id: image.assetId || image.id, name: image.name, url: image.url, type: 'image' }))
    const sheetLabel = data.kind === CANVAS_BLOCK_TYPES.locationSheet ? 'Location sheet' : 'Character sheet'
    const jobId = addGenerationJob({ title: sheetLabel, workflowId: data.generationSheetWorkflowId, statusMessage: `Queueing ${sheetLabel.toLowerCase()}…` })
    setGenerating(true)
    try {
      const result = await runCanvasImageGeneration({
        workflowId: data.generationSheetWorkflowId,
        prompt: draft.prompt,
        seed: draft.seed,
        referenceAssets: references,
        documentId: `canvas:${data.nodeId}`,
        onStatus: (status) => updateGenerationJob(jobId, { status: status?.status === 'checking' ? 'queued' : status?.status === 'done' ? 'completed' : 'running', statusMessage: status?.statusMessage || `Generating ${sheetLabel.toLowerCase()}…` }),
      })
      const generatedAsset = useAssetsStore.getState().assets.find((asset) => result.importedAssetIds?.includes(asset.id))
      if (!generatedAsset) throw new Error(`Generation completed without an imported ${sheetLabel.toLowerCase()} image.`)
      data.onUpdate?.(data.nodeId, { assetId: generatedAsset.id, assetUrl: generatedAsset.url || null, assetName: generatedAsset.name || null, assetSource: 'generated' })
      updateGenerationJob(jobId, { status: 'completed', statusMessage: `${sheetLabel} generated and added to the Canvas.` })
    } catch (error) {
      updateGenerationJob(jobId, { status: 'failed', statusMessage: `${sheetLabel} generation failed.`, error: error instanceof Error ? error.message : String(error) })
    } finally {
      setGenerating(false)
    }
  }

  const chooseComputerImage = async () => {
    if (!currentProjectHandle || uploading) return
    let file = null
    if (isElectron() && window.electronAPI?.selectFile) {
      file = await window.electronAPI.selectFile({ title: 'Select Canvas image', filters: [{ name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'] }] })
    } else {
      file = await new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*'
        input.onchange = () => resolve(input.files?.[0] || null)
        input.click()
      })
    }
    if (!file) return
    if (typeof file === 'string' && window.electronAPI?.readFileAsBuffer) {
      const bufferResult = await window.electronAPI.readFileAsBuffer(file)
      if (!bufferResult?.success || !bufferResult.data) return
      const name = file.split(/[\\/]/).pop() || `canvas_image_${Date.now()}.png`
      file = new File([bufferResult.data], name, { type: `image/${name.split('.').pop()?.toLowerCase() === 'jpg' ? 'jpeg' : name.split('.').pop()?.toLowerCase() || 'png'}` })
    }
    setUploading(true)
    try {
      const uploadResult = await comfyui.uploadFile(file)
      const assetInfo = await importAsset(currentProjectHandle, file, 'images')
      const asset = addAsset({ ...assetInfo, type: 'image', url: URL.createObjectURL(file), isImported: true, comfyFilename: uploadResult?.name || file.name })
      selectAsset(asset)
    } catch (error) {
      console.error('Canvas image upload failed', error)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div
      className={`group relative ${isCompact ? 'min-w-0' : 'min-w-[150px]'} ${familyShellClass} h-full w-full overflow-visible border transition-[box-shadow,border-color,transform,opacity] duration-150 ${isSelected ? 'ring-2 ring-offset-2 ring-offset-sf-dark-950' : ''} ${dragging ? 'scale-[1.015] opacity-90' : ''} ${data.dropState === 'valid' ? '!border-emerald-400 ring-2 ring-emerald-400/80' : ''} ${data.dropState === 'invalid' ? '!border-red-400 ring-2 ring-red-400/80' : ''}`}
      style={{ borderColor: isSelected ? accent : `${accent}66`, '--tw-ring-color': data.dropState === 'valid' ? '#34d399' : data.dropState === 'invalid' ? '#f87171' : accent }}
    >
      <div className="pointer-events-none absolute bottom-2 left-0 top-2 z-10 w-1 rounded-r-full" style={{ background: accent, boxShadow: `0 0 14px ${accent}55` }} />
      {isConfiguration && <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] opacity-[0.07]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.3) 1px, transparent 1px)', backgroundSize: '14px 14px' }} />}
      {isShot && <div className="pointer-events-none absolute inset-x-4 top-0 h-1 opacity-70" style={{ backgroundImage: `repeating-linear-gradient(90deg, ${accent} 0 7px, transparent 7px 13px)` }} />}
      <NodeResizer
        nodeId={data.nodeId}
        minWidth={data.minWidth}
        minHeight={data.minHeight}
        color={accent}
        handleClassName="!h-2 !w-2 !rounded-sm opacity-0 group-hover:opacity-100"
        lineClassName="!border-sf-accent/50 opacity-0 group-hover:opacity-100"
        onResizeEnd={(_, params) => data.onResize?.(data.nodeId, params)}
      />

      {showToolbar && (
        <div className={`nodrag nopan absolute -top-[3.25rem] left-3 right-3 z-30 flex min-h-11 items-end justify-between gap-3 rounded-lg border border-sf-dark-500/70 bg-sf-dark-950/80 px-2 py-1.5 opacity-0 shadow-2xl shadow-black/40 backdrop-blur-xl transition-all duration-150 group-hover:opacity-100 ${isSelected ? 'opacity-100' : ''}`} style={{ borderBottomColor: accent }}>
          <div className="flex min-w-0 items-end gap-2 overflow-x-auto">
            {quickEditProperties.map((property) => (
              <label key={property.id} className="flex min-w-24 flex-col gap-0.5 text-[7px] font-semibold uppercase tracking-[0.12em] text-sf-text-muted">
                <span className="truncate">{property.label}</span>
                <select value={data.properties?.[property.id] ?? property.defaultValue ?? ''} onChange={(event) => updateQuickProperty(property, event.target.value)} className="max-w-36 rounded border border-sf-dark-500 bg-sf-dark-800/90 px-1.5 py-1 text-[9px] font-normal normal-case tracking-normal text-sf-text-primary outline-none focus:border-sf-accent">
                  {(property.options || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1 border-l border-sf-dark-600 pl-2">
          {definition?.contains && (
            <div className="relative">
              <button type="button" onClick={() => setIsAddMenuOpen((current) => !current)} className="rounded-md p-1.5 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary" title="Add child element">
                <Plus className="h-3.5 w-3.5" />
              </button>
              {isAddMenuOpen && (
                <div className="absolute right-0 top-8 z-30 min-w-36 rounded-lg border border-sf-dark-600 bg-sf-dark-900 p-1 shadow-2xl">
                  {definition.contains.map((childType) => {
                    const childDefinition = getCanvasBlockDefinition(childType)
                    const ChildIcon = BLOCK_ICONS[childDefinition?.icon] || Sparkles
                    const canAddChild = data.childAvailability?.[childType] !== false
                    return (
                      <button
                        key={childType}
                        type="button"
                        disabled={!canAddChild}
                        title={canAddChild ? `Add ${childDefinition?.label}` : 'Add or generate an image first'}
                        onClick={() => {
                          if (!canAddChild) return
                          data.onAddChild?.(data.nodeId, childType)
                          setIsAddMenuOpen(false)
                        }}
                        className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[10px] text-sf-text-secondary hover:bg-sf-dark-700 hover:text-sf-text-primary disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
                      >
                        <ChildIcon className="h-3 w-3" /> {childDefinition?.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          {definition?.contains && !fixedVerticalLayout && (
            <button type="button" onClick={() => data.onToggleLayout?.(data.nodeId)} className="rounded-md p-1.5 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary" title={`Use ${data.layout === CANVAS_CHILD_LAYOUTS.landscape ? 'vertical' : data.layout === CANVAS_CHILD_LAYOUTS.portrait ? 'freeform' : 'horizontal'} child layout`}>
              {data.layout === CANVAS_CHILD_LAYOUTS.portrait ? <LayoutPanelTop className="h-3.5 w-3.5" /> : data.layout === CANVAS_CHILD_LAYOUTS.freeform ? <Move className="h-3.5 w-3.5" /> : <LayoutPanelLeft className="h-3.5 w-3.5" />}
            </button>
          )}
          <button type="button" onClick={() => setNodeMode('edit')} className="rounded-md p-1.5 text-sf-text-muted hover:bg-sf-dark-700 hover:text-sf-text-primary" title="Edit node">
            <Edit3 className="h-3.5 w-3.5" />
          </button>
          {!definition?.fixed && <button type="button" onClick={() => data.onDeleteNode?.(data.nodeId)} className="rounded-md p-1.5 text-sf-text-muted hover:bg-red-950/60 hover:text-red-300" title="Delete node"><Trash2 className="h-3.5 w-3.5" /></button>}
          </div>
        </div>
      )}

      {inputs.map((handle, index) => (
        <Handle key={`input-${handle.id}`} id={handle.id} type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-sf-dark-950" style={{ top: `${((index + 1) / (inputs.length + 1)) * 100}%`, background: accent }}>
          <span className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-sf-dark-500 bg-sf-dark-950/95 px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-sf-text-secondary shadow-lg transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>{handle.label}</span>
        </Handle>
      ))}

      <div className={`relative flex min-h-[54px] items-center justify-between gap-3 overflow-hidden border-b px-3 py-2 pl-4 ${visualFamily === CANVAS_VISUAL_FAMILIES.organization ? 'border-dashed' : ''}`} style={{ borderColor: `${accent}44`, background: `linear-gradient(110deg, ${accent}20, rgba(15,23,42,.72) 55%, rgba(15,23,42,.94))` }}>
        <div className="flex min-w-0 items-center gap-2.5">
          <div className={`flex flex-shrink-0 items-center justify-center border ${isScene ? 'h-8 w-9 rounded-md border-dashed' : data.kind === CANVAS_BLOCK_TYPES.character ? 'h-8 w-8 rounded-full' : data.kind === CANVAS_BLOCK_TYPES.location ? 'h-7 w-10 rounded-md' : 'h-8 w-8 rounded-lg'}`} style={{ borderColor: `${accent}66`, background: `${accent}18`, color: accent }}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[7px] font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>{definition?.label || data.detail}</div>
            <div className="truncate text-[11px] font-semibold leading-4 text-sf-text-primary" title={nodeTitle}>{nodeTitle}</div>
          </div>
        </div>
        <MetadataChips items={metadata} accent={accent} />
      </div>

      {isImage ? (
        <div className="flex h-[calc(100%-54px)] min-h-[100px] items-center justify-center overflow-hidden rounded-b-lg bg-black/70 p-2" title="Source image">
          {selectedAsset?.url
            ? <img src={selectedAsset.url} alt={selectedAsset.name || 'Canvas image'} className="h-full w-full rounded-md object-contain" />
            : <div className="flex h-full w-full items-center justify-center rounded-md border border-dashed border-sf-dark-600 bg-sf-dark-950/70"><ImageIcon className="h-8 w-8" style={{ color: accent }} /></div>}
        </div>
      ) : isConfiguration ? (
        <div className="grid min-h-[calc(100%-54px)] grid-cols-2 gap-2 rounded-b-xl p-2" title={selectedWorkflow?.label || selectedWorkflowId || 'Image generation workflow'}>
          {[
            ['Character image', selectedWorkflow?.label || selectedWorkflowId || 'Not selected'],
            ['Character sheet', selectedCharacterSheetWorkflow?.label || selectedCharacterSheetWorkflowId || 'Not selected'],
            ['Location image', textToImageWorkflowOptions.find((option) => option.value === (data.properties?.locationImageWorkflow || 'z-image-turbo'))?.label || data.properties?.locationImageWorkflow || 'z-image-turbo'],
            ['Location sheet', imageWorkflowOptions.find((option) => option.value === (data.properties?.locationSheetWorkflow || 'image-edit'))?.label || data.properties?.locationSheetWorkflow || 'image-edit'],
          ].map(([label, value]) => <div key={label} className="min-w-0 rounded-md border border-orange-400/20 bg-orange-400/[0.06] px-2 py-1.5"><div className="text-[7px] font-semibold uppercase tracking-[0.14em] text-orange-300/70">{label}</div><div className="truncate pt-0.5 text-[9px] text-sf-text-primary">{value}</div></div>)}
        </div>
      ) : isSheet ? (
        <div className="flex h-[calc(100%-54px)] min-h-[70px] items-center justify-center overflow-hidden rounded-b-lg bg-black/60 p-2">
          {selectedAsset?.url
            ? <img src={selectedAsset.url} alt={selectedAsset.name || definition?.label || 'Sheet image'} className="h-full w-full rounded-md object-contain" />
            : <div className="relative flex h-full w-full items-center justify-center rounded-md border border-dashed border-sf-dark-600 bg-sf-dark-950/60">
              <div className="absolute h-[62%] w-[42%] translate-x-3 -rotate-3 rounded border border-sf-dark-500 bg-sf-dark-700" />
              <div className="absolute h-[68%] w-[46%] translate-x-1 rotate-2 rounded border border-sf-dark-500 bg-sf-dark-800" />
              <div className="relative flex h-[74%] w-[50%] flex-col items-center justify-center rounded border bg-sf-dark-900 shadow-xl" style={{ borderColor: `${accent}77` }}>
                <ScrollText className="h-5 w-5" style={{ color: accent }} />
                <span className="mt-1 text-[8px] font-semibold text-sf-text-secondary">{data.sheetImages?.filter((image) => image.connected).length || 0}</span>
              </div>
            </div>
          }
        </div>
      ) : isAudio ? (
        <div className="grid h-[calc(100%-54px)] min-h-[70px] grid-cols-[minmax(90px,.9fr)_minmax(0,1.1fr)] gap-2 rounded-b-lg bg-sf-dark-950/50 p-2">
          <div className="overflow-hidden rounded-md border border-amber-400/25 bg-gradient-to-br from-amber-400/10 to-sf-dark-950"><AudioWaveform /></div>
          <PromptSurface prompt={data.properties?.prompt} label="Audio prompt" accent={accent} className="h-full rounded-md" />
        </div>
      ) : isShot ? (
        <div className="grid min-h-[calc(100%-54px)] grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-2 rounded-b-xl bg-sf-dark-950/55 p-2">
          <PromptSurface prompt={data.properties?.prompt} label="Shot prompt" accent={accent} className="h-full rounded-lg" />
          <div className="min-w-0 space-y-1.5 overflow-hidden rounded-lg border border-sf-dark-600/80 bg-sf-dark-900/80 p-2 shadow-inner">
            <div className="border-b border-sf-dark-700 pb-1.5 text-[8px] font-semibold uppercase tracking-[0.16em] text-sf-text-muted">Used elements</div>
            <div className="text-[8px] font-semibold uppercase tracking-wide text-sf-text-muted">Location</div>
            <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-sf-dark-600 bg-sf-dark-950/70 p-1 shadow-sm">
              <div className="flex h-9 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-sf-dark-800">
                {data.shotReferences?.location?.url
                  ? <img src={data.shotReferences.location.url} alt={data.shotReferences.location.name || 'Location'} className="h-full w-full object-cover" />
                  : <MapPin className="h-4 w-4 text-sf-text-muted/60" />}
              </div>
              <span className="min-w-0 truncate text-[9px] text-sf-text-secondary">{data.shotReferences?.location?.name || ''}</span>
            </div>
            <div className="pt-2 text-[8px] font-semibold uppercase tracking-wide text-sf-text-muted">Characters</div>
            <div className="grid grid-cols-3 gap-1">
              {(data.shotReferences?.characters || []).map((character) => (
                <div key={character.id} className="min-w-0" title={character.name}>
                  <div className="flex h-10 items-center justify-center overflow-hidden rounded-md border border-sf-dark-600 bg-sf-dark-950 shadow-sm">
                    {character.url ? <img src={character.url} alt={character.name || 'Character'} className="h-full w-full object-cover" /> : <CircleUserRound className="h-4 w-4 text-sf-text-muted/60" />}
                  </div>
                  <div className="truncate pt-0.5 text-[8px] text-sf-text-muted">{character.name}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : definition?.contains && data.childCount > 0 ? (
        <div className={`relative h-[calc(100%-54px)] min-h-[60px] overflow-hidden rounded-b-[inherit] ${visualFamily === CANVAS_VISUAL_FAMILIES.organization ? 'bg-slate-900/45' : 'bg-sf-dark-950/35'}`}>
          {visualFamily === CANVAS_VISUAL_FAMILIES.organization && <div className="pointer-events-none absolute bottom-3 left-4 top-3 w-px bg-gradient-to-b from-transparent via-sky-400/50 to-transparent" />}
          {(data.galleryColumnLabels || []).filter((column) => !column.prompt).map((column) => (
            <div key={column.label} className="pointer-events-none absolute bottom-2 top-2 overflow-hidden rounded-xl border border-sf-dark-500/70 bg-sf-dark-950/55 shadow-inner" style={{ left: column.x, width: column.width }}>
              <div className="min-h-[30px] border-b border-sf-dark-600/80 bg-sf-dark-800/90 px-2.5 py-1"><div className="text-[6px] font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>Child nodes</div><div className="truncate text-[8px] font-semibold uppercase tracking-[0.12em] text-sf-text-secondary">{column.label}</div></div>
            </div>
          ))}
          {data.promptColumn && <PromptSurface prompt={data.properties?.prompt} label={data.promptColumn.label} accent={accent} className="absolute bottom-2 top-2 rounded-xl border-2 shadow-lg shadow-black/20" style={{ left: data.promptColumn.x, width: data.promptColumn.width, borderColor: `${accent}88` }} />}
        </div>
      ) : definition?.contains && data.childCount === 0 ? (
        <div className="flex h-[calc(100%-54px)] min-h-[60px] items-center justify-center rounded-b-lg" title="Empty">
          <Inbox className="h-7 w-7 text-sf-text-muted/60" />
        </div>
      ) : (
        <div className="min-h-[60px] rounded-b-lg" />
      )}

      {mode && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="relative flex max-h-[96vh] w-full max-w-[96vw] min-h-[760px] flex-col overflow-hidden rounded-xl border border-sf-dark-500 bg-sf-dark-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-sf-dark-700 px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em] text-sf-text-muted">
              {mode === 'add' ? 'Add' : 'Edit'} {definition?.label}
              <button type="button" onClick={closeDraft} className="rounded p-1 hover:bg-sf-dark-800 hover:text-sf-text-primary" title="Close without saving"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col p-5">
              {!isSheet && !isShot && <input value={draft.title || ''} onChange={(event) => updateDraft('title', event.target.value)} className="mb-4 w-full rounded border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-sm text-sf-text-primary outline-none focus:border-sf-accent" placeholder="Title" />}
              {isImage ? (
                <div className="grid min-h-0 flex-1 grid-cols-2 gap-5">
                  <div className="flex min-h-0 flex-col">
                    <label className="mb-2 text-xs font-medium text-sf-text-secondary">Prompt</label>
                    <textarea value={draft.prompt ?? ''} onChange={(event) => handlePropertyChange({ id: 'prompt', type: 'textarea' }, event)} className="min-h-[180px] flex-1 resize-none rounded border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-sm leading-5 text-sf-text-primary outline-none focus:border-sf-accent" placeholder="Describe the image" />
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <label className="text-[10px] text-sf-text-secondary"><span className="mb-1 block">Seed</span><input type="number" value={draft.seed ?? 1} onChange={(event) => handlePropertyChange({ id: 'seed', type: 'number' }, event)} className="w-full rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-1.5 text-[11px] text-sf-text-primary outline-none focus:border-sf-accent" /></label>
                      <label className="text-[10px] text-sf-text-secondary"><span className="mb-1 block">Aspect ratio</span><select value={draft.aspectRatio || '1:1'} onChange={(event) => updateDraft('aspectRatio', event.target.value)} className="w-full rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-1.5 text-[11px] text-sf-text-primary outline-none focus:border-sf-accent">{CANVAS_IMAGE_ASPECT_RATIOS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                      <label className="text-[10px] text-sf-text-secondary"><span className="mb-1 block">Size</span><select value={draft.size || '1080p'} onChange={(event) => updateDraft('size', event.target.value)} className="w-full rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-1.5 text-[11px] text-sf-text-primary outline-none focus:border-sf-accent">{CANVAS_IMAGE_RESOLUTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => setAssetPickerOpen(true)} className="rounded border border-sf-dark-600 px-2 py-1.5 text-[10px] text-sf-text-secondary hover:bg-sf-dark-800"><ImageIcon className="mr-1 inline h-3 w-3" /> Select from Comfy assets</button>
                      <button type="button" onClick={chooseComputerImage} disabled={uploading} className="rounded border border-sf-dark-600 px-2 py-1.5 text-[10px] text-sf-text-secondary hover:bg-sf-dark-800"><ImagePlus className="mr-1 inline h-3 w-3" /> {uploading ? 'Uploading…' : 'Upload from computer'}</button>
                      <button type="button" onClick={generateImage} disabled={generating || !generationWorkflowId} className="rounded bg-sf-accent px-2 py-1.5 text-[10px] font-medium text-white hover:bg-sf-accent/90 disabled:cursor-not-allowed disabled:opacity-50"><Wand2 className="mr-1 inline h-3 w-3" /> {generating ? 'Generating…' : 'Generate image'}</button>
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-col">
                    <label className="mb-2 text-xs font-medium text-sf-text-secondary">Image preview</label>
                    <div className="flex min-h-[220px] flex-1 items-center justify-center overflow-hidden rounded-lg border border-dashed border-sf-dark-600 bg-sf-dark-900">
                      {selectedAsset?.url ? <img src={selectedAsset.url} alt={selectedAsset.name || 'Selected Canvas image'} className="max-h-full max-w-full object-contain" /> : <ImageIcon className="h-16 w-16 text-sf-text-muted/40" />}
                    </div>
                    <div className="mt-2 truncate text-[10px] text-sf-text-muted">{selectedAsset?.name || 'No image selected'}</div>
                  </div>
                </div>
              ) : isSheet ? (
                <div className="grid min-h-0 flex-1 grid-cols-2 gap-5">
                  <div className="flex min-h-0 flex-col gap-3">
                    <label className="text-xs font-medium text-sf-text-secondary"><span className="mb-2 block">Prompt</span><textarea value={draft.prompt ?? ''} onChange={(event) => handlePropertyChange({ id: 'prompt', type: 'textarea' }, event)} className="h-24 w-full resize-y rounded border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-sm leading-5 text-sf-text-primary outline-none focus:border-sf-accent" placeholder="Describe the character sheet" /></label>
                    <label className="text-xs font-medium text-sf-text-secondary"><span className="mb-2 block">Seed</span><input type="number" value={draft.seed ?? 1} onChange={(event) => handlePropertyChange({ id: 'seed', type: 'number' }, event)} className="w-full rounded border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-sm text-sf-text-primary outline-none focus:border-sf-accent" /></label>
                    <label className="mb-2 mt-2 text-xs font-medium text-sf-text-secondary">Generated {data.kind === CANVAS_BLOCK_TYPES.locationSheet ? 'location sheet' : 'character sheet'}</label>
                    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-dashed border-sf-dark-600 bg-sf-dark-900 p-2">
                      {selectedAsset?.url ? <img src={selectedAsset.url} alt={selectedAsset.name || 'Generated character sheet'} className="max-h-full max-w-full object-contain" /> : <div className="text-xs text-sf-text-muted">Generated character sheet preview</div>}
                    </div>
                    <button type="button" onClick={generateCharacterSheet} disabled={generating || !String(draft.prompt || '').trim()} className="self-start rounded bg-sf-accent px-3 py-2 text-xs font-medium text-white hover:bg-sf-accent/90 disabled:cursor-not-allowed disabled:opacity-50"><Wand2 className="mr-1 inline h-3.5 w-3.5" />{generating ? 'Generating…' : `Generate ${data.kind === CANVAS_BLOCK_TYPES.locationSheet ? 'location' : 'character'} sheet`}</button>
                  </div>
                  <div className="flex min-h-0 flex-col">
                      <label className="mb-2 text-xs font-medium text-sf-text-secondary">{data.kind === CANVAS_BLOCK_TYPES.locationSheet ? 'Location images' : 'Character images'}</label>
                      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-lg border border-sf-dark-700 bg-sf-dark-900 p-2">
                        {(data.sheetImages || []).length === 0 && <div className="p-3 text-xs text-sf-text-muted">No images in this character.</div>}
                        {(data.sheetImages || []).map((image) => (
                          <div key={image.id} className="flex items-center gap-2 rounded border border-sf-dark-700 bg-sf-dark-800 p-1.5">
                            <div className="h-12 w-16 flex-shrink-0 overflow-hidden rounded bg-black">{image.url ? <img src={image.url} alt={image.name || ''} className="h-full w-full object-contain" /> : <ImageIcon className="m-3 h-6 w-6 text-sf-text-muted" />}</div>
                            <div className="min-w-0 flex-1 truncate text-[10px] text-sf-text-primary" title={image.name || image.id}>{image.name || 'Untitled image'}</div>
                            <button type="button" onClick={() => data.onToggleImageConnection?.(data.nodeId, image.id)} className={`flex h-6 w-6 items-center justify-center rounded border ${image.connected ? 'border-emerald-500/50 text-emerald-400 hover:bg-emerald-950/40' : 'border-red-500/50 text-red-400 hover:bg-red-950/40'}`} title={image.connected ? 'Remove reference connection' : 'Add reference connection'}>{image.connected ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
              ) : isShot ? (
                <div className="grid min-h-0 flex-1 grid-cols-2 gap-5">
                  <div className="min-h-0 overflow-y-auto pr-1">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-sf-text-muted">Shot properties</div>
                    {(definition?.properties || []).filter((property) => property.type !== 'shot-cues').map((property) => property.type === 'readonly' ? (
                      <div key={property.id} className="mb-3 rounded border border-sf-dark-700 bg-sf-dark-900 px-2 py-2 text-[10px] text-sf-text-secondary"><span className="mb-1 block">{property.label}</span><div className="text-[11px] text-sf-text-primary">{computedShotDuration.toFixed(3)} s</div></div>
                    ) : property.type === 'textarea' ? (
                      <label key={property.id} className="mb-3 block text-[10px] text-sf-text-secondary"><span className="mb-1 block">{property.label}</span><textarea value={draft[property.id] ?? ''} onChange={(event) => handlePropertyChange(property, event)} className="h-20 w-full resize-y rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-2 text-[11px] text-sf-text-primary outline-none focus:border-sf-accent" /></label>
                    ) : property.type === 'select' ? (
                      <label key={property.id} className="mb-3 block text-[10px] text-sf-text-secondary"><span className="mb-1 block">{property.label}</span><select value={draft[property.id] ?? property.defaultValue ?? ''} onChange={(event) => handlePropertyChange(property, event)} className="w-full rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-2 text-[11px] text-sf-text-primary outline-none focus:border-sf-accent">{(property.options || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                    ) : (
                      <label key={property.id} className="mb-3 block text-[10px] text-sf-text-secondary"><span className="mb-1 block">{property.label}</span><input type={property.type === 'number' ? 'number' : 'text'} min={property.min} step={property.step} placeholder={property.type === 'timecode' ? '0,000' : undefined} value={property.type === 'timecode' ? formatCanvasTime(draft[property.id]) : (draft[property.id] ?? '')} onChange={(event) => handlePropertyChange(property, event)} className="w-full rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-2 text-[11px] text-sf-text-primary outline-none focus:border-sf-accent" /></label>
                    ))}
                  </div>
                  <div className="min-h-0 overflow-y-auto pl-1">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-sf-text-muted">Used elements</div>
                    <div className="mb-4">
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-sf-text-muted">Location</div>
                      <div className="space-y-2">
                        {(data.shotAssignments || []).filter((assignment) => assignment.kind === CANVAS_BLOCK_TYPES.location).map((assignment) => (
                          <div key={assignment.id} className="flex items-center gap-2 rounded border border-sf-dark-700 bg-sf-dark-800 p-1.5">
                            <div className="flex h-12 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-sf-dark-950">{assignment.url ? <img src={assignment.url} alt={assignment.name} className="h-full w-full object-cover" /> : <MapPin className="h-4 w-4 text-sf-text-muted/60" />}</div>
                            <span className="min-w-0 flex-1 truncate text-xs text-sf-text-primary">{assignment.name}</span>
                            <button type="button" onClick={() => data.onToggleShotConnection?.(data.nodeId, assignment.id)} className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border ${assignment.connected ? 'border-emerald-500/50 text-emerald-400 hover:bg-emerald-950/40' : 'border-red-500/50 text-red-400 hover:bg-red-950/40'}`} title={assignment.connected ? 'Remove from shot' : 'Assign to shot'}>{assignment.connected ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}</button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-sf-text-muted">Characters</div>
                      <div className="space-y-2">
                        {(data.shotAssignments || []).filter((assignment) => assignment.kind === CANVAS_BLOCK_TYPES.character).map((assignment) => (
                          <div key={assignment.id} className="space-y-2 rounded border border-sf-dark-700 bg-sf-dark-800 p-1.5">
                            <div className="flex items-center gap-2">
                              <div className="flex h-12 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-sf-dark-950">{assignment.url ? <img src={assignment.url} alt={assignment.name} className="h-full w-full object-cover" /> : <CircleUserRound className="h-4 w-4 text-sf-text-muted/60" />}</div>
                              <span className="min-w-0 flex-1 truncate text-xs text-sf-text-primary">{assignment.name}</span>
                              <button type="button" onClick={() => data.onToggleShotConnection?.(data.nodeId, assignment.id)} className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border ${assignment.connected ? 'border-emerald-500/50 text-emerald-400 hover:bg-emerald-950/40' : 'border-red-500/50 text-red-400 hover:bg-red-950/40'}`} title={assignment.connected ? 'Remove from shot' : 'Assign to shot'}>{assignment.connected ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}</button>
                            </div>
                            {assignment.connected && <div className="space-y-1 border-t border-sf-dark-700 pt-2">
                              <div className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-wide text-sf-text-muted"><span>Timed cues ({formatCanvasTime(shotStartMs)}–{formatCanvasTime(shotEndMs)})</span><button type="button" onClick={() => { const current = assignmentForCharacter(assignment.id); updateCharacterCues(assignment.id, [...current.cues, { start: shotStartMs, end: shotEndMs, type: 'singing', text: '' }]) }} className="rounded border border-sf-dark-600 px-1.5 py-0.5 text-sf-text-secondary hover:bg-sf-dark-700">Add cue</button></div>
                              {assignmentForCharacter(assignment.id).cues.map((cue, cueIndex) => <div key={`${assignment.id}-${cueIndex}`} className="grid grid-cols-[52px_52px_minmax(80px,0.7fr)_minmax(100px,1fr)_20px] gap-1">
                                <input type="text" value={formatCanvasTime(cue.start)} title="Start time (absolute timeline time)" onChange={(event) => { const value = parseCanvasTime(event.target.value); if (value == null) return; const current = assignmentForCharacter(assignment.id); const cues = current.cues.map((item, index) => index === cueIndex ? { ...item, start: value } : item); updateCharacterCues(assignment.id, cues) }} className="rounded border border-sf-dark-600 bg-sf-dark-900 px-1 py-1 text-[9px] text-sf-text-primary" placeholder="0,000" />
                                <input type="text" value={formatCanvasTime(cue.end)} title="End time (absolute timeline time)" onChange={(event) => { const value = parseCanvasTime(event.target.value); if (value == null) return; const current = assignmentForCharacter(assignment.id); const cues = current.cues.map((item, index) => index === cueIndex ? { ...item, end: value } : item); updateCharacterCues(assignment.id, cues) }} className="rounded border border-sf-dark-600 bg-sf-dark-900 px-1 py-1 text-[9px] text-sf-text-primary" placeholder="0,000" />
                                <select value={cue.type} title="Cue type" onChange={(event) => { const current = assignmentForCharacter(assignment.id); const cues = current.cues.map((item, index) => index === cueIndex ? { ...item, type: event.target.value } : item); updateCharacterCues(assignment.id, cues) }} className="rounded border border-sf-dark-600 bg-sf-dark-900 px-1 py-1 text-[9px] text-sf-text-primary">{CANVAS_SHOT_CUE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                                <input value={cue.text} title="Cue text" onChange={(event) => { const current = assignmentForCharacter(assignment.id); const cues = current.cues.map((item, index) => index === cueIndex ? { ...item, text: event.target.value } : item); updateCharacterCues(assignment.id, cues) }} className="min-w-0 rounded border border-sf-dark-600 bg-sf-dark-900 px-1 py-1 text-[9px] text-sf-text-primary" placeholder="Phrase or action" />
                                <button type="button" title="Remove cue" onClick={() => { const current = assignmentForCharacter(assignment.id); updateCharacterCues(assignment.id, current.cues.filter((_, index) => index !== cueIndex)) }} className="rounded text-red-400 hover:bg-red-950/40"><X className="mx-auto h-3 w-3" /></button>
                              </div>)}
                            </div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {isShot && <div className="mb-4 rounded-lg border border-sf-dark-700 bg-sf-dark-900 p-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-sf-text-muted">Used elements</div>
                    <div className="space-y-2">
                      {(data.shotAssignments || []).map((assignment) => (
                        <div key={assignment.id} className="flex items-center gap-2 rounded border border-sf-dark-700 bg-sf-dark-800 p-1.5">
                          <div className="flex h-10 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded bg-sf-dark-950">
                            {assignment.url ? <img src={assignment.url} alt={assignment.name} className="h-full w-full object-cover" /> : (assignment.kind === CANVAS_BLOCK_TYPES.location ? <MapPin className="h-4 w-4 text-sf-text-muted/60" /> : <CircleUserRound className="h-4 w-4 text-sf-text-muted/60" />)}
                          </div>
                          <span className="min-w-0 flex-1 truncate text-xs text-sf-text-primary">{assignment.name}</span>
                          <button type="button" onClick={() => data.onToggleShotConnection?.(data.nodeId, assignment.id)} className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded border ${assignment.connected ? 'border-emerald-500/50 text-emerald-400 hover:bg-emerald-950/40' : 'border-red-500/50 text-red-400 hover:bg-red-950/40'}`} title={assignment.connected ? 'Remove from shot' : 'Assign to shot'}>{assignment.connected ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}</button>
                        </div>
                      ))}
                    </div>
                  </div>}
                  {(definition?.properties || []).filter((property) => !isScene).map((property) => property.type === 'readonly' ? (
                    <div key={property.id} className="mb-2 rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-2 text-[10px] text-sf-text-secondary"><span className="mr-2">{property.label}</span><span className="text-sf-text-primary">{computedShotDuration?.toFixed(3)} s</span></div>
                  ) : property.type === 'checkbox' ? (
                    <label key={property.id} className="mb-2 flex items-center gap-2 rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-2 text-[10px] text-sf-text-secondary"><input type="checkbox" checked={Boolean(draft[property.id])} onChange={(event) => handlePropertyChange(property, event)} className="accent-sf-accent" />{property.label}</label>
                  ) : property.type === 'workflow-select' ? (
                    <label key={property.id} className="mb-3 block text-[10px] text-sf-text-secondary">
                      <span className="mb-1 block">{property.label}</span>
                      <select value={draft[property.id] ?? property.defaultValue ?? ''} onChange={(event) => handlePropertyChange(property, event)} className="w-full rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-2 text-[11px] text-sf-text-primary outline-none focus:border-sf-accent">
                        {(property.optionsSource === 'image' ? imageWorkflowOptions : textToImageWorkflowOptions).length === 0 ? <option value="">No image workflows available</option> : (property.optionsSource === 'image' ? imageWorkflowOptions : textToImageWorkflowOptions).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                  ) : property.type === 'select' ? (
                    <label key={property.id} className="mb-3 block text-[10px] text-sf-text-secondary">
                      <span className="mb-1 block">{property.label}</span>
                      <select value={draft[property.id] ?? property.defaultValue ?? ''} onChange={(event) => handlePropertyChange(property, event)} className="w-full rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-2 text-[11px] text-sf-text-primary outline-none focus:border-sf-accent">
                        {(property.options || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                  ) : property.type === 'textarea' ? (
                    <textarea key={property.id} value={draft[property.id] ?? ''} onChange={(event) => handlePropertyChange(property, event)} className="mb-2 h-20 w-full resize-y rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-2 text-[11px] text-sf-text-primary outline-none focus:border-sf-accent" placeholder={property.label} />
                  ) : (
                    <input key={property.id} type={property.type === 'number' ? 'number' : 'text'} value={draft[property.id] ?? ''} onChange={(event) => handlePropertyChange(property, event)} className="mb-2 w-full rounded border border-sf-dark-600 bg-sf-dark-800 px-2 py-2 text-[11px] text-sf-text-primary outline-none focus:border-sf-accent" placeholder={property.label} />
                  ))}
                </div>
              )}
              <div className="flex justify-end pt-4"><button type="button" onClick={saveDraft} className="flex items-center gap-1 rounded bg-sf-accent px-4 py-2 text-xs font-medium text-white hover:bg-sf-accent/90"><Check className="h-3.5 w-3.5" /> Save</button></div>
            </div>
            {assetPickerOpen && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
                <div className="flex max-h-[94vh] w-full max-w-[94vw] min-h-[700px] flex-col overflow-hidden rounded-lg border border-sf-dark-500 bg-sf-dark-900 p-5">
                  <div className="mb-3 flex items-center justify-between text-base font-medium text-sf-text-primary"><span>Select an image asset</span><button type="button" onClick={() => setAssetPickerOpen(false)}><X className="h-5 w-5" /></button></div>
                  <div className="mb-3 flex items-center justify-between gap-3 text-xs text-sf-text-muted"><div className="flex gap-4"><span>Project assets: {assets.filter(isCanvasImageAsset).length}</span><span>ComfyUI outputs: {comfyAssets.length}{comfyAssetsLoading ? ' (loading…)' : ''}</span></div><button type="button" onClick={() => { setAssetPickerOpen(false); setTimeout(() => setAssetPickerOpen(true), 0) }} className="rounded border border-sf-dark-600 px-3 py-1.5 text-xs text-sf-text-secondary hover:bg-sf-dark-800">Refresh ComfyUI images</button></div>
                  <div className="min-h-0 flex-1 overflow-auto rounded border border-sf-dark-700 bg-sf-dark-950">
                    <div className="min-w-[1680px] overflow-x-auto"><div className="grid grid-cols-5 gap-4 p-4">{[...assets.filter(isCanvasImageAsset), ...comfyAssets].map((asset) => <div key={asset.id} className="min-w-0 rounded-lg border border-sf-dark-700 bg-sf-dark-900 p-2 hover:border-sf-accent"><div className="flex h-[180px] w-full items-center justify-center overflow-hidden rounded bg-black">{asset.url ? <img src={asset.url} alt={asset.name || ''} className="h-full w-full object-contain" /> : <ImageIcon className="h-12 w-12 text-sf-text-muted" />}</div><div className="mt-2 flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate text-xs text-sf-text-primary" title={asset.name || asset.id}>{asset.name || asset.id}</div><div className="text-[10px] text-sf-text-muted">{asset.source === 'comfyui' ? 'ComfyUI' : 'Project'}</div></div><button type="button" onClick={() => selectAsset(asset)} className="flex-shrink-0 rounded bg-sf-accent px-2 py-1 text-[10px] font-medium text-white hover:bg-sf-accent/90">Select</button></div></div>)}</div></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>, document.body)
      }

      {outputs.map((handle, index) => (
        <Handle key={`output-${handle.id}`} id={handle.id} type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-sf-dark-950" style={{ top: `${((index + 1) / (outputs.length + 1)) * 100}%`, background: accent }}>
          <span className={`pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-sf-dark-500 bg-sf-dark-950/95 px-2 py-1 text-[8px] font-semibold uppercase tracking-wide text-sf-text-secondary shadow-lg transition-opacity ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>{handle.label}</span>
        </Handle>
      ))}
    </div>
  )
}

function CanvasWorkspaceContent() {
  const currentProject = useProjectStore((state) => state.currentProject)
  const currentProjectHandle = useProjectStore((state) => state.currentProjectHandle)
  const saveProject = useProjectStore((state) => state.saveProject)
  const initialDocument = useMemo(() => normalizeCanvasDocument(currentProject?.canvas || createInitialCanvasDocument()), [currentProject])
  const [nodes, setNodes, applyNodesChange] = useNodesState(initialDocument.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialDocument.edges)
  const [saveState, setSaveState] = useState('clean')
  const [editingNodeId, setEditingNodeId] = useState(null)
  const canvasRules = CANVAS_RULES
  const canvasDocument = useMemo(() => createCanvasDocument({ nodes, edges, rules: canvasRules }), [canvasRules, edges, nodes])
  const { getIntersectingNodes } = useReactFlow()
  const dragOriginRef = useRef(null)
  const [dragDestination, setDragDestination] = useState(null)
  const [activeNodeId, setActiveNodeId] = useState(null)
  const [llmAgentConfiguration, setLlmAgentConfiguration] = useState(() => normalizeLlmAgentConfiguration())
  const [canvasChatOpen, setCanvasChatOpen] = useState(false)
  const [canvasChatMessages, setCanvasChatMessages] = useState([])
  const [canvasChatBusy, setCanvasChatBusy] = useState(false)
  const [canvasChatError, setCanvasChatError] = useState('')
  const [canvasAgentInCanvas, setCanvasAgentInCanvas] = useState(false)
  const autoSaveTimerRef = useRef(null)
  const autoSaveInFlightRef = useRef(false)
  const autoSaveQueuedRef = useRef(false)
  const loadedProjectKeyRef = useRef(null)
  const loadedSnapshotRef = useRef(null)
  const latestNodesRef = useRef(nodes)
  const latestEdgesRef = useRef(edges)
  const projectKey = currentProjectHandle || currentProject?.name || null

  useEffect(() => {
    let cancelled = false
    window.electronAPI?.getSetting?.(LLM_AGENTS_SETTING_KEY)
      .then((value) => { if (!cancelled) setLlmAgentConfiguration(normalizeLlmAgentConfiguration(value)) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  latestNodesRef.current = nodes
  latestEdgesRef.current = edges

  const canvasChatAgent = useMemo(() => {
    const agent = resolveLlmAgent(llmAgentConfiguration.agents, llmAgentConfiguration.canvasAgentId)
    return agent?.enabled ? agent : null
  }, [llmAgentConfiguration])

  useEffect(() => {
    if (!canvasChatAgent) setCanvasAgentInCanvas(false)
  }, [canvasChatAgent])

  const saveCanvas = useCallback(async () => {
    if (!currentProject || !currentProjectHandle) return false
    const savedDocument = normalizeCanvasDocument(createCanvasDocument({
      nodes: latestNodesRef.current,
      edges: latestEdgesRef.current,
      rules: CANVAS_RULES,
    }))
    return saveProject({ canvas: savedDocument })
  }, [currentProject, currentProjectHandle, saveProject])

  const runAutoSave = useCallback(async () => {
    const saveProjectKey = projectKey
    if (autoSaveInFlightRef.current) {
      autoSaveQueuedRef.current = true
      return
    }
    if (!currentProject || !currentProjectHandle) return
    autoSaveInFlightRef.current = true
    setSaveState('saving')
    try {
      const saved = await saveCanvas()
      if (saved && loadedProjectKeyRef.current === saveProjectKey) {
        loadedSnapshotRef.current = JSON.stringify({ nodes: latestNodesRef.current, edges: latestEdgesRef.current })
      }
      setSaveState(saved ? 'saved' : 'error')
    } catch (error) {
      console.error('Canvas auto-save failed', error)
      setSaveState('error')
    } finally {
      autoSaveInFlightRef.current = false
      if (autoSaveQueuedRef.current && loadedProjectKeyRef.current === saveProjectKey) {
        autoSaveQueuedRef.current = false
        scheduleAutoSaveRef.current?.()
      }
    }
  }, [currentProject, currentProjectHandle, projectKey, saveCanvas])

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null
      void runAutoSave()
    }, 750)
  }, [runAutoSave])
  const scheduleAutoSaveRef = useRef(scheduleAutoSave)
  scheduleAutoSaveRef.current = scheduleAutoSave

  useEffect(() => {
    const snapshot = JSON.stringify({ nodes, edges })
    if (loadedProjectKeyRef.current !== projectKey) {
      loadedProjectKeyRef.current = projectKey
      loadedSnapshotRef.current = JSON.stringify({ nodes: initialDocument.nodes, edges: initialDocument.edges })
      setNodes(initialDocument.nodes)
      setEdges(initialDocument.edges)
      setSaveState('clean')
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
      autoSaveQueuedRef.current = false
      return undefined
    }
    if (!currentProject || !currentProjectHandle || snapshot === loadedSnapshotRef.current) return undefined
    setSaveState((state) => state === 'saving' ? state : 'dirty')
    if (autoSaveInFlightRef.current) autoSaveQueuedRef.current = true
    else scheduleAutoSave()
    return undefined
  }, [currentProject, currentProjectHandle, edges, initialDocument, nodes, projectKey, scheduleAutoSave, setEdges, setNodes])

  useEffect(() => () => {
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current)
  }, [])

  const handleNodesChange = useCallback((changes) => {
    const requestedIds = new Set(changes.filter((change) => change.type === 'remove').map((change) => change.id))
    if (!requestedIds.size) {
      applyNodesChange(changes)
      return
    }

    const deleteIds = new Set([...requestedIds].filter((id) => {
      const node = nodes.find((candidate) => candidate.id === id)
      return node && !getCanvasBlockDefinition(node.type)?.fixed
    }))
    if (!deleteIds.size || !window.confirm(`Delete ${deleteIds.size === 1 ? 'this node' : `${deleteIds.size} nodes`}?`)) return

    let addedDescendant = true
    while (addedDescendant) {
      addedDescendant = false
      for (const node of nodes) {
        if (node.parentId && deleteIds.has(node.parentId) && !deleteIds.has(node.id)) {
          deleteIds.add(node.id)
          addedDescendant = true
        }
      }
    }

    if (!canDeleteCanvasNodes(nodes, deleteIds)) return

    const nextChanges = changes.filter((change) => change.type !== 'remove' || deleteIds.has(change.id))
    for (const id of deleteIds) {
      if (!nextChanges.some((change) => change.type === 'remove' && change.id === id)) nextChanges.push({ id, type: 'remove' })
    }
    applyNodesChange(nextChanges)
    setEdges((currentEdges) => currentEdges.filter((edge) => !deleteIds.has(edge.source) && !deleteIds.has(edge.target)))
  }, [applyNodesChange, nodes, setEdges])

  const handleNodeUpdate = useCallback((nodeId, patch) => {
    setNodes((currentNodes) => currentNodes.map((node) => node.id === nodeId
      ? { ...node, data: { ...node.data, ...(node.type === CANVAS_BLOCK_TYPES.shot ? { ...patch, title: node.data.title } : patch) } }
      : node))
  }, [setNodes])

  const handleNodeMode = useCallback((nodeId, mode) => {
    setEditingNodeId(mode ? nodeId : (currentId) => currentId === nodeId ? null : currentId)
    setNodes((currentNodes) => currentNodes.map((node) => node.id === nodeId
      ? { ...node, data: { ...node.data, mode: mode || null } }
      : node))
  }, [setNodes])

  const handleNodeResize = useCallback((nodeId, params) => {
    setNodes((currentNodes) => {
      const target = currentNodes.find((node) => node.id === nodeId)
      if (!target) return currentNodes
      const definition = getCanvasBlockDefinition(target.type)
      const targetChildren = currentNodes.filter((node) => node.parentId === target.id)
      const dimensionCache = new Map()
      const requiredLayout = definition?.contains
        ? getGalleryLayout(definition, targetChildren, effectiveChildLayout(target), params, (child) => getResolvedNodeDimensions(child, currentNodes, dimensionCache))
        : null
      const minimum = requiredLayout
        ? { width: requiredLayout.minWidth, height: requiredLayout.minHeight }
        : definition?.minSize || { width: 150, height: 100 }
      const fallback = definition?.defaultSize || { width: 190, height: 132 }
      const nextSize = clampSize(params, minimum, fallback)
      return currentNodes.map((node) => {
        if (target.parentId && node.parentId === target.parentId && node.type === target.type) {
          return { ...node, data: { ...node.data, size: nextSize } }
        }
        if (!target.parentId && node.id === target.id) return { ...node, data: { ...node.data, size: nextSize } }
        return node
      })
    })
  }, [setNodes])

  const handleImageAction = useCallback((nodeId, mode) => {
    setNodes((currentNodes) => currentNodes.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, imageMode: mode } } : node))
  }, [setNodes])

  const handleToggleImageConnection = useCallback((sheetId, imageId) => {
    setEdges((currentEdges) => {
      const existing = currentEdges.find((edge) => edge.source === imageId && edge.target === sheetId && edge.sourceHandle === 'sheet' && edge.targetHandle === 'images')
      if (existing) return currentEdges.filter((edge) => edge.id !== existing.id)
      const connection = { source: imageId, target: sheetId, sourceHandle: 'sheet', targetHandle: 'images' }
      if (!isValidCanvasConnection(connection, nodes, canvasDocument.rules, currentEdges)) return currentEdges
      return addEdge({ ...connection, type: 'canvas-connection' }, currentEdges)
    })
  }, [canvasDocument.rules, nodes, setEdges])

  const handleToggleShotConnection = useCallback((shotId, sourceId) => {
    setEdges((currentEdges) => {
      const existing = currentEdges.find((edge) => edge.source === sourceId && edge.target === shotId)
      if (existing) return currentEdges.filter((edge) => edge.id !== existing.id)
      const source = nodes.find((node) => node.id === sourceId)
      const shot = nodes.find((node) => node.id === shotId)
      if (!source || !shot) return currentEdges
      const targetHandle = source.type === CANVAS_BLOCK_TYPES.location ? 'location' : 'character'
      const connection = { source: sourceId, target: shotId, sourceHandle: 'right', targetHandle }
      const withoutExistingLocation = source.type === CANVAS_BLOCK_TYPES.location
        ? currentEdges.filter((edge) => !(edge.target === shotId && edge.targetHandle === 'location'))
        : currentEdges
      if (!isValidCanvasConnection(connection, nodes, canvasDocument.rules, withoutExistingLocation)) return currentEdges
      return addEdge({ ...connection, type: 'canvas-connection' }, withoutExistingLocation)
    })
  }, [canvasDocument.rules, nodes, setEdges])

  const handleToggleLayout = useCallback((nodeId) => {
    setNodes((currentNodes) => {
      const parent = currentNodes.find((node) => node.id === nodeId)
      if (!parent || !getCanvasBlockDefinition(parent.type)?.contains) return currentNodes
      if ([CANVAS_BLOCK_TYPES.character, CANVAS_BLOCK_TYPES.location, CANVAS_BLOCK_TYPES.timeline, CANVAS_BLOCK_TYPES.scene].includes(parent.type)) return currentNodes
      const currentLayout = effectiveChildLayout(parent)
      const nextLayout = currentLayout === CANVAS_CHILD_LAYOUTS.landscape
        ? CANVAS_CHILD_LAYOUTS.portrait
        : currentLayout === CANVAS_CHILD_LAYOUTS.portrait
          ? CANVAS_CHILD_LAYOUTS.freeform
          : CANVAS_CHILD_LAYOUTS.landscape
      const nextNodes = currentNodes.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, layout: nextLayout } } : node)
      return nextLayout === CANVAS_CHILD_LAYOUTS.freeform ? normalizeFreeformParent(nextNodes, nodeId) : nextNodes
    })
  }, [setNodes])

  const nodeTypes = useMemo(() => Object.fromEntries(CANVAS_BLOCK_LIBRARY.map((definition) => [definition.type, CanvasNode])), [])

  const onConnect = useCallback((connection) => {
    if (!isValidCanvasConnection(connection, nodes, canvasDocument.rules, edges)) return
    const maxEdges = canvasDocument.rules.maxEdges
    if (maxEdges !== null && maxEdges !== undefined && Number.isFinite(Number(maxEdges)) && edges.length >= Number(maxEdges)) return
    setEdges((currentEdges) => addEdge({ ...connection, type: 'canvas-connection' }, currentEdges))
    setActiveNodeId(connection.source)
  }, [canvasDocument.rules, edges, nodes, setEdges])

  const deleteConnection = useCallback((edgeId) => {
    setEdges((currentEdges) => currentEdges.filter((edge) => edge.id !== edgeId))
  }, [setEdges])

  const visibleEdgeIds = useMemo(() => {
    if (!activeNodeId) return new Set()
    const activeNode = nodes.find((node) => node.id === activeNodeId)
    if (!activeNode) return new Set()
    const connected = edges.filter((edge) => edge.source === activeNodeId || edge.target === activeNodeId)
    const imageSheetTypes = [CANVAS_BLOCK_TYPES.image, CANVAS_BLOCK_TYPES.characterSheet, CANVAS_BLOCK_TYPES.locationSheet]
    if (!imageSheetTypes.includes(activeNode.type)) return new Set(connected.map((edge) => edge.id))
    return new Set(connected.filter((edge) => {
      const otherId = edge.source === activeNodeId ? edge.target : edge.source
      const other = nodes.find((node) => node.id === otherId)
      return other && imageSheetTypes.includes(other.type)
    }).map((edge) => edge.id))
  }, [activeNodeId, edges, nodes])

  const displayEdges = useMemo(() => edges.map((edge) => ({
    ...edge,
    type: 'canvas-connection',
    data: { ...edge.data, onDelete: deleteConnection },
    hidden: !visibleEdgeIds.has(edge.id),
    style: visibleEdgeIds.has(edge.id) ? { stroke: '#c084fc', strokeWidth: 2.5 } : undefined,
  })), [deleteConnection, edges, visibleEdgeIds])

  const edgeTypes = useMemo(() => ({ 'canvas-connection': CanvasConnectionEdge }), [])

  const onNodeDragStart = useCallback((_, draggedNode) => {
    dragOriginRef.current = { id: draggedNode.id, parentId: draggedNode.parentId, position: draggedNode.position }
    setDragDestination(null)
  }, [])

  const onNodeDrag = useCallback((_, draggedNode) => {
    const destination = getIntersectingNodes(draggedNode, false)
      .filter((candidate) => candidate.id !== draggedNode.id && getCanvasBlockDefinition(candidate.type)?.contains)
      .at(-1)
    setDragDestination(destination ? { id: destination.id, valid: canContainCanvasNode(destination.type, draggedNode.type) } : null)
    const parentId = draggedNode.parentId || dragOriginRef.current?.parentId
    const parent = parentId ? nodes.find((node) => node.id === parentId) : null
    if (effectiveChildLayout(parent) !== CANVAS_CHILD_LAYOUTS.freeform) return
    setNodes((currentNodes) => normalizeFreeformParent(
      currentNodes.map((node) => node.id === draggedNode.id ? { ...node, position: draggedNode.position } : node),
      parent.id,
    ))
  }, [nodes, setNodes])

  const onNodeDragStop = useCallback((_, draggedNode) => {
    const candidates = getIntersectingNodes(draggedNode, false).filter((candidate) => canContainCanvasNode(candidate.type, draggedNode.type))
    const origin = dragOriginRef.current
    const originParent = origin?.parentId ? nodes.find((node) => node.id === origin.parentId) : null
    const parent = candidates[candidates.length - 1] || (effectiveChildLayout(originParent) === CANVAS_CHILD_LAYOUTS.freeform ? originParent : null)
    const absolutePosition = draggedNode.internals?.positionAbsolute || draggedNode.positionAbsolute || draggedNode.position
    setNodes((currentNodes) => {
      let nextNodes = currentNodes.map((currentNode) => {
        if (currentNode.id !== draggedNode.id) return currentNode
        if (!parent) {
          if (getCanvasBlockDefinition(currentNode.type)?.allowedParents?.length && origin?.parentId) return { ...currentNode, parentId: origin.parentId, extent: 'parent', position: origin.position }
          const { parentId: _parentId, extent: _extent, ...detachedNode } = currentNode
          return { ...detachedNode, position: absolutePosition }
        }
        const parentAbsolutePosition = parent.internals?.positionAbsolute || parent.positionAbsolute || parent.position
        const sameParent = origin?.parentId === parent.id
        return {
          ...currentNode,
          parentId: parent.id,
          ...(effectiveChildLayout(parent) === CANVAS_CHILD_LAYOUTS.freeform ? { extent: undefined } : { extent: 'parent' }),
          position: sameParent ? draggedNode.position : { x: absolutePosition.x - parentAbsolutePosition.x, y: absolutePosition.y - parentAbsolutePosition.y },
        }
      })
      if (effectiveChildLayout(parent) === CANVAS_CHILD_LAYOUTS.freeform) nextNodes = normalizeFreeformParent(nextNodes, parent.id)
      if (draggedNode.type === CANVAS_BLOCK_TYPES.shot && parent?.type === CANVAS_BLOCK_TYPES.scene) {
        nextNodes = reorderSceneShots(nextNodes, parent.id, draggedNode.id, nextNodes.find((node) => node.id === draggedNode.id)?.position)
      }
      return nextNodes
    })
    dragOriginRef.current = null
    setDragDestination(null)
  }, [getIntersectingNodes, nodes, setNodes])

  const addElement = useCallback((type, requestedParentId = null) => {
    setNodes((currentNodes) => {
      if (!canAddCanvasNode({ ...canvasDocument, nodes: currentNodes }, type)) return currentNodes
      const parent = requestedParentId ? currentNodes.find((node) => node.id === requestedParentId && canContainCanvasNode(node.type, type)) : null
      if (requestedParentId && !parent) return currentNodes
      const fallbackParent = parent || (requestedParentId ? null : currentNodes.find((node) => canContainCanvasNode(node.type, type)))
      if (fallbackParent && !canAddCanvasChild(fallbackParent.id, type, currentNodes)) return currentNodes
      const siblings = fallbackParent ? currentNodes.filter((node) => node.parentId === fallbackParent.id) : []
      const parentLayout = effectiveChildLayout(fallbackParent)
      const timeline = fallbackParent?.type === CANVAS_BLOCK_TYPES.scene
        ? currentNodes.find((node) => node.id === fallbackParent.parentId && node.type === CANVAS_BLOCK_TYPES.timeline)
        : null
      const timelineProperties = timeline?.data?.properties || {}
      const inheritedShotProperties = type === CANVAS_BLOCK_TYPES.shot ? {
        videoStyle: timelineProperties.videoStyle || '',
        temporalWorldEffect: timelineProperties.temporalWorldEffect || '',
        cameraFlow: timelineProperties.cameraFlow || '',
      } : undefined
      const contextualTitle = type === CANVAS_BLOCK_TYPES.image && fallbackParent?.type === CANVAS_BLOCK_TYPES.location
        ? 'Location image'
        : type === CANVAS_BLOCK_TYPES.image && fallbackParent?.type === CANVAS_BLOCK_TYPES.character
          ? 'Character image'
          : type === CANVAS_BLOCK_TYPES.shot
            ? `Shot ${siblings.length + 1}`
            : type === CANVAS_BLOCK_TYPES.scene
              ? `Scene ${siblings.length + 1}`
              : undefined
      const createdNode = createCanvasNode(type, { index: currentNodes.length, parentId: fallbackParent?.id, position: fallbackParent ? getGalleryPosition(siblings.length, parentLayout, siblings, getCanvasBlockDefinition(fallbackParent.type), fallbackParent.data?.size?.width) : undefined, title: contextualTitle, properties: inheritedShotProperties, mode: type === CANVAS_BLOCK_TYPES.scene ? undefined : 'add' })
      const nextNodes = [...currentNodes, createdNode]
      if (![CANVAS_BLOCK_TYPES.character, CANVAS_BLOCK_TYPES.location].includes(type) || requestedParentId) return nextNodes
      if (!canAddCanvasNode({ ...canvasDocument, nodes: nextNodes }, CANVAS_BLOCK_TYPES.image)) return currentNodes
      return [...nextNodes, createCanvasNode(CANVAS_BLOCK_TYPES.image, {
        index: nextNodes.length,
        parentId: createdNode.id,
        title: type === CANVAS_BLOCK_TYPES.location ? 'Location image' : 'Character image',
        position: getGalleryPosition(0, effectiveChildLayout(createdNode), [], getCanvasBlockDefinition(createdNode.type), createdNode.data?.size?.width),
        mode: null,
      })]
    })
  }, [canvasDocument, setNodes])

  const displayNodes = useMemo(() => {
    const dimensionCache = new Map()
    const resolveDimensions = (candidate) => getResolvedNodeDimensions(candidate, nodes, dimensionCache)
    return nodes.map((node) => {
    const definition = getCanvasBlockDefinition(node.type)
    const siblings = node.parentId ? nodes.filter((child) => child.parentId === node.parentId) : []
    const childIndex = siblings.findIndex((child) => child.id === node.id)
    const children = nodes.filter((child) => child.parentId === node.id)
    const childCounts = Object.fromEntries(getGalleryGroups(children).map((group) => [group.type, group.children.length]))
    const childAvailability = Object.fromEntries((definition?.contains || []).map((childType) => [childType, canAddCanvasChild(node.id, childType, nodes)]))
    const parent = node.parentId ? nodes.find((candidate) => candidate.id === node.parentId) : null
    const canvasConfiguration = nodes.find((candidate) => candidate.type === CANVAS_BLOCK_TYPES.configuration)
    const siblingImages = node.parentId
      ? nodes.filter((candidate) => candidate.parentId === node.parentId && candidate.type === CANVAS_BLOCK_TYPES.image)
      : []
    const sheetImages = [CANVAS_BLOCK_TYPES.characterSheet, CANVAS_BLOCK_TYPES.locationSheet].includes(node.type)
      ? siblingImages.map((image) => {
        const asset = useAssetsStore.getState().assets.find((candidate) => candidate.id === image.data?.assetId)
        const connected = edges.some((edge) => edge.source === image.id && edge.target === node.id && edge.sourceHandle === 'sheet' && edge.targetHandle === 'images')
        return { id: image.id, assetId: image.data?.assetId || asset?.id || '', name: image.data?.assetName || asset?.name || image.data?.title || 'Untitled image', url: image.data?.assetUrl || asset?.url || '', connected }
      })
      : []
    const shotReferences = node.type === CANVAS_BLOCK_TYPES.shot
      ? (() => {
        const connectedSources = edges
          .filter((edge) => edge.target === node.id)
          .map((edge) => nodes.find((candidate) => candidate.id === edge.source))
          .filter((candidate) => candidate && [CANVAS_BLOCK_TYPES.location, CANVAS_BLOCK_TYPES.character].includes(candidate.type))
        const toReference = (source) => {
          if (!source) return null
          const image = nodes.find((candidate) => candidate.parentId === source.id && candidate.type === CANVAS_BLOCK_TYPES.image)
          const asset = image ? useAssetsStore.getState().assets.find((candidate) => candidate.id === image.data?.assetId) : null
          return {
            id: source.id,
            name: source.data?.title || (source.type === CANVAS_BLOCK_TYPES.location ? 'Location' : 'Character'),
            url: image?.data?.assetUrl || asset?.url || '',
          }
        }
        return {
          location: toReference(connectedSources.find((source) => source.type === CANVAS_BLOCK_TYPES.location)),
          characters: connectedSources.filter((source) => source.type === CANVAS_BLOCK_TYPES.character).map(toReference),
        }
      })()
      : null
    const shotAssignments = node.type === CANVAS_BLOCK_TYPES.shot
      ? nodes.filter((candidate) => [CANVAS_BLOCK_TYPES.location, CANVAS_BLOCK_TYPES.character].includes(candidate.type)).map((source) => {
        const image = nodes.find((candidate) => candidate.parentId === source.id && candidate.type === CANVAS_BLOCK_TYPES.image)
        const asset = image ? useAssetsStore.getState().assets.find((candidate) => candidate.id === image.data?.assetId) : null
        return {
          id: source.id,
          kind: source.type,
          name: source.data?.title || (source.type === CANVAS_BLOCK_TYPES.location ? 'Location' : 'Character'),
          url: image?.data?.assetUrl || asset?.url || '',
          connected: edges.some((edge) => edge.source === source.id && edge.target === node.id),
        }
      })
      : []
    const parentLayout = effectiveChildLayout(parent)
    const parentDefinition = parent ? getCanvasBlockDefinition(parent.type) : null
    const parentDimensions = parentDefinition?.contains ? resolveDimensions(parent) : null
    const isCoveredByEditor = Boolean(editingNodeId && node.parentId === editingNodeId)
    const nodeLayout = effectiveChildLayout(node)
    const layout = definition?.contains ? resolveDimensions(node) : null
    const galleryColumnLabels = definition?.contains ? getGalleryColumnLabels(definition, children, nodeLayout, layout?.width, resolveDimensions) : []
    const promptColumn = galleryColumnLabels.find((column) => column.prompt) || null
    let normalDimensions = resolveDimensions(node)
    if ([CANVAS_BLOCK_TYPES.character, CANVAS_BLOCK_TYPES.location].includes(parent?.type) && parentLayout === CANVAS_CHILD_LAYOUTS.portrait) {
      const groups = getGalleryGroups(siblings)
      const groupIndex = groups.findIndex((group) => group.type === node.type)
      const expandedWidth = getPortraitGroupWidths(parentDefinition, siblings, parentDimensions?.width, resolveDimensions)[groupIndex]
      if (expandedWidth) normalDimensions = { ...normalDimensions, width: expandedWidth }
    }
    const dimensions = node.data?.mode
      ? { width: Math.max(normalDimensions.width, 360), height: Math.max(normalDimensions.height, 300) }
      : normalDimensions
    const minimum = definition?.minSize || { width: 150, height: 100 }
    return {
      ...node,
      hidden: isCoveredByEditor,
      zIndex: editingNodeId === node.id ? 1000 : node.zIndex,
      ...(node.parentId && parentLayout === CANVAS_CHILD_LAYOUTS.freeform ? { extent: undefined } : {}),
      style: dimensions,
      position: node.parentId && childIndex >= 0 && parentLayout !== CANVAS_CHILD_LAYOUTS.freeform
          ? getGalleryPosition(childIndex, parentLayout, siblings, parentDefinition, parentDimensions?.width, resolveDimensions)
          : node.position,
      data: {
        ...node.data,
        ...(node.type === CANVAS_BLOCK_TYPES.shot ? { title: `Shot ${childIndex + 1}` } : {}),
        nodeId: node.id,
        selected: Boolean(node.selected),
        minWidth: layout?.minWidth || minimum.width,
        minHeight: layout?.minHeight || minimum.height,
        onUpdate: handleNodeUpdate,
        onModeChange: handleNodeMode,
        onResize: handleNodeResize,
        onImageAction: handleImageAction,
        onToggleLayout: handleToggleLayout,
        onAddChild: (parentId, childType) => addElement(childType, parentId),
        onToggleImageConnection: handleToggleImageConnection,
        onToggleShotConnection: handleToggleShotConnection,
        onDeleteNode: (nodeId) => handleNodesChange([{ id: nodeId, type: 'remove' }]),
        sheetImages,
        shotReferences,
        shotAssignments,
        childCount: children.length,
        childCounts,
        childAvailability,
        dropState: dragDestination?.id === node.id ? (dragDestination.valid ? 'valid' : 'invalid') : null,
        galleryColumnLabels,
        promptColumn,
        generationWorkflowId: parent?.type === CANVAS_BLOCK_TYPES.location
          ? (canvasConfiguration?.data?.properties?.locationImageWorkflow || 'z-image-turbo')
          : (canvasConfiguration?.data?.properties?.characterImageWorkflow || canvasConfiguration?.data?.properties?.imageGenerationWorkflow || 'z-image-turbo'),
        generationSheetWorkflowId: parent?.type === CANVAS_BLOCK_TYPES.location
          ? (canvasConfiguration?.data?.properties?.locationSheetWorkflow || 'image-edit')
          : (canvasConfiguration?.data?.properties?.characterSheetWorkflow || 'image-edit'),
        canvasAgent: resolveLlmAgent(llmAgentConfiguration.agents, llmAgentConfiguration.canvasAgentId),
      },
    }
  })
  }, [addElement, canvasDocument.rules, dragDestination, edges, editingNodeId, handleImageAction, handleNodeMode, handleNodeResize, handleNodeUpdate, handleNodesChange, handleToggleImageConnection, handleToggleLayout, handleToggleShotConnection, llmAgentConfiguration, nodes])

  const resetCanvas = useCallback(() => {
    setNodes(initialDocument.nodes)
    setEdges(initialDocument.edges)
    setSaveState('dirty')
  }, [initialDocument, setEdges, setNodes])

  const sendCanvasChatMessage = useCallback(async (content) => {
    if (!canvasChatAgent || canvasChatBusy) return
    const userMessage = {
      id: `canvas-chat-${globalThis.crypto?.randomUUID?.() || Date.now()}`,
      role: 'user',
      content,
    }
    const nextMessages = [...canvasChatMessages, userMessage]
    setCanvasChatMessages(nextMessages)
    setCanvasChatBusy(true)
    setCanvasChatError('')
    try {
      const canvas = createCanvasChatContext({
        nodes: latestNodesRef.current,
        edges: latestEdgesRef.current,
        rules: CANVAS_RULES,
      })
      const result = await window.electronAPI?.sendCanvasChat?.({
        messages: nextMessages.map(({ role, content: messageContent }) => ({ role, content: messageContent })),
        canvas,
      })
      if (!result?.ok) throw new Error(result?.error || 'Canvas Chat could not reach the selected agent.')
      setCanvasChatMessages((current) => [...current, {
        id: `canvas-chat-${globalThis.crypto?.randomUUID?.() || Date.now()}-assistant`,
        role: 'assistant',
        content: result.answer,
      }])
    } catch (error) {
      setCanvasChatError(error?.message || 'Canvas Chat could not reach the selected agent.')
    } finally {
      setCanvasChatBusy(false)
    }
  }, [canvasChatAgent, canvasChatBusy, canvasChatMessages])

  const discardCanvasChat = useCallback(() => {
    setCanvasChatMessages([])
    setCanvasChatError('')
    setCanvasAgentInCanvas(false)
    setCanvasChatOpen(false)
  }, [])

  const bringCanvasAgentToCanvas = useCallback(() => {
    setCanvasAgentInCanvas(Boolean(canvasChatAgent))
    setCanvasChatOpen(true)
  }, [canvasChatAgent])

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-[#1a2740]">
      <aside className="z-10 flex w-64 flex-shrink-0 flex-col border-r border-slate-500/30 bg-[#25334d] shadow-xl shadow-black/20">
        <div className="border-b border-slate-400/20 bg-white/[0.025] px-4 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-sf-text-primary"><Sparkles className="h-4 w-4 text-sf-accent" />Canvas elements</div>
          <div className="mt-1 text-[10px] text-slate-400">Build production context visually</div>
        </div>
        <div className="border-b border-slate-400/20 p-3">
          <div className="rounded-xl border border-sf-accent/35 bg-sf-accent/10 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-sf-text-primary"><MessageCircle className="h-4 w-4 text-sf-accent" /> Canvas agent</div>
            <p className="mt-1 truncate text-[10px] text-slate-300">{canvasChatAgent ? canvasChatAgent.label : 'No Canvas agent configured'}</p>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-400">{canvasAgentInCanvas ? 'Agent is ready with this Canvas and Velorn MCP context.' : 'Bring the selected agent into this Canvas to start a contextual chat.'}</p>
            <button type="button" onClick={bringCanvasAgentToCanvas} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-sf-accent px-3 py-2 text-xs font-medium text-white hover:bg-sf-accent-hover"><MessageCircle className="h-3.5 w-3.5" /> {canvasAgentInCanvas ? 'Open agent chat' : 'Bring agent to Canvas'}</button>
          </div>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {CANVAS_BLOCK_LIBRARY.filter((definition) => !definition.allowedParents && !definition.fixed).map((definition) => {
            const Icon = BLOCK_ICONS[definition.icon] || Sparkles
            return (
              <button key={definition.type} type="button" onClick={() => addElement(definition.type)} className="group/library relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-slate-400/20 bg-slate-900/35 px-3 py-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300/40 hover:bg-slate-800/70 hover:shadow-lg">
                <span className="absolute inset-y-2 left-0 w-1 rounded-r-full" style={{ background: definition.accent }} />
                <span className="rounded-md p-2" style={{ background: `${definition.accent}18`, color: definition.accent }}><Icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-[8px] font-bold uppercase tracking-[0.14em]" style={{ color: definition.accent }}>{definition.visualFamily}</span><span className="block text-xs font-medium text-sf-text-primary">{definition.label}</span></span>
                <Plus className="h-3.5 w-3.5 text-sf-text-muted" />
              </button>
            )
          })}
        </div>
        <div className="space-y-2 border-t border-slate-400/20 bg-black/10 p-3">
          <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-400/20 bg-slate-900/25 px-3 py-2 text-xs text-sf-text-secondary">
            <Check className="h-3.5 w-3.5 text-sf-accent" /> {saveState === 'saving' ? 'Auto-saving…' : saveState === 'saved' ? 'Canvas saved' : saveState === 'error' ? 'Auto-save failed' : saveState === 'dirty' ? 'Changes pending' : 'Canvas up to date'}
          </div>
          <button type="button" onClick={bringCanvasAgentToCanvas} className="flex w-full items-center justify-center gap-2 rounded-lg border border-sf-accent/40 bg-sf-accent/10 px-3 py-2 text-xs text-sf-text-primary hover:bg-sf-accent/20"><MessageCircle className="h-3.5 w-3.5 text-sf-accent" /> {canvasAgentInCanvas ? 'Open agent chat' : 'Bring agent to Canvas'}</button>
          <button type="button" onClick={resetCanvas} className="flex w-full items-center justify-center gap-2 rounded-lg border border-sf-dark-600 px-3 py-2 text-xs text-sf-text-secondary hover:bg-sf-dark-800"><RotateCcw className="h-3.5 w-3.5" /> Reset canvas</button>
        </div>
      </aside>
      <div className="relative min-w-0 flex-1">
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setActiveNodeId(node.id)}
          onNodeDoubleClick={(_, node) => handleNodeMode(node.id, 'edit')}
          onPaneClick={() => setActiveNodeId(null)}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          className="canvas-workspace"
          style={{ background: 'radial-gradient(circle at 25% 15%, rgba(71, 96, 138, .34), transparent 34%), linear-gradient(145deg, #263650 0%, #1a2740 62%, #22314b 100%)' }}
          defaultEdgeOptions={{ animated: true, style: { stroke: '#64748b', strokeWidth: 1.5 } }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={32} size={1.35} color="rgba(203,213,225,0.16)" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable bgColor="rgba(30, 42, 65, 0.96)" maskColor="rgba(15,23,42,0.38)" nodeColor={(node) => node.data?.accent || '#64748b'} />
          <Panel position="top-left" className="!m-4"><div className="rounded-xl border border-slate-300/20 bg-slate-800/75 px-3 py-2 text-[11px] text-slate-300 shadow-xl backdrop-blur-xl">Drag to arrange · scroll to zoom · connect handles to compose a scene</div></Panel>
        </ReactFlow>
        <CanvasChatPanel
          open={canvasChatOpen}
          messages={canvasChatMessages}
          agentLabel={canvasChatAgent?.label || ''}
          busy={canvasChatBusy}
          error={canvasChatError}
          onSend={sendCanvasChatMessage}
          onClose={() => setCanvasChatOpen(false)}
          onDiscard={discardCanvasChat}
        />
      </div>
    </div>
  )
}

export default function CanvasWorkspace() {
  return <ReactFlowProvider><CanvasWorkspaceContent /></ReactFlowProvider>
}

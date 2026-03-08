import { Upload, FolderOpen, Image, Video, Music, Search, Grid, List, Trash2, Edit3, Play, FileVideo, FileAudio, FileImage, Loader2, FolderPlus, ChevronRight, ChevronDown, ChevronLeft, Home, Minus, Plus, MoreVertical, FolderInput, Wand2, Layers, Film, VolumeX, Volume2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import useAssetsStore from '../../stores/assetsStore'
import useProjectStore from '../../stores/projectStore'
import useTimelineStore from '../../stores/timelineStore'
import { importAsset, isElectron, writeGeneratedOverlayToProject } from '../../services/fileSystem'
import { enqueuePlaybackTranscode } from '../../services/playbackCache'
import MaskGenerationDialog from '../MaskGenerationDialog'
import OverlayGeneratorModal from '../OverlayGeneratorModal'
import ConfirmDialog from '../ConfirmDialog'

// Thumbnail size presets (xs = extra small for denser grid)
const THUMBNAIL_SIZES = {
  xs: { cols: 5, iconSize: 'w-3 h-3', playSize: 'w-3 h-3', badgeSize: 'text-[5px]', nameSize: 'text-[8px]', infoSize: 'text-[7px]' },
  small: { cols: 3, iconSize: 'w-4 h-4', playSize: 'w-4 h-4', badgeSize: 'text-[6px]', nameSize: 'text-[9px]', infoSize: 'text-[8px]' },
  medium: { cols: 2, iconSize: 'w-6 h-6', playSize: 'w-6 h-6', badgeSize: 'text-[7px]', nameSize: 'text-[10px]', infoSize: 'text-[9px]' },
  large: { cols: 1, iconSize: 'w-8 h-8', playSize: 'w-8 h-8', badgeSize: 'text-[8px]', nameSize: 'text-[11px]', infoSize: 'text-[10px]' },
}
const THUMBNAIL_SIZE_ORDER = ['xs', 'small', 'medium', 'large']
const FOLDER_TILE_ICON_SIZES = {
  xs: 'w-10 h-10',
  small: 'w-12 h-12',
  medium: 'w-16 h-16',
  large: 'w-20 h-20',
}
let transparentAssetDragImage = null

const getTransparentAssetDragImage = () => {
  if (transparentAssetDragImage) return transparentAssetDragImage
  if (typeof document === 'undefined') return null

  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  transparentAssetDragImage = canvas
  return transparentAssetDragImage
}

function AssetsPanel() {
  const [viewMode, setViewMode] = useState('grid')
  const [thumbnailSize, setThumbnailSize] = useState('medium')
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isAssetDragActive, setIsAssetDragActive] = useState(false)
  const [assetDragPreview, setAssetDragPreview] = useState(null) // { assetId, clientX, clientY }
  const fileInputRef = useRef(null)
  const activeAssetDragIdRef = useRef(null)
  
  // Folder state
  const [currentFolderId, setCurrentFolderId] = useState(null) // null = root
  const [showNewFolderInput, setShowNewFolderInput] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [contextMenu, setContextMenu] = useState(null) // { x, y, assetId?, folderId? }
  const newFolderInputRef = useRef(null)
  
  // Mask generation state
  const [maskDialogAsset, setMaskDialogAsset] = useState(null) // Asset to generate mask for
  // Overlay generator modal (matte/letterbox/vignette/grain)
  const [overlayModalOpen, setOverlayModalOpen] = useState(false)
  const [overlayModalInitialType, setOverlayModalInitialType] = useState('letterbox')
  const [overlayModalFolderId, setOverlayModalFolderId] = useState(null) // when opened from folder context menu
  const [confirmDialog, setConfirmDialog] = useState(null) // { title, message, confirmLabel, cancelLabel, tone }
  const confirmResolverRef = useRef(null)
  
  // Selected assets (array for multi-select; used for delete and drag-to-folder)
  const [selectedAssetIds, setSelectedAssetIds] = useState([])
  const [dragOverFolderId, setDragOverFolderId] = useState(null) // 'root' | folderId for drop highlight
  // List view: which folder IDs are expanded to show contents inline
  const [expandedFolderIds, setExpandedFolderIds] = useState(() => new Set())
  // List details view: sort by column (name | type | source | date), sortDir (asc | desc)
  const LIST_SORT_KEY = 'assetsListSort'
  const [listSortBy, setListSortBy] = useState(() => {
    try {
      const s = localStorage.getItem(LIST_SORT_KEY)
      if (s) {
        const { by, dir } = JSON.parse(s)
        if (['name', 'type', 'source', 'date'].includes(by) && (dir === 'asc' || dir === 'desc')) return { by, dir }
      }
    } catch (_) {}
    return { by: 'date', dir: 'desc' }
  })
  const panelRef = useRef(null)

  const setListSort = (by) => {
    setListSortBy(prev => {
      const nextDir = prev.by === by && prev.dir === 'asc' ? 'desc' : 'asc'
      const next = { by, dir: nextDir }
      try { localStorage.setItem(LIST_SORT_KEY, JSON.stringify(next)) } catch (_) {}
      return next
    })
  }

  const toggleFolderExpanded = (folderId) => {
    setExpandedFolderIds(prev => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  const ASSET_DRAG_TYPE = 'application/x-comfystudio-asset-ids'

  const notifyAssetDragStart = (assetId, assetIds) => {
    if (typeof window === 'undefined') return
    try {
      window.dispatchEvent(new CustomEvent('comfystudio-assets-drag-start', {
        detail: { assetId, assetIds }
      }))
    } catch (_) {}
  }

  const notifyAssetDragEnd = () => {
    if (typeof window === 'undefined') return
    try {
      window.dispatchEvent(new Event('comfystudio-assets-drag-end'))
    } catch (_) {}
  }

  const clearAssetDragPreview = useCallback(() => {
    activeAssetDragIdRef.current = null
    setIsAssetDragActive(false)
    setAssetDragPreview(null)
  }, [])

  const updateAssetDragPreviewPosition = useCallback((clientX, clientY) => {
    const activeAssetId = activeAssetDragIdRef.current
    if (!activeAssetId) return
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return
    if (clientX === 0 && clientY === 0) return

    const panelBounds = panelRef.current?.getBoundingClientRect()
    const isInsidePanel = Boolean(
      panelBounds
      && clientX >= panelBounds.left
      && clientX <= panelBounds.right
      && clientY >= panelBounds.top
      && clientY <= panelBounds.bottom
    )

    if (!isInsidePanel) {
      setAssetDragPreview((prev) => (prev ? null : prev))
      return
    }

    setAssetDragPreview((prev) => {
      if (
        prev
        && prev.assetId === activeAssetId
        && prev.clientX === clientX
        && prev.clientY === clientY
      ) {
        return prev
      }
      return { assetId: activeAssetId, clientX, clientY }
    })
  }, [])

  const startAssetDrag = useCallback((e, assetId, assetIds) => {
    const orderedAssetIds = [
      assetId,
      ...(Array.isArray(assetIds) ? assetIds : []).filter((id) => id && id !== assetId),
    ]
    const data = JSON.stringify(orderedAssetIds)
    e.dataTransfer.setData('assetId', assetId)
    e.dataTransfer.setData(ASSET_DRAG_TYPE, data)
    e.dataTransfer.setData('text/plain', data)
    e.dataTransfer.effectAllowed = 'copyMove'

    const dragImage = getTransparentAssetDragImage()
    if (dragImage && typeof e.dataTransfer.setDragImage === 'function') {
      e.dataTransfer.setDragImage(dragImage, 0, 0)
    }

    activeAssetDragIdRef.current = assetId
    setIsAssetDragActive(true)
    updateAssetDragPreviewPosition(e.clientX, e.clientY)
    notifyAssetDragStart(assetId, orderedAssetIds)
  }, [updateAssetDragPreviewPosition])

  const endAssetDrag = useCallback(() => {
    clearAssetDragPreview()
    notifyAssetDragEnd()
  }, [clearAssetDragPreview])

  // Color palette for folders and assets (null = no color)
  const COLOR_PALETTE = [
    null,
    '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
    '#3b82f6', '#8b5cf6', '#ec4899', '#78716c',
  ]

  // Get assets from store
  const { 
    assets, 
    currentPreview, 
    setPreview, 
    removeAsset, 
    renameAsset, 
    addAsset,
    folders,
    addFolder,
    removeFolder,
    renameFolder,
    setFolderColor,
    setAssetColor,
    moveAssetToFolder,
    moveAssetsToFolder,
    generateAssetSprite,
    getAssetSprite,
    setAssetAudioEnabled,
  } = useAssetsStore()
  const { currentProjectHandle, getCurrentTimelineSettings } = useProjectStore()
  const { isPlaying: timelineIsPlaying, togglePlay: timelineTogglePlay, removeAudioClipsForAsset } = useTimelineStore()
  
  // Load thumbnail size from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('assetsThumbnailSize')
    if (saved && THUMBNAIL_SIZES[saved]) {
      setThumbnailSize(saved)
    }
  }, [])
  
  // Save thumbnail size to localStorage
  const setAndSaveThumbnailSize = (size) => {
    setThumbnailSize(size)
    localStorage.setItem('assetsThumbnailSize', size)
  }
  
  // Supported file types
  const SUPPORTED_VIDEO = ['.mp4', '.webm', '.mov']
  const SUPPORTED_AUDIO = ['.mp3', '.wav', '.ogg']
  const SUPPORTED_IMAGE = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
  const ALL_SUPPORTED = [...SUPPORTED_VIDEO, ...SUPPORTED_AUDIO, ...SUPPORTED_IMAGE]
  
  // Determine file category from extension
  const getFileCategory = (filename) => {
    const ext = '.' + filename.split('.').pop().toLowerCase()
    if (SUPPORTED_VIDEO.includes(ext)) return 'video'
    if (SUPPORTED_AUDIO.includes(ext)) return 'audio'
    if (SUPPORTED_IMAGE.includes(ext)) return 'images'
    return null
  }
  
  // Handle file import
  const handleImport = async (files) => {
    if (!currentProjectHandle || files.length === 0) return
    
    setIsImporting(true)
    
    for (const file of files) {
      const category = getFileCategory(file.name)
      if (!category) {
        console.warn(`Unsupported file type: ${file.name}`)
        continue
      }
      
      try {
        const assetInfo = await importAsset(currentProjectHandle, file, category)
        
        // Add to assets store with URL for playback
        const newAsset = addAsset({
          ...assetInfo,
          url: URL.createObjectURL(file),
          folderId: currentFolderId, // Add to current folder
          settings: {
            duration: assetInfo.duration,
            fps: assetInfo.fps,
          },
        })
        
        // Flame-style: transcode video for smooth playback (Electron only)
        if (category === 'video' && isElectron() && currentProjectHandle && newAsset?.absolutePath) {
          enqueuePlaybackTranscode(currentProjectHandle, newAsset.id, newAsset.absolutePath).catch(() => {})
        }
        
        // Auto-generate thumbnail sprites for videos in background
        if (category === 'video' && assetInfo.duration > 0.5 && newAsset) {
          const projectPath = typeof currentProjectHandle === 'string' ? currentProjectHandle : null
          // Generate sprites asynchronously (don't await)
          generateAssetSprite(newAsset.id, projectPath).catch(err => {
            console.warn('Auto-sprite generation failed:', err)
          })
        }
      } catch (err) {
        console.error(`Error importing ${file.name}:`, err)
      }
    }
    
    setIsImporting(false)
  }
  
  // Handle file input change
  const handleFileInputChange = (e) => {
    const files = Array.from(e.target.files || [])
    handleImport(files)
    e.target.value = ''
  }
  
  // Handle drag and drop
  const handleDragOver = (e) => {
    e.preventDefault()
    const isInternalAssetDrag = e.dataTransfer?.types?.includes(ASSET_DRAG_TYPE)
    if (isInternalAssetDrag) {
      setIsDragOver(false)
      updateAssetDragPreviewPosition(e.clientX, e.clientY)
      return
    }
    e.stopPropagation()
    setIsDragOver(true)
  }
  
  const handleDragLeave = (e) => {
    e.preventDefault()
    const isInternalAssetDrag = e.dataTransfer?.types?.includes(ASSET_DRAG_TYPE)
    if (!isInternalAssetDrag) {
      e.stopPropagation()
    }
    setIsDragOver(false)
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOverFolderId(null)
  }
  
  const handleDrop = (e) => {
    e.preventDefault()
    const isInternalAssetDrag = e.dataTransfer?.types?.includes(ASSET_DRAG_TYPE)
    if (!isInternalAssetDrag) {
      e.stopPropagation()
    }
    setIsDragOver(false)
    setDragOverFolderId(null)

    // Ignore internal asset drag (handled by folder drop targets)
    if (isInternalAssetDrag) return

    const files = Array.from(e.dataTransfer.files || [])
    const validFiles = files.filter(f => {
      const ext = '.' + f.name.split('.').pop().toLowerCase()
      return ALL_SUPPORTED.includes(ext)
    })
    if (validFiles.length > 0) {
      handleImport(validFiles)
    }
  }
  
  // Open file picker
  const openFilePicker = () => {
    fileInputRef.current?.click()
  }

  const closeOverlayModal = () => {
    setOverlayModalOpen(false)
  }

  const openOverlayGenerator = (type = 'letterbox', folderId = null) => {
    setOverlayModalFolderId(folderId)
    setOverlayModalInitialType(type)
    setOverlayModalOpen(true)
  }

  // Get current folder and its subfolders
  const currentFolder = currentFolderId ? folders?.find(f => f.id === currentFolderId) : null
  const subFolders = (folders || []).filter(f => f.parentId === currentFolderId)
  
  // Filter assets by current folder and search query
  const filteredAssets = assets.filter(asset => {
    const matchesFolder = (asset.folderId || null) === currentFolderId
    const matchesSearch = searchQuery === '' || 
      asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.prompt?.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesFolder && matchesSearch
  })
  
  // Get subfolders by parent (for list view expand)
  const getSubfoldersOf = (parentId) => (folders || []).filter(f => f.parentId === parentId)
  // Get assets in folder, optionally filtered by search
  const getAssetsInFolder = (folderId, search = '') => {
    return assets.filter(a => {
      const inFolder = (a.folderId || null) === folderId
      const matchesSearch = !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.prompt?.toLowerCase().includes(search.toLowerCase())
      return inFolder && matchesSearch
    })
  }

  // Count assets recursively so parent folders (e.g. Generated) reflect nested content.
  const folderDescendantIdsByFolderId = useMemo(() => {
    const childrenByParent = new Map()
    for (const folder of (folders || [])) {
      const parentId = folder?.parentId || null
      const existing = childrenByParent.get(parentId) || []
      existing.push(folder.id)
      childrenByParent.set(parentId, existing)
    }

    const descendantsByFolder = new Map()
    for (const folder of (folders || [])) {
      const descendants = new Set([folder.id])
      const queue = [folder.id]
      while (queue.length > 0) {
        const currentFolderId = queue.shift()
        const childIds = childrenByParent.get(currentFolderId) || []
        for (const childId of childIds) {
          if (descendants.has(childId)) continue
          descendants.add(childId)
          queue.push(childId)
        }
      }
      descendantsByFolder.set(folder.id, descendants)
    }

    return descendantsByFolder
  }, [folders])

  const getFolderItemCount = useCallback((folderId) => {
    const descendants = folderDescendantIdsByFolderId.get(folderId)
    if (!descendants || descendants.size === 0) return 0
    return assets.reduce((count, asset) => (
      descendants.has(asset.folderId || null) ? count + 1 : count
    ), 0)
  }, [assets, folderDescendantIdsByFolderId])

  // Get folder breadcrumb path
  const getFolderPath = () => {
    if (!currentFolderId) return []
    const path = []
    let folderId = currentFolderId
    while (folderId) {
      const folder = folders?.find(f => f.id === folderId)
      if (folder) {
        path.unshift(folder)
        folderId = folder.parentId
      } else {
        break
      }
    }
    return path
  }

  const getIcon = (type) => {
    switch (type) {
      case 'image': return Image
      case 'video': return Video
      case 'audio': return Music
      case 'mask': return Layers
      default: return FolderOpen
    }
  }
  
  // Check if asset can have a mask generated
  const canGenerateMask = (asset) => {
    return asset.type === 'video' || asset.type === 'image'
  }
  
  // Handle opening mask generation dialog
  const handleOpenMaskDialog = (assetId) => {
    const asset = assets.find(a => a.id === assetId)
    if (asset && canGenerateMask(asset)) {
      setMaskDialogAsset(asset)
      setContextMenu(null)
    }
  }
  
  // Check if asset can have thumbnails generated (videos only)
  const canGenerateThumbnails = (asset) => {
    return asset.type === 'video' && asset.duration > 0.5
  }
  
  // Handle generating thumbnail sprite
  const handleGenerateThumbnails = async (assetId) => {
    setContextMenu(null)
    const asset = assets.find(a => a.id === assetId)
    if (!asset || !canGenerateThumbnails(asset)) return
    
    // Get project path for saving sprites
    const projectPath = typeof currentProjectHandle === 'string' ? currentProjectHandle : null
    
    try {
      await generateAssetSprite(assetId, projectPath)
    } catch (err) {
      console.error('Failed to generate thumbnails:', err)
    }
  }

  // Format relative time
  const formatTime = (isoString) => {
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)
    
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    return date.toLocaleDateString()
  }

  // Asset value getters for sorting and display
  const getAssetSource = (a) => (a.isImported ? 'IMP' : 'AI')
  const getAssetDate = (a) => new Date(a.createdAt || a.imported || 0).getTime()
  const getAssetTypeLabel = (a) => {
    if (a.type === 'mask') return 'Mask'
    if (a.type === 'video') return 'Video'
    if (a.type === 'image') return 'Image'
    if (a.type === 'audio') return 'Audio'
    return a.type || '—'
  }

  const sortAssets = (list) => {
    const { by, dir } = listSortBy
    const mult = dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      let va, vb
      switch (by) {
        case 'name': va = (a.name || '').toLowerCase(); vb = (b.name || '').toLowerCase(); return mult * (va < vb ? -1 : va > vb ? 1 : 0)
        case 'type': va = getAssetTypeLabel(a); vb = getAssetTypeLabel(b); return mult * (va < vb ? -1 : va > vb ? 1 : 0)
        case 'source': va = getAssetSource(a); vb = getAssetSource(b); return mult * (va < vb ? -1 : va > vb ? 1 : 0)
        case 'date': default: va = getAssetDate(a); vb = getAssetDate(b); return mult * (va - vb)
      }
    })
  }

  // Handle double-click to preview
  const handleDoubleClick = (asset) => {
    if (timelineIsPlaying) {
      timelineTogglePlay()
    }
    setPreview(asset)
  }
  
  // Handle single-click to select and preview (with multi-select: Ctrl/Cmd toggle, Shift range)
  const handleClick = (e, asset) => {
    if (timelineIsPlaying) {
      timelineTogglePlay()
    }
    if (e?.ctrlKey || e?.metaKey) {
      setSelectedAssetIds(prev =>
        prev.includes(asset.id) ? prev.filter(id => id !== asset.id) : [...prev, asset.id]
      )
      setPreview(asset)
      return
    }
    if (e?.shiftKey) {
      const idx = filteredAssets.findIndex(a => a.id === asset.id)
      const lastId = selectedAssetIds[selectedAssetIds.length - 1]
      const lastIdx = filteredAssets.findIndex(a => a.id === lastId)
      const from = lastIdx >= 0 ? Math.min(lastIdx, idx) : idx
      const to = lastIdx >= 0 ? Math.max(lastIdx, idx) : idx
      const rangeIds = filteredAssets.slice(from, to + 1).map(a => a.id)
      setSelectedAssetIds(rangeIds)
      setPreview(asset)
      return
    }
    setSelectedAssetIds([asset.id])
    setPreview(asset)
  }

  const requestConfirm = useCallback(({
    title = 'Confirm action',
    message = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    tone = 'danger',
  }) => {
    if (confirmResolverRef.current) {
      confirmResolverRef.current(false)
      confirmResolverRef.current = null
    }
    return new Promise((resolve) => {
      confirmResolverRef.current = resolve
      setConfirmDialog({ title, message, confirmLabel, cancelLabel, tone })
    })
  }, [])

  const resolveConfirmDialog = useCallback((accepted) => {
    setConfirmDialog(null)
    const resolve = confirmResolverRef.current
    confirmResolverRef.current = null
    if (resolve) resolve(Boolean(accepted))
  }, [])

  useEffect(() => () => {
    if (confirmResolverRef.current) {
      confirmResolverRef.current(false)
      confirmResolverRef.current = null
    }
  }, [])
  
  // Keyboard handler for Delete/Backspace (and Escape to clear selection)
  useEffect(() => {
    const handleKeyDown = async (e) => {
      if (!panelRef.current?.contains(document.activeElement) && document.activeElement !== panelRef.current) return
      if (confirmDialog) return
      const active = document.activeElement
      if (editingId || (active && (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable))) return

      if (e.key === 'Escape') {
        setSelectedAssetIds([])
        return
      }
      // Don't delete assets when timeline has selected clips — let the timeline handle Delete (clip removal)
      const timelineSelectedClipIds = useTimelineStore.getState().selectedClipIds
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAssetIds.length > 0) {
        if (timelineSelectedClipIds?.length > 0) return
        e.preventDefault()
        e.stopPropagation()
        const count = selectedAssetIds.length
        const confirmed = await requestConfirm({
          title: count === 1 ? 'Delete asset?' : 'Delete selected assets?',
          message: count === 1 ? 'Delete this asset?' : `Delete ${count} selected assets?`,
          confirmLabel: count === 1 ? 'Delete asset' : 'Delete assets',
          cancelLabel: 'Keep',
          tone: 'danger',
        })
        if (confirmed) {
          selectedAssetIds.forEach(id => removeAsset(id))
          setSelectedAssetIds([])
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedAssetIds, editingId, removeAsset, requestConfirm, confirmDialog])
  
  // Handle folder click
  const handleFolderClick = (folderId) => {
    setCurrentFolderId(folderId)
  }

  // Start editing name
  const startEditing = (e, asset) => {
    e.stopPropagation()
    setEditingId(asset.id)
    setEditName(asset.name)
  }

  // Save edited name
  const saveEdit = (e) => {
    e.preventDefault()
    if (editName.trim() && editingId) {
      renameAsset(editingId, editName.trim())
    }
    setEditingId(null)
    setEditName('')
  }

  // Handle delete
  const handleDelete = async (e, id) => {
    e.stopPropagation()
    const confirmed = await requestConfirm({
      title: 'Delete asset?',
      message: 'Delete this asset?',
      confirmLabel: 'Delete asset',
      cancelLabel: 'Keep',
      tone: 'danger',
    })
    if (confirmed) {
      removeAsset(id)
    }
  }

  const handleDeleteFolder = useCallback(async (folderId, folderName) => {
    const confirmed = await requestConfirm({
      title: 'Delete folder?',
      message: `Delete folder "${folderName}"?`,
      confirmLabel: 'Delete folder',
      cancelLabel: 'Keep',
      tone: 'danger',
    })
    if (!confirmed) return false
    removeFolder(folderId)
    return true
  }, [removeFolder, requestConfirm])

  // Toggle audio on a video asset
  const handleToggleVideoAudio = (assetId) => {
    const asset = assets.find(a => a.id === assetId)
    if (!asset || asset.type !== 'video') return
    if (asset.hasAudio === false) {
      setContextMenu(null)
      return
    }
    const nextEnabled = asset.audioEnabled === false
    setAssetAudioEnabled(assetId, nextEnabled)
    if (!nextEnabled) {
      removeAudioClipsForAsset(assetId)
    }
    setContextMenu(null)
  }
  
  // Create new folder
  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      addFolder({
        name: newFolderName.trim(),
        parentId: currentFolderId
      })
      setNewFolderName('')
      setShowNewFolderInput(false)
    }
  }
  
  // Handle context menu (on asset)
  const handleContextMenu = (e, assetId) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, assetId, folderId: null })
  }

  // Handle context menu (on folder)
  const handleFolderContextMenu = (e, folderId) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, assetId: null, folderId })
  }

  // Handle context menu on empty area (right-click on background / empty spot)
  const handleEmptyAreaContextMenu = (e) => {
    if (e.target.closest('[data-is-asset], [data-is-folder]')) return
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, assetId: null, folderId: null })
  }

  // Empty-area menu actions
  const handleEmptyMenuNewFolder = () => {
    setContextMenu(null)
    setShowNewFolderInput(true)
  }
  const handleEmptyMenuImport = () => {
    setContextMenu(null)
    openFilePicker()
  }
  
  // Close context menu when clicking outside
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = () => setContextMenu(null)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [contextMenu])

  useEffect(() => {
    if (!isAssetDragActive) return undefined

    const handleWindowDragOver = (e) => {
      updateAssetDragPreviewPosition(e.clientX, e.clientY)
    }
    const handleWindowDrop = () => clearAssetDragPreview()
    const handleWindowDragEnd = () => clearAssetDragPreview()

    window.addEventListener('dragover', handleWindowDragOver, true)
    window.addEventListener('drop', handleWindowDrop, true)
    window.addEventListener('dragend', handleWindowDragEnd, true)

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver, true)
      window.removeEventListener('drop', handleWindowDrop, true)
      window.removeEventListener('dragend', handleWindowDragEnd, true)
    }
  }, [isAssetDragActive, updateAssetDragPreviewPosition, clearAssetDragPreview])
  
  // Move asset(s) to folder
  const handleMoveToFolder = (assetIdOrIds, folderId) => {
    const ids = Array.isArray(assetIdOrIds) ? assetIdOrIds : [assetIdOrIds]
    if (ids.length > 1) moveAssetsToFolder(ids, folderId)
    else moveAssetToFolder(ids[0], folderId)
    setContextMenu(null)
    setSelectedAssetIds([])
  }

  // Drop target handlers for dragging assets onto folders
  const handleFolderDragOver = (e, folderId) => {
    if (!e.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(false)
    updateAssetDragPreviewPosition(e.clientX, e.clientY)
    setDragOverFolderId(folderId)
  }
  const handleFolderDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOverFolderId(null)
  }
  const handleFolderDrop = (e, folderId) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverFolderId(null)
    // Some browsers don't expose custom MIME type on drop; fallback to text/plain
    const raw = e.dataTransfer.getData(ASSET_DRAG_TYPE) || e.dataTransfer.getData('text/plain')
    if (!raw) return
    try {
      const assetIds = JSON.parse(raw)
      if (Array.isArray(assetIds) && assetIds.length > 0) {
        moveAssetsToFolder(assetIds, folderId === 'root' ? null : folderId)
        setSelectedAssetIds([])
      }
    } catch (_) {}
  }
  
  // Focus new folder input when shown
  useEffect(() => {
    if (showNewFolderInput && newFolderInputRef.current) {
      newFolderInputRef.current.focus()
    }
  }, [showNewFolderInput])
  
  // Get thumbnail size config
  const sizeConfig = THUMBNAIL_SIZES[thumbnailSize]
  const folderTileIconSize = FOLDER_TILE_ICON_SIZES[thumbnailSize] || FOLDER_TILE_ICON_SIZES.medium
  const listDetailsGridColumns = 'grid-cols-[minmax(0,1fr)_64px_44px_86px_28px]'
  const dragPreviewAsset = assetDragPreview
    ? assets.find((asset) => asset.id === assetDragPreview.assetId) || null
    : null
  const DragPreviewIcon = dragPreviewAsset ? getIcon(dragPreviewAsset.type) : null

  // List view: recursive folder row with expand arrow and inline contents
  const ListFolderRow = ({ folder, depth }) => {
    const isExpanded = expandedFolderIds.has(folder.id)
    const childFolders = getSubfoldersOf(folder.id)
    const childAssets = getAssetsInFolder(folder.id, searchQuery)
    return (
      <>
        <div
          data-is-folder
          style={{ paddingLeft: depth * 14, ...(folder.color ? { borderLeft: `3px solid ${folder.color}` } : {}) }}
          onClick={() => handleFolderClick(folder.id)}
          onDragOver={(e) => handleFolderDragOver(e, folder.id)}
          onDragLeave={handleFolderDragLeave}
          onDrop={(e) => handleFolderDrop(e, folder.id)}
          onContextMenu={(e) => handleFolderContextMenu(e, folder.id)}
          className={`flex items-center gap-2 p-1.5 rounded cursor-pointer transition-colors group ${
            dragOverFolderId === folder.id ? 'bg-sf-accent/20 ring-1 ring-sf-accent' : 'hover:bg-sf-dark-800'
          }`}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleFolderExpanded(folder.id) }}
            className="p-0.5 -m-0.5 flex-shrink-0 rounded hover:bg-sf-dark-700 text-sf-text-muted"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
          <FolderOpen className="w-3.5 h-3.5 text-sf-accent flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-sf-text-primary truncate">{folder.name}</p>
            <p className="text-[9px] text-sf-text-muted">{getFolderItemCount(folder.id)} items</p>
          </div>
          <button
            onClick={async (e) => {
              e.stopPropagation()
              await handleDeleteFolder(folder.id, folder.name)
            }}
            className="p-0.5 opacity-0 group-hover:opacity-100 hover:bg-sf-error rounded transition-opacity"
          >
            <Trash2 className="w-2.5 h-2.5 text-sf-text-muted" />
          </button>
        </div>
        {isExpanded && (
          <div className="space-y-0.5">
            {childFolders.map(f => <ListFolderRow key={f.id} folder={f} depth={depth + 1} />)}
            {sortAssets(childAssets).map((asset) => {
              const Icon = getIcon(asset.type)
              const isSelected = selectedAssetIds.includes(asset.id) || currentPreview?.id === asset.id
              const idsToMove = selectedAssetIds.includes(asset.id) ? selectedAssetIds : [asset.id]
              return (
                <div
                  key={asset.id}
                  data-is-asset
                  draggable
                  style={{
                    paddingLeft: (depth + 1) * 14,
                    ...(asset.color ? { borderLeft: `3px solid ${asset.color}` } : {}),
                  }}
                  onDragStart={(e) => startAssetDrag(e, asset.id, idsToMove)}
                  onDragEnd={endAssetDrag}
                  onClick={(e) => handleClick(e, asset)}
                  onDoubleClick={() => handleDoubleClick(asset)}
                  onContextMenu={(e) => handleContextMenu(e, asset.id)}
                  className={`grid ${listDetailsGridColumns} gap-1 items-center px-1.5 py-1 rounded cursor-pointer transition-colors group ${isSelected ? 'bg-sf-accent/20' : 'hover:bg-sf-dark-800'}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded overflow-hidden bg-sf-dark-700 flex-shrink-0 flex items-center justify-center">
                      {asset.type === 'video' && asset.url ? (
                        <video src={asset.url} className="w-full h-full object-cover" muted preload="metadata" />
                      ) : asset.type === 'image' && asset.url ? (
                        <img src={asset.url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Icon className="w-3.5 h-3.5 text-sf-text-muted" />
                      )}
                    </div>
                    {editingId === asset.id ? (
                      <form onSubmit={saveEdit} className="min-w-0 flex-1">
                        <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} onBlur={saveEdit} autoFocus className="w-full bg-sf-dark-700 border border-sf-accent rounded px-1 py-0.5 text-[10px] text-sf-text-primary focus:outline-none" />
                      </form>
                    ) : (
                      <span className="text-[11px] text-sf-text-primary truncate block">{asset.name}</span>
                    )}
                  </div>
                  <span className="text-[10px] text-sf-text-muted truncate">{getAssetTypeLabel(asset)}</span>
                  <span className={`text-[9px] font-medium px-1 py-0.5 rounded ${asset.isImported ? 'bg-sf-dark-700 text-sf-text-secondary' : 'bg-sf-accent/90 text-white'}`}>{getAssetSource(asset)}</span>
                  <span className="text-[10px] text-sf-text-muted truncate">{formatTime(asset.createdAt)}</span>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => startEditing(e, asset)} className="p-0.5 hover:bg-sf-dark-700 rounded" title="Rename"><Edit3 className="w-2.5 h-2.5 text-sf-text-muted" /></button>
                    <button onClick={(e) => handleDelete(e, asset.id)} className="p-0.5 hover:bg-sf-error rounded" title="Delete"><Trash2 className="w-2.5 h-2.5 text-sf-text-muted" /></button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </>
    )
  }

  return (
    <div 
      ref={panelRef}
      tabIndex={-1}
      className={`h-full flex flex-col outline-none ${isDragOver ? 'ring-2 ring-sf-accent ring-inset' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ALL_SUPPORTED.join(',')}
        onChange={handleFileInputChange}
        className="hidden"
      />
      
      {/* Header */}
      <div className="p-2 border-b border-sf-dark-700 space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-sf-text-muted" />
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-sf-dark-800 border border-sf-dark-600 rounded pl-7 pr-2 py-1 text-xs text-sf-text-primary placeholder-sf-text-muted focus:outline-none focus:border-sf-accent"
            />
          </div>
          
          <div className="flex items-center gap-0.5 bg-sf-dark-800 rounded p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1 rounded ${viewMode === 'grid' ? 'bg-sf-dark-600' : ''}`}
              title="Grid view"
            >
              <Grid className="w-3.5 h-3.5 text-sf-text-secondary" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1 rounded ${viewMode === 'list' ? 'bg-sf-dark-600' : ''}`}
              title="List view"
            >
              <List className="w-3.5 h-3.5 text-sf-text-secondary" />
            </button>
          </div>
          
          <button 
            onClick={openFilePicker}
            disabled={!currentProjectHandle || isImporting}
            className="p-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 disabled:opacity-50 rounded transition-colors" 
            title="Import Media"
          >
            {isImporting ? (
              <Loader2 className="w-3.5 h-3.5 text-sf-text-secondary animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5 text-sf-text-secondary" />
            )}
          </button>
        </div>
        
        {/* Thumbnail size control (only in grid mode) */}
        {viewMode === 'grid' && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-sf-text-muted">Size:</span>
            <div className="flex items-center gap-1 flex-1">
              <Minus className="w-3 h-3 text-sf-text-muted" />
              <input
                type="range"
                min="0"
                max={THUMBNAIL_SIZE_ORDER.length - 1}
                value={THUMBNAIL_SIZE_ORDER.indexOf(thumbnailSize)}
                onChange={(e) => {
                  const index = Math.max(0, Math.min(parseInt(e.target.value, 10) || 0, THUMBNAIL_SIZE_ORDER.length - 1))
                  setAndSaveThumbnailSize(THUMBNAIL_SIZE_ORDER[index])
                }}
                className="flex-1 h-1 bg-sf-dark-600 rounded-lg appearance-none cursor-pointer accent-sf-accent"
              />
              <Plus className="w-3 h-3 text-sf-text-muted" />
            </div>
            <button
              onClick={() => setShowNewFolderInput(true)}
              className="p-1 hover:bg-sf-dark-700 rounded transition-colors"
              title="New Folder"
            >
              <FolderPlus className="w-3.5 h-3.5 text-sf-text-secondary" />
            </button>
          </div>
        )}
        
        {/* Folder breadcrumb navigation */}
        {(currentFolderId || subFolders.length > 0 || folders?.length > 0) && (
          <div className="flex items-center gap-1 text-[10px] overflow-x-auto">
            <button
              onClick={() => setCurrentFolderId(null)}
              onDragOver={(e) => handleFolderDragOver(e, 'root')}
              onDragLeave={handleFolderDragLeave}
              onDrop={(e) => handleFolderDrop(e, null)}
              className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded transition-colors ${
                !currentFolderId ? 'text-sf-accent' : 'text-sf-text-muted'
              } ${dragOverFolderId === 'root' ? 'ring-1 ring-sf-accent bg-sf-accent/20' : 'hover:bg-sf-dark-700'}`}
            >
              <Home className="w-3 h-3" />
              <span>Root</span>
            </button>
            {getFolderPath().map((folder, idx) => (
              <div key={folder.id} className="flex items-center">
                <ChevronRight className="w-3 h-3 text-sf-text-muted" />
                <button
                  onClick={() => setCurrentFolderId(folder.id)}
                  onDragOver={(e) => handleFolderDragOver(e, folder.id)}
                  onDragLeave={handleFolderDragLeave}
                  onDrop={(e) => handleFolderDrop(e, folder.id)}
                  className={`px-1.5 py-0.5 rounded transition-colors ${
                    folder.id === currentFolderId ? 'text-sf-accent' : 'text-sf-text-muted'
                  } ${dragOverFolderId === folder.id ? 'ring-1 ring-sf-accent bg-sf-accent/20' : 'hover:bg-sf-dark-700'}`}
                >
                  {folder.name}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* New folder input */}
      {showNewFolderInput && (
        <div className="px-2 py-1.5 border-b border-sf-dark-700 flex items-center gap-2">
          <FolderPlus className="w-3.5 h-3.5 text-sf-accent" />
          <input
            ref={newFolderInputRef}
            type="text"
            placeholder="Folder name..."
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                handleCreateFolder()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setShowNewFolderInput(false)
              }
            }}
            onBlur={() => {
              if (!newFolderName.trim()) setShowNewFolderInput(false)
            }}
            className="flex-1 bg-sf-dark-800 border border-sf-accent rounded px-2 py-0.5 text-xs text-sf-text-primary placeholder-sf-text-muted focus:outline-none"
          />
          <button
            onClick={handleCreateFolder}
            disabled={!newFolderName.trim()}
            className="px-2 py-0.5 bg-sf-accent text-white text-[10px] rounded disabled:opacity-50"
          >
            Create
          </button>
        </div>
      )}
      
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 bg-sf-accent/20 border-2 border-dashed border-sf-accent rounded-lg flex items-center justify-center z-10 pointer-events-none">
          <div className="text-center">
            <Upload className="w-8 h-8 text-sf-accent mx-auto mb-2" />
            <p className="text-sm text-sf-text-primary font-medium">Drop to import</p>
            <p className="text-xs text-sf-text-muted">Video, audio, or image files</p>
          </div>
        </div>
      )}
      
      {/* Assets Grid/List */}
      <div 
        className="flex-1 p-2 overflow-auto relative"
        onContextMenu={handleEmptyAreaContextMenu}
        onDoubleClick={(e) => {
          // Double-click on empty area triggers import
          if (e.target === e.currentTarget || e.target.closest('.empty-state-container')) {
            openFilePicker()
          }
        }}
      >
        {filteredAssets.length === 0 && subFolders.length === 0 ? (
          <div className="empty-state-container h-full flex flex-col items-center justify-center text-sf-text-muted">
            <Video className="w-10 h-10 mb-2 opacity-50" />
            <p className="text-xs">No assets yet</p>
            <p className="text-[10px] mt-1">Generate AI videos or import your footage</p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={openFilePicker}
                disabled={!currentProjectHandle}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 disabled:opacity-50 rounded text-xs text-sf-text-secondary transition-colors"
              >
                <Upload className="w-3 h-3" />
                Import Media
              </button>
              <button
                onClick={() => setShowNewFolderInput(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-xs text-sf-text-secondary transition-colors"
              >
                <FolderPlus className="w-3 h-3" />
                New Folder
              </button>
            </div>
          </div>
        ) : viewMode === 'grid' ? (
          <div 
            className={`grid gap-2`} 
            style={{ gridTemplateColumns: `repeat(${sizeConfig.cols}, minmax(0, 1fr))` }}
            onDoubleClick={(e) => {
              // Double-click on empty grid area triggers import
              if (e.target === e.currentTarget) {
                openFilePicker()
              }
            }}
          >
            {/* Back button if in a folder */}
            {currentFolderId && (
              <button
                onClick={() => setCurrentFolderId(currentFolder?.parentId || null)}
                className="aspect-video bg-sf-dark-800 border border-sf-dark-600 rounded flex flex-col items-center justify-center hover:border-sf-dark-500 transition-colors"
              >
                <ChevronLeft className={`${sizeConfig.iconSize} text-sf-text-muted mb-1`} />
                <span className={`${sizeConfig.nameSize} text-sf-text-muted`}>Back</span>
              </button>
            )}
            
            {/* Subfolders */}
            {subFolders.map((folder) => (
              <div
                key={folder.id}
                data-is-folder
                onClick={() => handleFolderClick(folder.id)}
                onDragOver={(e) => handleFolderDragOver(e, folder.id)}
                onDragLeave={handleFolderDragLeave}
                onDrop={(e) => handleFolderDrop(e, folder.id)}
                onContextMenu={(e) => handleFolderContextMenu(e, folder.id)}
                className={`bg-sf-dark-800 border rounded cursor-pointer transition-colors group overflow-hidden ${
                  dragOverFolderId === folder.id ? 'border-sf-accent ring-2 ring-sf-accent ring-offset-1 ring-offset-sf-dark-900' : 'border-sf-dark-600 hover:border-sf-dark-500'
                }`}
                style={folder.color ? { borderLeftWidth: '4px', borderLeftColor: folder.color } : {}}
              >
                <div className="aspect-video bg-gradient-to-b from-sf-dark-700/25 to-sf-dark-900/75 flex items-center justify-center">
                  <FolderOpen className={`${folderTileIconSize} text-sf-accent/80`} strokeWidth={1.6} />
                </div>
                <div className="px-1.5 py-1 border-t border-sf-dark-700/80 bg-sf-dark-900/85 text-center leading-tight">
                  <span className={`${sizeConfig.nameSize} block text-sf-text-primary truncate`}>
                    {folder.name}
                  </span>
                  <span className={`${sizeConfig.infoSize} text-sf-text-muted`}>
                    {getFolderItemCount(folder.id)} items
                  </span>
                </div>
              </div>
            ))}
            
            {/* Assets */}
            {filteredAssets.map((asset) => {
              const Icon = getIcon(asset.type)
              const isSelected = selectedAssetIds.includes(asset.id) || currentPreview?.id === asset.id
              const idsToMove = selectedAssetIds.includes(asset.id) ? selectedAssetIds : [asset.id]

              return (
                <div
                  key={asset.id}
                  data-is-asset
                  draggable
                  onDragStart={(e) => startAssetDrag(e, asset.id, idsToMove)}
                  onDragEnd={endAssetDrag}
                  onClick={(e) => handleClick(e, asset)}
                  onDoubleClick={() => handleDoubleClick(asset)}
                  onContextMenu={(e) => handleContextMenu(e, asset.id)}
                  className={`bg-sf-dark-800 border rounded overflow-hidden cursor-grab transition-all group ${
                    isSelected 
                      ? 'border-sf-accent ring-1 ring-sf-accent' 
                      : 'border-sf-dark-600 hover:border-sf-dark-500'
                  }`}
                  style={asset.color ? { borderLeftWidth: '4px', borderLeftColor: asset.color } : {}}
                >
                  {/* Thumbnail */}
                  <div className="aspect-video bg-sf-dark-700 flex items-center justify-center relative overflow-hidden">
                    {asset.type === 'video' && asset.url ? (
                      <video
                        src={asset.url}
                        className="w-full h-full object-cover"
                        muted
                        onMouseEnter={(e) => e.target.play()}
                        onMouseLeave={(e) => {
                          e.target.pause()
                          e.target.currentTime = 0
                        }}
                      />
                    ) : asset.type === 'image' && asset.url ? (
                      <img
                        src={asset.url}
                        alt={asset.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Icon className={`${sizeConfig.iconSize} text-sf-text-muted`} />
                    )}
                    
                    {/* Badge - AI, Imported, or Mask */}
                    <div className={`absolute top-0.5 left-0.5 px-1 py-0.5 rounded ${sizeConfig.badgeSize} text-white font-medium ${
                      asset.type === 'mask' ? 'bg-purple-600/90' : asset.isImported ? 'bg-sf-dark-700/90' : 'bg-sf-accent/90'
                    }`}>
                      {asset.type === 'mask' ? 'MASK' : asset.isImported ? 'IMP' : 'AI'}
                    </div>
                    
                    {/* Sprite badge - shows if thumbnails are ready */}
                    {asset.type === 'video' && asset.sprite?.url && (
                      <div className={`absolute bottom-0.5 left-0.5 px-1 py-0.5 rounded ${sizeConfig.badgeSize} text-white font-medium bg-sf-blue/90`} title="Thumbnails ready for fast scrubbing">
                        <Film className="w-2 h-2 inline-block" />
                      </div>
                    )}
                    
                    {/* Generating indicator */}
                    {asset.spriteGenerating && (
                      <div className="absolute bottom-0.5 left-0.5 px-1 py-0.5 rounded bg-sf-dark-800/90">
                        <Loader2 className={`w-2 h-2 text-sf-blue animate-spin`} />
                      </div>
                    )}
                    
                    {/* Play overlay on hover */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Play className={`${sizeConfig.playSize} text-white`} />
                    </div>

                    {/* Actions */}
                    <div className="absolute top-0.5 right-0.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => startEditing(e, asset)}
                        className="p-0.5 bg-sf-dark-800/90 hover:bg-sf-dark-700 rounded"
                        title="Rename"
                      >
                        <Edit3 className="w-2.5 h-2.5 text-sf-text-muted" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(e, asset.id)}
                        className="p-0.5 bg-sf-dark-800/90 hover:bg-sf-error rounded"
                        title="Delete"
                      >
                        <Trash2 className="w-2.5 h-2.5 text-sf-text-muted" />
                      </button>
                    </div>
                  </div>
                  
                  {/* Info */}
                  <div className="p-1.5">
                    {editingId === asset.id ? (
                      <form onSubmit={saveEdit}>
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onBlur={saveEdit}
                          autoFocus
                          className={`w-full bg-sf-dark-700 border border-sf-accent rounded px-1 py-0.5 ${sizeConfig.nameSize} text-sf-text-primary focus:outline-none`}
                        />
                      </form>
                    ) : (
                      <p className={`${sizeConfig.nameSize} text-sf-text-primary truncate`} title={asset.name}>
                        {asset.name}
                      </p>
                    )}
                    <p className={`${sizeConfig.infoSize} text-sf-text-muted mt-0.5`}>
                      {formatTime(asset.createdAt)} • {asset.settings?.duration ? `${asset.settings.duration}s` : asset.type}
                    </p>
                  </div>
                </div>
              )
            })}
            
            {/* Upload placeholder */}
            <button
              onClick={openFilePicker}
              disabled={!currentProjectHandle || isImporting}
              className="aspect-video border-2 border-dashed border-sf-dark-600 rounded flex items-center justify-center hover:border-sf-accent disabled:opacity-50 cursor-pointer transition-colors"
            >
              <div className="text-center">
                {isImporting ? (
                  <Loader2 className={`${sizeConfig.iconSize} text-sf-text-muted mx-auto mb-1 animate-spin`} />
                ) : (
                  <Upload className={`${sizeConfig.iconSize} text-sf-text-muted mx-auto mb-1`} />
                )}
                <span className={`${sizeConfig.nameSize} text-sf-text-muted`}>Import</span>
              </div>
            </button>
          </div>
        ) : (
          /* List View (details style with sortable columns) */
          <div 
            className="flex flex-col min-h-0"
            onDoubleClick={(e) => {
              if (e.target === e.currentTarget) openFilePicker()
            }}
          >
            {/* Back button if in a folder */}
            {currentFolderId && (
              <button
                onClick={() => setCurrentFolderId(currentFolder?.parentId || null)}
                className="w-full flex items-center gap-2 p-1.5 rounded hover:bg-sf-dark-800 transition-colors flex-shrink-0"
              >
                <ChevronLeft className="w-3.5 h-3.5 text-sf-text-muted" />
                <span className="text-[11px] text-sf-text-muted">Back</span>
              </button>
            )}

            {/* Column headers - sortable */}
            <div className={`grid ${listDetailsGridColumns} gap-1 px-1.5 py-1 border-b border-sf-dark-700 flex-shrink-0 text-[10px] text-sf-text-muted font-medium`}>
              <button type="button" onClick={() => setListSort('name')} className="text-left hover:text-sf-text-primary flex items-center gap-0.5 truncate">
                Name {listSortBy.by === 'name' ? (listSortBy.dir === 'asc' ? <ArrowUp className="w-3 h-3 flex-shrink-0" /> : <ArrowDown className="w-3 h-3 flex-shrink-0" />) : <ArrowUpDown className="w-3 h-3 flex-shrink-0 opacity-50" />}
              </button>
              <button type="button" onClick={() => setListSort('type')} className="text-left hover:text-sf-text-primary flex items-center gap-0.5">
                Type {listSortBy.by === 'type' ? (listSortBy.dir === 'asc' ? <ArrowUp className="w-3 h-3 flex-shrink-0" /> : <ArrowDown className="w-3 h-3 flex-shrink-0" />) : <ArrowUpDown className="w-3 h-3 flex-shrink-0 opacity-50" />}
              </button>
              <button type="button" onClick={() => setListSort('source')} className="text-left hover:text-sf-text-primary flex items-center gap-0.5">
                Source {listSortBy.by === 'source' ? (listSortBy.dir === 'asc' ? <ArrowUp className="w-3 h-3 flex-shrink-0" /> : <ArrowDown className="w-3 h-3 flex-shrink-0" />) : <ArrowUpDown className="w-3 h-3 flex-shrink-0 opacity-50" />}
              </button>
              <button type="button" onClick={() => setListSort('date')} className="text-left hover:text-sf-text-primary flex items-center gap-0.5">
                Date {listSortBy.by === 'date' ? (listSortBy.dir === 'asc' ? <ArrowUp className="w-3 h-3 flex-shrink-0" /> : <ArrowDown className="w-3 h-3 flex-shrink-0" />) : <ArrowUpDown className="w-3 h-3 flex-shrink-0 opacity-50" />}
              </button>
              <span className="w-7" aria-hidden />
            </div>
            
            <div className="flex-1 min-h-0 overflow-auto space-y-0.5">
            {/* Subfolders (with expand arrow to show contents inline) */}
            {subFolders.map((folder) => (
              <ListFolderRow key={folder.id} folder={folder} depth={0} />
            ))}
            
            {/* Assets in current folder - sorted, details columns */}
            {sortAssets(filteredAssets).map((asset) => {
              const Icon = getIcon(asset.type)
              const isSelected = selectedAssetIds.includes(asset.id) || currentPreview?.id === asset.id
              const idsToMove = selectedAssetIds.includes(asset.id) ? selectedAssetIds : [asset.id]

              return (
                <div 
                  key={asset.id}
                  data-is-asset
                  draggable
                  onDragStart={(e) => startAssetDrag(e, asset.id, idsToMove)}
                  onDragEnd={endAssetDrag}
                  onClick={(e) => handleClick(e, asset)}
                  onDoubleClick={() => handleDoubleClick(asset)}
                  onContextMenu={(e) => handleContextMenu(e, asset.id)}
                  className={`grid ${listDetailsGridColumns} gap-1 items-center px-1.5 py-1 rounded cursor-pointer transition-colors group ${
                    isSelected ? 'bg-sf-accent/20' : 'hover:bg-sf-dark-800'
                  }`}
                  style={asset.color ? { borderLeft: `3px solid ${asset.color}` } : {}}
                >
                  {/* Name + thumbnail */}
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded overflow-hidden bg-sf-dark-700 flex-shrink-0 flex items-center justify-center">
                      {asset.type === 'video' && asset.url ? (
                        <video src={asset.url} className="w-full h-full object-cover" muted preload="metadata" />
                      ) : asset.type === 'image' && asset.url ? (
                        <img src={asset.url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Icon className="w-3.5 h-3.5 text-sf-text-muted" />
                      )}
                    </div>
                    {editingId === asset.id ? (
                      <form onSubmit={saveEdit} className="min-w-0 flex-1">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onBlur={saveEdit}
                          autoFocus
                          className="w-full bg-sf-dark-700 border border-sf-accent rounded px-1 py-0.5 text-[10px] text-sf-text-primary focus:outline-none"
                        />
                      </form>
                    ) : (
                      <span className="text-[11px] text-sf-text-primary truncate block">{asset.name}</span>
                    )}
                  </div>
                  <span className="text-[10px] text-sf-text-muted truncate">{getAssetTypeLabel(asset)}</span>
                  <span className={`text-[9px] font-medium px-1 py-0.5 rounded ${asset.isImported ? 'bg-sf-dark-700 text-sf-text-secondary' : 'bg-sf-accent/90 text-white'}`}>{getAssetSource(asset)}</span>
                  <span className="text-[10px] text-sf-text-muted truncate" title={asset.createdAt}>{formatTime(asset.createdAt)}</span>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => startEditing(e, asset)} className="p-0.5 hover:bg-sf-dark-700 rounded" title="Rename"><Edit3 className="w-2.5 h-2.5 text-sf-text-muted" /></button>
                    <button onClick={(e) => handleDelete(e, asset.id)} className="p-0.5 hover:bg-sf-error rounded" title="Delete"><Trash2 className="w-2.5 h-2.5 text-sf-text-muted" /></button>
                  </div>
                </div>
              )
            })}
            </div>
          </div>
        )}
      </div>

      {/* Asset drag thumbnail: shown only while cursor remains over Assets panel */}
      {dragPreviewAsset && assetDragPreview && (
        <div
          className="fixed z-[70] pointer-events-none bg-sf-dark-800/95 border border-sf-dark-500 rounded-md shadow-lg px-2 py-1.5 max-w-[220px]"
          style={{
            left: assetDragPreview.clientX + 14,
            top: assetDragPreview.clientY + 14,
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-10 h-7 rounded overflow-hidden bg-sf-dark-700 flex-shrink-0 flex items-center justify-center">
              {dragPreviewAsset.type === 'video' && dragPreviewAsset.url ? (
                <video src={dragPreviewAsset.url} className="w-full h-full object-cover" muted preload="metadata" />
              ) : dragPreviewAsset.type === 'image' && dragPreviewAsset.url ? (
                <img src={dragPreviewAsset.url} alt="" className="w-full h-full object-cover" />
              ) : (
                DragPreviewIcon && <DragPreviewIcon className="w-4 h-4 text-sf-text-muted" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-[10px] text-sf-text-primary truncate">{dragPreviewAsset.name}</div>
              <div className="text-[9px] text-sf-text-muted truncate">{getAssetTypeLabel(dragPreviewAsset)}</div>
            </div>
          </div>
        </div>
      )}
      
      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-sf-dark-800 border border-sf-dark-600 rounded-lg shadow-xl py-1 min-w-[160px] z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Folder menu: Set color + Delete */}
          {contextMenu.folderId ? (
            <>
              <div className="px-3 py-1 text-[10px] text-sf-text-muted uppercase tracking-wider">Color</div>
              <div className="px-2 py-1 flex flex-wrap gap-1">
                {COLOR_PALETTE.map((c) => (
                  <button
                    key={c ?? 'none'}
                    type="button"
                    onClick={() => {
                      setFolderColor(contextMenu.folderId, c)
                      setContextMenu(null)
                    }}
                    className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center ${(folders?.find(f => f.id === contextMenu.folderId)?.color ?? null) === c ? 'border-white scale-110' : 'border-sf-dark-600 hover:border-sf-dark-500'} ${!c ? 'bg-sf-dark-600' : ''}`}
                    style={c ? { backgroundColor: c } : {}}
                    title={c ? c : 'None'}
                  >
                    {!c && <Minus className="w-3 h-3 text-sf-text-muted" />}
                  </button>
                ))}
              </div>
              <div className="border-t border-sf-dark-600 my-1" />
              <button
                onClick={() => { openOverlayGenerator('letterbox', contextMenu.folderId); setContextMenu(null) }}
                className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2"
              >
                <span className="w-4 text-center">▬</span>
                Create overlay in this folder…
              </button>
              <div className="border-t border-sf-dark-600 my-1" />
              <button
                onClick={async () => {
                  const folder = folders?.find(f => f.id === contextMenu.folderId)
                  if (folder) {
                    await handleDeleteFolder(contextMenu.folderId, folder.name)
                  }
                  setContextMenu(null)
                }}
                className="w-full px-3 py-1.5 text-left text-xs text-sf-error hover:bg-sf-dark-700 flex items-center gap-2"
              >
                <Trash2 className="w-3 h-3" />
                Delete folder
              </button>
            </>
          ) : contextMenu.assetId == null ? (
            /* Empty area: New Folder, Import, Create overlay */
            <>
              <button
                onClick={handleEmptyMenuNewFolder}
                className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2"
              >
                <FolderPlus className="w-3 h-3 text-sf-accent" />
                New Folder
              </button>
              <button
                onClick={handleEmptyMenuImport}
                disabled={!currentProjectHandle}
                className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Upload className="w-3 h-3 text-sf-accent" />
                Import
              </button>
              <div className="border-t border-sf-dark-600 my-1" />
              <div className="px-2 py-1 text-[10px] text-sf-text-muted uppercase tracking-wider">Create overlay</div>
              <button
                onClick={() => { openOverlayGenerator('letterbox', null); setContextMenu(null) }}
                className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2"
              >
                <span className="w-4 text-center">▬</span>
                Letterbox overlay…
              </button>
              <button
                onClick={() => { openOverlayGenerator('vignette', null); setContextMenu(null) }}
                className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2"
              >
                <span className="w-4 text-center">◐</span>
                Vignette overlay…
              </button>
              <button
                onClick={() => { openOverlayGenerator('color', null); setContextMenu(null) }}
                className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2"
              >
                <span className="w-4 text-center">■</span>
                Color matte…
              </button>
              <button
                onClick={() => { openOverlayGenerator('grain', null); setContextMenu(null) }}
                className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2"
              >
                <span className="w-4 text-center">◇</span>
                Film grain loop…
              </button>
            </>
          ) : (
            /* Asset menu */
            <>
          {/* Video/Image specific options */}
          {(() => {
            const asset = assets.find(a => a.id === contextMenu.assetId)
            const showMask = asset && canGenerateMask(asset)
            const showThumbnails = asset && canGenerateThumbnails(asset)
            const hasSprite = asset?.sprite?.url
            const isGenerating = asset?.spriteGenerating
            const showAudioToggle = asset?.type === 'video' && asset?.hasAudio !== false
            const isAudioDisabled = asset?.audioEnabled === false
            
            if (!showMask && !showThumbnails && !showAudioToggle) return null
            
            return (
              <>
                {/* Toggle audio on video */}
                {showAudioToggle && (
                  <button
                    onClick={() => handleToggleVideoAudio(contextMenu.assetId)}
                    className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2"
                  >
                    {isAudioDisabled ? (
                      <Volume2 className="w-3 h-3 text-sf-success" />
                    ) : (
                      <VolumeX className="w-3 h-3 text-sf-error" />
                    )}
                    {isAudioDisabled ? 'Restore audio on video' : 'Remove audio from video'}
                  </button>
                )}

                {/* Generate Thumbnails - videos only */}
                {showThumbnails && (
                  <button
                    onClick={() => handleGenerateThumbnails(contextMenu.assetId)}
                    disabled={isGenerating}
                    className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isGenerating ? (
                      <Loader2 className="w-3 h-3 text-sf-accent animate-spin" />
                    ) : (
                      <Film className="w-3 h-3 text-sf-blue" />
                    )}
                    {isGenerating ? 'Generating...' : hasSprite ? 'Regenerate Thumbnails' : 'Generate Thumbnails'}
                  </button>
                )}
                
                {/* Create Mask option */}
                {showMask && (
                  <button
                    onClick={() => handleOpenMaskDialog(contextMenu.assetId)}
                    className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2"
                  >
                    <Wand2 className="w-3 h-3 text-sf-accent" />
                    Create Mask...
                  </button>
                )}
                
                <div className="border-t border-sf-dark-600 my-1" />
              </>
            )
          })()}
          
          {/* Set color for asset */}
          <div className="px-3 py-1 text-[10px] text-sf-text-muted uppercase tracking-wider">Color</div>
          <div className="px-2 py-1 flex flex-wrap gap-1">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c ?? 'none'}
                type="button"
                onClick={() => {
                  setAssetColor(contextMenu.assetId, c)
                  setContextMenu(null)
                }}
                className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center ${(assets.find(a => a.id === contextMenu.assetId)?.color ?? null) === c ? 'border-white scale-110' : 'border-sf-dark-600 hover:border-sf-dark-500'} ${!c ? 'bg-sf-dark-600' : ''}`}
                style={c ? { backgroundColor: c } : {}}
                title={c ? c : 'None'}
              >
                {!c && <Minus className="w-3 h-3 text-sf-text-muted" />}
              </button>
            ))}
          </div>
          <div className="border-t border-sf-dark-600 my-1" />
          
          <div className="px-3 py-1 text-[10px] text-sf-text-muted uppercase tracking-wider">
            Move to folder
          </div>
          {(() => {
            const ids = selectedAssetIds.includes(contextMenu.assetId) ? selectedAssetIds : [contextMenu.assetId]
            return (
              <>
                <button
                  onClick={() => handleMoveToFolder(ids, null)}
                  className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2"
                >
                  <Home className="w-3 h-3" />
                  Root
                </button>
                {(folders || []).map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => handleMoveToFolder(ids, folder.id)}
                    className="w-full px-3 py-1.5 text-left text-xs text-sf-text-primary hover:bg-sf-dark-700 flex items-center gap-2"
                  >
                    <FolderOpen className="w-3 h-3 text-sf-accent" />
                    {folder.name}
                  </button>
                ))}
              </>
            )
          })()}
            </>
          )}
        </div>
      )}
      
      <ConfirmDialog
        isOpen={Boolean(confirmDialog)}
        title={confirmDialog?.title || 'Confirm action'}
        message={confirmDialog?.message || ''}
        confirmLabel={confirmDialog?.confirmLabel || 'Confirm'}
        cancelLabel={confirmDialog?.cancelLabel || 'Cancel'}
        tone={confirmDialog?.tone || 'danger'}
        onConfirm={() => resolveConfirmDialog(true)}
        onCancel={() => resolveConfirmDialog(false)}
      />

      {/* Mask Generation Dialog */}
      {maskDialogAsset && (
        <MaskGenerationDialog
          asset={maskDialogAsset}
          onClose={() => setMaskDialogAsset(null)}
          currentFolderId={currentFolderId}
        />
      )}

      {/* Overlay generator (letterbox, vignette, color matte, film grain) */}
      <OverlayGeneratorModal
        isOpen={overlayModalOpen}
        onClose={closeOverlayModal}
        onAdd={async (asset) => {
          const targetFolderId = asset.folderId ?? currentFolderId
          const applyGeneratedAsset = (nextAsset) => {
            addAsset({
              ...nextAsset,
              folderId: targetFolderId,
            })
          }

          if (asset.blob && currentProjectHandle && isElectron() && typeof currentProjectHandle === 'string') {
            try {
              const persisted = await writeGeneratedOverlayToProject(
                currentProjectHandle,
                asset.blob,
                asset.name || 'overlay',
                asset.type,
                asset.settings || {}
              )
              applyGeneratedAsset(persisted)
            } catch (err) {
              console.warn('Could not save overlay to project, using blob URL:', err)
              const url = URL.createObjectURL(asset.blob)
              const { blob: _b, ...rest } = asset
              applyGeneratedAsset({ ...rest, url })
            }
          } else {
            const url = asset.blob ? URL.createObjectURL(asset.blob) : asset.url
            const { blob: _b, ...rest } = asset
            applyGeneratedAsset({ ...rest, url: url || rest.url })
          }
        }}
        timelineSize={getCurrentTimelineSettings() ? { width: getCurrentTimelineSettings().width, height: getCurrentTimelineSettings().height } : { width: 1920, height: 1080 }}
        defaultFolderId={overlayModalFolderId ?? currentFolderId}
        initialType={overlayModalInitialType}
      />
      
      {/* Footer with asset count */}
      <div className="px-2 py-1.5 border-t border-sf-dark-700 flex items-center justify-between">
        <span className="text-[10px] text-sf-text-muted">
          {filteredAssets.length} {filteredAssets.length === 1 ? 'asset' : 'assets'}
          {subFolders.length > 0 && ` • ${subFolders.length} ${subFolders.length === 1 ? 'folder' : 'folders'}`}
        </span>
        {viewMode === 'list' && (
          <button
            onClick={() => setShowNewFolderInput(true)}
            className="p-0.5 hover:bg-sf-dark-700 rounded transition-colors"
            title="New Folder"
          >
            <FolderPlus className="w-3 h-3 text-sf-text-muted" />
          </button>
        )}
      </div>
    </div>
  )
}

export default AssetsPanel

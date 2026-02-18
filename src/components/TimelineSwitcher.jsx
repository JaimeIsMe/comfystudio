import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Plus, Copy, Trash2, Edit3, Check, X, Film } from 'lucide-react'
import useProjectStore from '../stores/projectStore'
import NewTimelineDialog from './NewTimelineDialog'

function TimelineSwitcher() {
  const [isOpen, setIsOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [showNewTimelineDialog, setShowNewTimelineDialog] = useState(false)
  const dropdownRef = useRef(null)
  const inputRef = useRef(null)
  
  const {
    currentProject,
    currentTimelineId,
    getTimelines,
    getCurrentTimeline,
    switchTimeline,
    duplicateTimeline,
    renameTimeline,
    deleteTimeline,
  } = useProjectStore()
  
  const timelines = getTimelines()
  const currentTimeline = getCurrentTimeline()
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false)
        setEditingId(null)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])
  
  // Focus input when editing
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])
  
  if (!currentProject) return null
  
  const handleSwitchTimeline = async (timelineId) => {
    if (timelineId !== currentTimelineId) {
      await switchTimeline(timelineId)
    }
    setIsOpen(false)
  }
  
  const handleCreateTimeline = () => {
    setIsOpen(false)
    setShowNewTimelineDialog(true)
  }
  
  const handleTimelineCreated = (newTimeline) => {
    // Timeline is automatically switched in the dialog
    setShowNewTimelineDialog(false)
  }
  
  const handleDuplicateTimeline = (e, timelineId) => {
    e.stopPropagation()
    const newTimeline = duplicateTimeline(timelineId)
    if (newTimeline) {
      switchTimeline(newTimeline.id)
    }
    setIsOpen(false)
  }
  
  const handleStartRename = (e, timeline) => {
    e.stopPropagation()
    setEditingId(timeline.id)
    setEditName(timeline.name)
  }
  
  const handleSaveRename = (e) => {
    e.stopPropagation()
    if (editName.trim()) {
      renameTimeline(editingId, editName.trim())
    }
    setEditingId(null)
    setEditName('')
  }
  
  const handleCancelRename = (e) => {
    e.stopPropagation()
    setEditingId(null)
    setEditName('')
  }
  
  const handleDeleteTimeline = (e, timelineId) => {
    e.stopPropagation()
    if (timelines.length > 1) {
      if (confirm('Delete this timeline? This cannot be undone.')) {
        deleteTimeline(timelineId)
      }
    }
  }
  
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSaveRename(e)
    } else if (e.key === 'Escape') {
      handleCancelRename(e)
    }
  }
  
  // Get resolution label for a timeline
  const getTimelineResolutionLabel = (timeline) => {
    const width = timeline.width || currentProject?.settings?.width || 1920
    const height = timeline.height || currentProject?.settings?.height || 1080
    const fps = timeline.fps || currentProject?.settings?.fps || 24
    const hasCustomSettings = timeline.width || timeline.height || timeline.fps
    return { width, height, fps, hasCustomSettings }
  }
  
  return (
    <>
    <div className="relative" ref={dropdownRef}>
      {/* Current Timeline Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-sf-dark-800 hover:bg-sf-dark-700 border border-sf-dark-600 rounded-lg transition-colors"
      >
        <Film className="w-3.5 h-3.5 text-sf-accent" />
        <span className="text-xs font-medium text-sf-text-primary max-w-[150px] truncate">
          {currentTimeline?.name || 'Timeline'}
        </span>
        <span className="text-[10px] text-sf-text-muted">
          ({timelines.length})
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-sf-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      
      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-sf-dark-800 border border-sf-dark-600 rounded-lg shadow-xl z-50 overflow-hidden">
          {/* Timeline List */}
          <div className="max-h-64 overflow-y-auto">
            {timelines.map((timeline) => (
              <div
                key={timeline.id}
                onClick={() => {
                  if (editingId === timeline.id) return
                  handleSwitchTimeline(timeline.id)
                }}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors group ${
                  timeline.id === currentTimelineId 
                    ? 'bg-sf-accent/20 border-l-2 border-sf-accent' 
                    : 'hover:bg-sf-dark-700 border-l-2 border-transparent'
                }`}
              >
                <Film className={`w-3.5 h-3.5 flex-shrink-0 ${
                  timeline.id === currentTimelineId ? 'text-sf-accent' : 'text-sf-text-muted'
                }`} />
                
                {editingId === timeline.id ? (
                  <div className="flex-1 flex items-center gap-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                    <input
                      ref={inputRef}
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="flex-1 min-w-0 bg-sf-dark-700 border border-sf-accent rounded px-1.5 py-0.5 text-xs text-sf-text-primary focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSaveRename(e); }}
                      className="p-0.5 hover:bg-sf-dark-600 rounded flex-shrink-0"
                      title="Save name"
                    >
                      <Check className="w-3 h-3 text-sf-success" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCancelRename(e); }}
                      className="p-0.5 hover:bg-sf-dark-600 rounded flex-shrink-0"
                      title="Cancel"
                    >
                      <X className="w-3 h-3 text-sf-text-muted" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-sf-text-primary truncate">
                        {timeline.name}
                      </p>
                      <p className="text-[10px] text-sf-text-muted">
                        {timeline.clips?.length || 0} clips
                        {(() => {
                          const { width, height, fps, hasCustomSettings } = getTimelineResolutionLabel(timeline)
                          return hasCustomSettings ? (
                            <span className="ml-1 text-sf-accent">• {width}×{height}</span>
                          ) : null
                        })()}
                      </p>
                    </div>
                    
                    {/* Actions */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => handleStartRename(e, timeline)}
                        className="p-1 hover:bg-sf-dark-600 rounded"
                        title="Rename"
                      >
                        <Edit3 className="w-3 h-3 text-sf-text-muted" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDuplicateTimeline(e, timeline.id)}
                        className="p-1 hover:bg-sf-dark-600 rounded"
                        title="Duplicate"
                      >
                        <Copy className="w-3 h-3 text-sf-text-muted" />
                      </button>
                      {timelines.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => handleDeleteTimeline(e, timeline.id)}
                          className="p-1 hover:bg-sf-error/20 rounded"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3 text-sf-text-muted hover:text-sf-error" />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          
          {/* New Timeline / Duplicate Timeline */}
          <div className="border-t border-sf-dark-600">
            <button
              onClick={handleCreateTimeline}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-sf-dark-700 transition-colors text-left"
            >
              <Plus className="w-3.5 h-3.5 text-sf-accent" />
              <span className="text-xs text-sf-text-secondary">New Timeline...</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (currentTimelineId) {
                  handleDuplicateTimeline(e, currentTimelineId)
                }
              }}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-sf-dark-700 transition-colors text-left border-t border-sf-dark-600/50"
              title="Duplicate current timeline to create a new version"
            >
              <Copy className="w-3.5 h-3.5 text-sf-accent" />
              <span className="text-xs text-sf-text-secondary">Duplicate Timeline...</span>
            </button>
          </div>
        </div>
      )}
    </div>
    
    {/* New Timeline Dialog */}
    <NewTimelineDialog
      isOpen={showNewTimelineDialog}
      onClose={() => setShowNewTimelineDialog(false)}
      onCreated={handleTimelineCreated}
    />
    </>
  )
}

export default TimelineSwitcher

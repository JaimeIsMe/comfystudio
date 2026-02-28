import { Download, Check, RefreshCw, HardDrive, Cloud, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

function WorkflowsPanel() {
  const [selectedWorkflow, setSelectedWorkflow] = useState(null)
  const [downloading, setDownloading] = useState(null)
  const [filter, setFilter] = useState('all')
  const [expandedCategories, setExpandedCategories] = useState(['Text to Image'])

  // Mock workflow data
  const workflows = [
    {
      id: 'wan22-i2v',
      name: 'WAN 2.2 Image to Video',
      description: 'High quality image-to-video generation',
      category: 'Image to Video',
      version: '1.0.0',
      installed: true,
      installedVersion: '1.0.0',
      totalSize: '8.5 GB',
    },
    {
      id: 'cinematic-txt2img',
      name: 'Cinematic Text to Image',
      description: 'Film-like storyboard frames',
      category: 'Text to Image',
      version: '1.2.0',
      installed: true,
      installedVersion: '1.2.0',
      totalSize: '4.2 GB',
    },
    {
      id: 'anime-style',
      name: 'Anime Style Frames',
      description: 'Japanese animation aesthetic',
      category: 'Text to Image',
      version: '1.1.0',
      installed: false,
      totalSize: '5.8 GB',
    },
    {
      id: 'sketch-to-render',
      name: 'Sketch to Render',
      description: 'Transform sketches to frames',
      category: 'Image to Image',
      version: '2.0.0',
      installed: false,
      totalSize: '6.2 GB',
    },
    {
      id: 'motion-test',
      name: 'Motion Test',
      description: 'Short motion tests',
      category: 'Image to Video',
      version: '1.0.0',
      installed: false,
      totalSize: '9.8 GB',
    },
  ]

  const filteredWorkflows = workflows.filter(w => {
    if (filter === 'installed') return w.installed
    if (filter === 'available') return !w.installed
    return true
  })

  const installedCount = workflows.filter(w => w.installed).length
  const categories = [...new Set(workflows.map(w => w.category))]

  const toggleCategory = (cat) => {
    setExpandedCategories(prev => 
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    )
  }

  const handleDownload = (workflowId) => {
    setDownloading(workflowId)
    setTimeout(() => setDownloading(null), 3000)
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-2 border-b border-sf-dark-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-sf-text-primary">Workflows</span>
          <button className="p-1 hover:bg-sf-dark-700 rounded transition-colors" title="Check for updates">
            <RefreshCw className="w-3.5 h-3.5 text-sf-text-muted" />
          </button>
        </div>
        
        {/* Filter Tabs */}
        <div className="flex gap-0.5 bg-sf-dark-800 rounded p-0.5">
          <button
            onClick={() => setFilter('all')}
            className={`flex-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
              filter === 'all' ? 'bg-sf-dark-600 text-sf-text-primary' : 'text-sf-text-muted hover:text-sf-text-secondary'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('installed')}
            className={`flex-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
              filter === 'installed' ? 'bg-sf-dark-600 text-sf-text-primary' : 'text-sf-text-muted hover:text-sf-text-secondary'
            }`}
          >
            Installed ({installedCount})
          </button>
          <button
            onClick={() => setFilter('available')}
            className={`flex-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
              filter === 'available' ? 'bg-sf-dark-600 text-sf-text-primary' : 'text-sf-text-muted hover:text-sf-text-secondary'
            }`}
          >
            Available
          </button>
        </div>
      </div>
      
      {/* Workflow List */}
      <div className="flex-1 overflow-y-auto p-2">
        {categories.map(category => {
          const categoryWorkflows = filteredWorkflows.filter(w => w.category === category)
          if (categoryWorkflows.length === 0) return null
          const isExpanded = expandedCategories.includes(category)
          
          return (
            <div key={category} className="mb-2">
              <button
                onClick={() => toggleCategory(category)}
                className="w-full flex items-center gap-1 px-1 py-1 text-[10px] text-sf-text-muted uppercase tracking-wider hover:text-sf-text-secondary"
              >
                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {category}
              </button>
              
              {isExpanded && categoryWorkflows.map(workflow => (
                <button
                  key={workflow.id}
                  onClick={() => setSelectedWorkflow(selectedWorkflow?.id === workflow.id ? null : workflow)}
                  className={`w-full text-left px-2 py-2 rounded mb-0.5 transition-colors ${
                    selectedWorkflow?.id === workflow.id
                      ? 'bg-sf-dark-600'
                      : 'hover:bg-sf-dark-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-medium text-sf-text-primary truncate">{workflow.name}</span>
                    {workflow.installed ? (
                      <Check className="w-3 h-3 text-sf-success flex-shrink-0" />
                    ) : (
                      <Download className="w-3 h-3 text-sf-text-muted flex-shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[9px] text-sf-text-muted">
                    <span className="flex items-center gap-0.5">
                      <HardDrive className="w-2.5 h-2.5" />
                      {workflow.totalSize}
                    </span>
                    <span>v{workflow.version}</span>
                  </div>
                  
                  {/* Expanded details */}
                  {selectedWorkflow?.id === workflow.id && (
                    <div className="mt-2 pt-2 border-t border-sf-dark-600">
                      <p className="text-[10px] text-sf-text-secondary mb-2">{workflow.description}</p>
                      {workflow.installed ? (
                        <button className="w-full py-1 bg-sf-dark-700 hover:bg-sf-dark-600 rounded text-[10px] text-sf-text-muted transition-colors">
                          Uninstall
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownload(workflow.id) }}
                          disabled={downloading === workflow.id}
                          className="w-full py-1.5 bg-sf-accent hover:bg-sf-accent-hover disabled:bg-sf-dark-600 rounded text-[10px] text-white transition-colors flex items-center justify-center gap-1"
                        >
                          {downloading === workflow.id ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Downloading...
                            </>
                          ) : (
                            <>
                              <Download className="w-3 h-3" />
                              Download
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )
        })}
      </div>
      
      {/* Storage Info */}
      <div className="p-2 border-t border-sf-dark-700 bg-sf-dark-800">
        <div className="flex items-center justify-between text-[10px] text-sf-text-muted mb-1">
          <span>Storage</span>
          <span>12.7 GB used</span>
        </div>
        <div className="h-1 bg-sf-dark-600 rounded-full overflow-hidden">
          <div className="h-full bg-sf-accent rounded-full" style={{ width: '45%' }} />
        </div>
      </div>
    </div>
  )
}

export default WorkflowsPanel

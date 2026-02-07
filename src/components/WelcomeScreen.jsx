import { useState, useEffect } from 'react'
import { FolderOpen, Plus, Film, Clock, Monitor, AlertCircle, Loader2, Trash2 } from 'lucide-react'
import useProjectStore from '../stores/projectStore'
import NewProjectDialog from './NewProjectDialog'

function WelcomeScreen() {
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false)
  const [recentProjectsList, setRecentProjectsList] = useState([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  
  const {
    isFirstRun,
    isLoading,
    error,
    defaultProjectsHandle,
    defaultProjectsLocation,
    recentProjects,
    checkBrowserSupport,
    selectDefaultProjectsLocation,
    openProjectFromPicker,
    openRecentProject,
    removeRecentProject,
    clearError,
    getRecentProjectsList,
    isElectronMode,
  } = useProjectStore()
  
  const isBrowserSupported = checkBrowserSupport()
  
  // Load recent projects on mount
  useEffect(() => {
    const loadRecentProjects = async () => {
      if (defaultProjectsHandle) {
        setLoadingProjects(true)
        try {
          const projects = await getRecentProjectsList()
          setRecentProjectsList(projects)
        } catch (err) {
          console.error('Error loading recent projects:', err)
        }
        setLoadingProjects(false)
      } else {
        setRecentProjectsList(recentProjects)
      }
    }
    
    loadRecentProjects()
  }, [defaultProjectsHandle, recentProjects])
  
  // Format date for display
  const formatDate = (isoString) => {
    if (!isoString) return 'Unknown'
    const date = new Date(isoString)
    const now = new Date()
    const diffMs = now - date
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return date.toLocaleDateString()
  }
  
  // Handle opening a recent project
  const handleOpenRecent = async (project) => {
    // Use the unified openRecentProject function which handles both Electron and web modes
    await openRecentProject(project)
  }
  
  // First-run setup screen
  if (isFirstRun || !defaultProjectsHandle) {
    return (
      <div className="h-screen bg-sf-dark-950 flex items-center justify-center">
        <div className="max-w-md w-full mx-4">
          {/* Logo/Branding */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-sf-accent rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Film className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-sf-text-primary mb-2">Welcome to StoryFlow</h1>
            <p className="text-sf-text-muted text-sm">AI-Powered Video Editing Studio</p>
          </div>
          
          {/* Browser Support Warning - only show in web mode */}
          {!isBrowserSupported && !isElectronMode() && (
            <div className="mb-6 p-4 bg-sf-error/20 border border-sf-error/50 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-sf-error flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-sf-text-primary font-medium">Browser Not Supported</p>
                  <p className="text-xs text-sf-text-muted mt-1">
                    StoryFlow requires the File System Access API. Please use Google Chrome or Microsoft Edge.
                  </p>
                </div>
              </div>
            </div>
          )}
          
          {/* Setup Card */}
          <div className="bg-sf-dark-900 border border-sf-dark-700 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-sf-text-primary mb-2">Set Up Your Workspace</h2>
            <p className="text-sm text-sf-text-muted mb-6">
              Choose a folder where your StoryFlow projects will be saved. Each project will have its own subfolder with all assets organized inside.
            </p>
            
            {/* Current Location Display */}
            {defaultProjectsLocation && (
              <div className="mb-4 p-3 bg-sf-dark-800 rounded-lg">
                <p className="text-xs text-sf-text-muted mb-1">Current location:</p>
                <p className="text-sm text-sf-text-primary truncate">{defaultProjectsLocation}</p>
              </div>
            )}
            
            {/* Error Display */}
            {error && (
              <div className="mb-4 p-3 bg-sf-error/20 border border-sf-error/50 rounded-lg">
                <p className="text-xs text-sf-error">{error}</p>
                <button 
                  onClick={clearError}
                  className="text-xs text-sf-text-muted hover:text-sf-text-primary mt-1"
                >
                  Dismiss
                </button>
              </div>
            )}
            
            {/* Action Button */}
            <button
              onClick={selectDefaultProjectsLocation}
              disabled={(!isBrowserSupported && !isElectronMode()) || isLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-sf-blue hover:bg-sf-blue-hover disabled:bg-sf-dark-700 disabled:cursor-not-allowed rounded-lg text-white font-medium transition-colors"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <FolderOpen className="w-5 h-5" />
              )}
              Choose Projects Folder
            </button>
            
            <p className="text-xs text-sf-text-muted text-center mt-4">
              You can change this later in Settings
            </p>
          </div>
        </div>
      </div>
    )
  }
  
  // Main welcome screen with recent projects
  return (
    <div className="h-screen bg-sf-dark-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-sf-dark-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-sf-accent rounded-xl flex items-center justify-center">
            <Film className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-sf-text-primary">StoryFlow</h1>
            <p className="text-xs text-sf-text-muted">AI-Powered Video Editing</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={openProjectFromPicker}
            className="flex items-center gap-2 px-4 py-2 bg-sf-dark-800 hover:bg-sf-dark-700 border border-sf-dark-600 rounded-lg text-sm text-sf-text-primary transition-colors"
          >
            <FolderOpen className="w-4 h-4" />
            Open Project
          </button>
          <button
            onClick={() => setShowNewProjectDialog(true)}
            className="flex items-center gap-2 px-4 py-2 bg-sf-blue hover:bg-sf-blue-hover rounded-lg text-sm text-white font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </div>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-auto p-8">
        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-sf-error/20 border border-sf-error/50 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-sf-error flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-sf-text-primary">{error}</p>
            </div>
            <button 
              onClick={clearError}
              className="text-xs text-sf-text-muted hover:text-sf-text-primary"
            >
              Dismiss
            </button>
          </div>
        )}
        
        {/* Recent Projects Section */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-sf-text-primary mb-4">Recent Projects</h2>
          
          {loadingProjects ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-sf-accent animate-spin" />
            </div>
          ) : recentProjectsList.length === 0 ? (
            <div className="bg-sf-dark-900 border border-sf-dark-700 rounded-xl p-12 text-center">
              <Film className="w-12 h-12 text-sf-text-muted mx-auto mb-4 opacity-50" />
              <p className="text-sf-text-primary font-medium mb-2">No recent projects</p>
              <p className="text-sm text-sf-text-muted mb-6">Create your first project to get started</p>
              <button
                onClick={() => setShowNewProjectDialog(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-sf-blue hover:bg-sf-blue-hover rounded-lg text-sm text-white font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Project
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {recentProjectsList.map((project, index) => (
                <div
                  key={project.name + index}
                  className="group relative bg-sf-dark-900 border border-sf-dark-700 rounded-xl overflow-hidden hover:border-sf-accent transition-all text-left"
                >
                  <button
                    onClick={() => handleOpenRecent(project)}
                    className="w-full text-left"
                  >
                    {/* Thumbnail */}
                    <div className="aspect-video bg-sf-dark-800 relative overflow-hidden">
                      {project.thumbnail ? (
                        <img 
                          src={project.thumbnail} 
                          alt={project.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Film className="w-8 h-8 text-sf-text-muted opacity-50" />
                        </div>
                      )}
                      
                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-sf-accent/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="w-10 h-10 bg-sf-accent rounded-full flex items-center justify-center">
                          <FolderOpen className="w-5 h-5 text-white" />
                        </div>
                      </div>
                    </div>
                  
                  {/* Info */}
                  <div className="p-3">
                    <p className="text-sm font-medium text-sf-text-primary truncate mb-1">
                      {project.name}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-sf-text-muted">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDate(project.modified)}
                      </span>
                      {project.settings && (
                        <span className="flex items-center gap-1">
                          <Monitor className="w-3 h-3" />
                          {project.settings.width}x{project.settings.height}
                        </span>
                      )}
                    </div>
                  </div>
                  </button>
                  {/* Remove from recent */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeRecentProject(project)
                      setRecentProjectsList((prev) =>
                        prev.filter((p) => !(p.name === project.name && (p.path || '') === (project.path || '')))
                      )
                    }}
                    className="absolute top-2 right-2 p-1.5 rounded-lg bg-sf-dark-900/90 hover:bg-sf-error/80 text-sf-text-muted hover:text-white opacity-0 group-hover:opacity-100 transition-opacity z-10"
                    title="Remove from recent projects"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              
              {/* New Project Card */}
              <button
                onClick={() => setShowNewProjectDialog(true)}
                className="bg-sf-dark-900 border-2 border-dashed border-sf-dark-600 rounded-xl overflow-hidden hover:border-sf-accent transition-colors flex flex-col items-center justify-center aspect-[4/3]"
              >
                <div className="w-12 h-12 bg-sf-dark-800 rounded-xl flex items-center justify-center mb-3">
                  <Plus className="w-6 h-6 text-sf-text-muted" />
                </div>
                <p className="text-sm text-sf-text-muted">New Project</p>
              </button>
            </div>
          )}
        </div>
        
        {/* Projects Location Info */}
        <div className="text-center text-xs text-sf-text-muted">
          <p>
            Projects are saved to: <span className="text-sf-text-secondary">{defaultProjectsLocation || 'Not set'}</span>
            {' '}
            <button 
              onClick={selectDefaultProjectsLocation}
              className="text-sf-accent hover:underline"
            >
              Change
            </button>
          </p>
        </div>
      </div>
      
      {/* New Project Dialog */}
      <NewProjectDialog
        isOpen={showNewProjectDialog}
        onClose={() => setShowNewProjectDialog(false)}
      />
    </div>
  )
}

export default WelcomeScreen

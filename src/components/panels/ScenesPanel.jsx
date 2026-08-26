import { Plus, MoreVertical, GripVertical } from 'lucide-react'
import { useI18n } from '../../i18n/I18nContext'

function ScenesPanel({ scenes }) {
  const { t } = useI18n()
  return (
    <div className="h-full p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-sf-text-primary">{t('scenesPanel.title')}</h3>
        <button className="flex items-center gap-1 px-3 py-1.5 bg-sf-accent hover:bg-sf-accent-hover rounded text-xs text-white transition-colors">
          <Plus className="w-3 h-3" />
          {t('scenesPanel.addScene')}
        </button>
      </div>
      
      <div className="flex gap-4 overflow-x-auto pb-2">
        {scenes.map((scene, index) => (
          <div
            key={scene.id}
            className="flex-shrink-0 w-48 bg-sf-dark-800 border border-sf-dark-600 rounded-lg overflow-hidden group"
          >
            {/* Scene Thumbnail */}
            <div className="h-24 bg-sf-dark-700 flex items-center justify-center relative">
              <span className="text-3xl">🎬</span>
              <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-sf-dark-900/80 rounded text-[10px] text-sf-text-secondary">
                {t('scenesPanel.sceneNumber', { number: scene.id })}
              </div>
              <button className="absolute top-2 right-2 p-1 bg-sf-dark-900/80 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                <MoreVertical className="w-3 h-3 text-sf-text-muted" />
              </button>
            </div>
            
            {/* Scene Info */}
            <div className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <GripVertical className="w-3 h-3 text-sf-text-muted cursor-grab" />
                <span className="text-sm font-medium text-sf-text-primary">{scene.name}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-sf-text-muted">
                <span>{t('scenesPanel.shotCount', { count: scene.shots })}</span>
                <span>~{scene.shots * 3}s</span>
              </div>
            </div>
          </div>
        ))}
        
        {/* Add Scene Card */}
        <div className="flex-shrink-0 w-48 h-36 border-2 border-dashed border-sf-dark-600 rounded-lg flex items-center justify-center hover:border-sf-dark-500 cursor-pointer transition-colors">
          <div className="text-center">
            <Plus className="w-6 h-6 text-sf-text-muted mx-auto mb-1" />
            <span className="text-xs text-sf-text-muted">{t('scenesPanel.newScene')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ScenesPanel

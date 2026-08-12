import { Layers, Sparkles, FolderOpen, Workflow, Settings, SlidersHorizontal } from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'

function BottomTabs({ activeTab, onTabChange }) {
  const { t } = useI18n()
  const tabs = [
    { id: 'scenes', label: t('tabs.scenes'), icon: Layers },
    { id: 'generate', label: t('tabs.generate'), icon: Sparkles },
    { id: 'effects', label: t('tabs.effects'), icon: SlidersHorizontal },
    { id: 'assets', label: t('tabs.assets'), icon: FolderOpen },
    { id: 'workflows', label: t('tabs.workflows'), icon: Workflow },
    { id: 'settings', label: t('tabs.settings'), icon: Settings },
  ]

  return (
    <div className="h-10 bg-sf-dark-800 border-t border-sf-dark-700 flex items-center justify-center gap-1 px-4">
      {tabs.map((tab) => {
        const Icon = tab.icon
        const isActive = activeTab === tab.id
        
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              isActive
                ? 'bg-sf-dark-600 text-sf-text-primary'
                : 'text-sf-text-muted hover:text-sf-text-secondary hover:bg-sf-dark-700'
            }`}
          >
            <Icon className={`w-4 h-4 ${isActive ? 'text-sf-accent' : ''}`} />
            <span className="text-sm font-medium">{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export default BottomTabs

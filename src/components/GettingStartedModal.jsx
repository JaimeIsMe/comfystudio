import { useEffect, useMemo, useState } from 'react'
import {
  X,
  Rocket,
  CheckCircle2,
  Circle,
  AlertCircle,
  Settings,
  Sparkles,
  Download,
  Server,
  KeyRound,
  Image as ImageIcon,
  FolderOpen,
  Clapperboard,
} from 'lucide-react'
import {
  COMFY_CONNECTION_CHANGED_EVENT,
  checkLocalComfyConnection,
  getLocalComfyConnectionSync,
  hydrateLocalComfyConnection,
} from '../services/localComfyConnection'
import { getPexelsApiKey } from '../services/pexelsSettings'
import { WORKFLOW_SETUP_SECTION_ID } from '../services/workflowSetupManager'
import ApiKeyDialog from './ApiKeyDialog'
import {
  COMFY_PARTNER_KEY_CHANGED_EVENT,
  COMFY_PARTNER_WORKFLOWS,
  getComfyPartnerApiKey,
} from '../services/comfyPartnerAuth'
import { useI18n } from '../i18n/I18nContext'

function StatusPill({ tone = 'neutral', children }) {
  const toneClassName = {
    success: 'bg-green-500/10 text-green-400 border-green-500/30',
    warning: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/30',
    neutral: 'bg-sf-dark-700 text-sf-text-secondary border-sf-dark-600',
  }[tone] || 'bg-sf-dark-700 text-sf-text-secondary border-sf-dark-600'

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${toneClassName}`}>
      {tone === 'success' ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : tone === 'warning' ? (
        <AlertCircle className="h-3 w-3" />
      ) : (
        <Circle className="h-3 w-3" />
      )}
      {children}
    </span>
  )
}

function ChecklistCard({
  icon: Icon,
  title,
  description,
  statusTone = 'neutral',
  statusLabel,
  detail,
  helperLines = [],
  actions = [],
}) {
  return (
    <div className="rounded-xl border border-sf-dark-700 bg-sf-dark-900 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-sf-dark-800 p-2">
            <Icon className="h-4 w-4 text-sf-accent" />
          </div>
          <div>
            <div className="text-sm font-semibold text-sf-text-primary">{title}</div>
            <div className="mt-1 text-xs text-sf-text-muted">{description}</div>
          </div>
        </div>
        <StatusPill tone={statusTone}>{statusLabel}</StatusPill>
      </div>

      {detail && (
        <div className="mb-3 rounded-lg border border-sf-dark-700 bg-sf-dark-800 px-3 py-2 text-xs text-sf-text-secondary">
          {detail}
        </div>
      )}

      {helperLines.length > 0 && (
        <div className="mb-3 space-y-1 text-[11px] text-sf-text-secondary">
          {helperLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              disabled={action.disabled}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                action.primary
                  ? 'bg-sf-accent text-white hover:bg-sf-accent-hover disabled:opacity-50'
                  : 'bg-sf-dark-800 text-sf-text-secondary hover:bg-sf-dark-700 disabled:opacity-50'
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function TourCard({ icon: Icon, title, description, helperLines = [], actionLabel, onAction }) {
  return (
    <div className="rounded-xl border border-sf-dark-700 bg-sf-dark-900 p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="rounded-lg bg-sf-dark-800 p-2">
          <Icon className="h-4 w-4 text-sf-accent" />
        </div>
        <div>
          <div className="text-sm font-semibold text-sf-text-primary">{title}</div>
          <div className="mt-1 text-xs text-sf-text-muted">{description}</div>
        </div>
      </div>

      <div className="mb-3 space-y-1 text-[11px] text-sf-text-secondary">
        {helperLines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>

      <button
        type="button"
        onClick={onAction}
        className="rounded-lg bg-sf-dark-800 px-3 py-2 text-xs font-medium text-sf-text-secondary transition-colors hover:bg-sf-dark-700"
      >
        {actionLabel}
      </button>
    </div>
  )
}

export default function GettingStartedModal({
  isOpen,
  onClose,
  projectName,
  defaultProjectsLocation,
  onOpenSettings,
  onNavigate,
}) {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState('setup')
  const [comfyConnection, setComfyConnection] = useState(() => getLocalComfyConnectionSync())
  const [connectionState, setConnectionState] = useState({
    status: 'idle',
    message: `Saved endpoint: ${getLocalComfyConnectionSync().httpBase}`,
  })
  const [testingConnection, setTestingConnection] = useState(false)
  const [pexelsConfigured, setPexelsConfigured] = useState(false)
  const [partnerKeyConfigured, setPartnerKeyConfigured] = useState(false)
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) return

    let cancelled = false

    const loadSetupState = async () => {
      try {
        const connection = await hydrateLocalComfyConnection()
        if (cancelled) return
        setComfyConnection(connection)
        setConnectionState({
          status: 'idle',
          message: `Saved endpoint: ${connection.httpBase}`,
        })

        const testResult = await checkLocalComfyConnection({ port: connection.port, timeoutMs: 2500 })
        if (cancelled) return
        setConnectionState(
          testResult.ok
            ? { status: 'success', message: `Connected to ${testResult.httpBase}` }
            : { status: 'warning', message: testResult.error || `Could not connect to ${connection.httpBase}.` }
        )
      } catch {
        if (!cancelled) {
          const fallback = getLocalComfyConnectionSync()
          setComfyConnection(fallback)
          setConnectionState({
            status: 'warning',
            message: `Could not verify ${fallback.httpBase} yet.`,
          })
        }
      }

      try {
        const pexelsKey = await getPexelsApiKey()
        if (!cancelled) {
          setPexelsConfigured(Boolean(String(pexelsKey || '').trim()))
        }
      } catch {
        if (!cancelled) {
          setPexelsConfigured(false)
        }
      }

      try {
        const partnerKey = await getComfyPartnerApiKey()
        if (!cancelled) {
          setPartnerKeyConfigured(Boolean(String(partnerKey || '').trim()))
        }
      } catch {
        if (!cancelled) {
          setPartnerKeyConfigured(false)
        }
      }
    }

    setActiveTab('setup')
    loadSetupState()

    const handleConnectionChanged = (event) => {
      const nextConnection = event?.detail?.httpBase ? event.detail : getLocalComfyConnectionSync()
      setComfyConnection(nextConnection)
      setConnectionState({
        status: 'idle',
        message: `Saved endpoint: ${nextConnection.httpBase}`,
      })
    }

    window.addEventListener(COMFY_CONNECTION_CHANGED_EVENT, handleConnectionChanged)

    const handlePartnerKeyChanged = (event) => {
      setPartnerKeyConfigured(Boolean(event?.detail?.hasKey))
    }
    window.addEventListener(COMFY_PARTNER_KEY_CHANGED_EVENT, handlePartnerKeyChanged)

    return () => {
      cancelled = true
      window.removeEventListener(COMFY_CONNECTION_CHANGED_EVENT, handleConnectionChanged)
      window.removeEventListener(COMFY_PARTNER_KEY_CHANGED_EVENT, handlePartnerKeyChanged)
    }
  }, [isOpen])

  const handleTestConnection = async () => {
    setTestingConnection(true)
    setConnectionState({
      status: 'idle',
      message: `Testing ${comfyConnection.httpBase}...`,
    })

    try {
      const testResult = await checkLocalComfyConnection({ port: comfyConnection.port })
      setConnectionState(
        testResult.ok
          ? { status: 'success', message: `Connected to ${testResult.httpBase}` }
          : { status: 'warning', message: testResult.error || `Could not connect to ${comfyConnection.httpBase}.` }
      )
    } finally {
      setTestingConnection(false)
    }
  }

  const handleOpenSettings = (section) => {
    onOpenSettings?.(section)
  }

  const handleNavigate = (tab) => {
    onNavigate?.(tab)
  }

  const setupSummary = useMemo(() => {
    const readyCount = [
      Boolean(defaultProjectsLocation),
      connectionState.status === 'success',
      true,
      connectionState.status === 'success' || partnerKeyConfigured,
    ].filter(Boolean).length

    return t('gettingStarted.summary', { ready: readyCount })
  }, [connectionState.status, defaultProjectsLocation, partnerKeyConfigured, t])

  const readyPathSteps = useMemo(() => ([
    {
      label: t('gettingStarted.steps.projects'),
      ready: Boolean(defaultProjectsLocation),
      detail: defaultProjectsLocation ? t('gettingStarted.status.ready') : t('gettingStarted.steps.projectsHelp'),
    },
    {
      label: t('gettingStarted.steps.connection'),
      ready: connectionState.status === 'success',
      detail: connectionState.status === 'success' ? t('gettingStarted.status.connected') : t('gettingStarted.steps.connectionHelp'),
    },
    {
      label: t('gettingStarted.steps.workflow'),
      ready: true,
      detail: t('gettingStarted.steps.workflowHelp'),
    },
    {
      label: t('gettingStarted.steps.generate'),
      ready: connectionState.status === 'success' || partnerKeyConfigured,
      detail: connectionState.status === 'success' || partnerKeyConfigured ? t('gettingStarted.steps.generateReady') : t('gettingStarted.steps.generateHelp'),
    },
  ]), [connectionState.status, defaultProjectsLocation, partnerKeyConfigured, t])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 px-4 pb-4 pt-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-sf-dark-600 bg-sf-dark-950 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-sf-dark-700 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-sf-dark-700 bg-sf-dark-900 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-sf-text-muted">
                <Rocket className="h-3 w-3 text-sf-accent" />
                {t('gettingStarted.badge')}
              </div>
              <h2 className="text-xl font-semibold text-sf-text-primary">
                {t('gettingStarted.title')}
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-sf-text-muted">
                {t('gettingStarted.intro')}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-sf-text-muted transition-colors hover:bg-sf-dark-800 hover:text-sf-text-primary"
              aria-label={t('gettingStarted.closeAria')}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="rounded-full border border-sf-dark-700 bg-sf-dark-900 px-3 py-1 text-xs text-sf-text-secondary">
              {t('gettingStarted.project')}: <span className="text-sf-text-primary">{projectName || t('gettingStarted.untitled')}</span>
            </div>
            <div className="rounded-full border border-sf-dark-700 bg-sf-dark-900 px-3 py-1 text-xs text-sf-text-secondary">
              {setupSummary}
            </div>
            <div className="rounded-full border border-sf-dark-700 bg-sf-dark-900 px-3 py-1 text-xs text-sf-text-secondary">
              {t('gettingStarted.reopen')} <span className="text-sf-text-primary">Velorn &gt; {t('gettingStarted.badge')}</span>
            </div>
          </div>
        </div>

        <div className="border-b border-sf-dark-700 px-5 py-3">
          <div className="inline-flex rounded-xl border border-sf-dark-700 bg-sf-dark-900 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('setup')}
              className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                activeTab === 'setup'
                  ? 'bg-sf-accent text-white'
                  : 'text-sf-text-muted hover:bg-sf-dark-800 hover:text-sf-text-primary'
              }`}
            >
              {t('gettingStarted.setupChecklist')}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('tour')}
              className={`rounded-lg px-4 py-2 text-sm transition-colors ${
                activeTab === 'tour'
                  ? 'bg-sf-accent text-white'
                  : 'text-sf-text-muted hover:bg-sf-dark-800 hover:text-sf-text-primary'
              }`}
            >
              {t('gettingStarted.quickTour')}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {activeTab === 'setup' ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-sf-accent/30 bg-sf-accent/10 px-4 py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-2xl">
                    <div className="text-sm font-semibold text-sf-text-primary">{t('gettingStarted.choosePath')}</div>
                    <p className="mt-1 text-xs leading-relaxed text-sf-text-secondary">
                      {t('gettingStarted.choosePathHelp')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenSettings(WORKFLOW_SETUP_SECTION_ID)}
                      className="rounded-lg bg-sf-accent px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-sf-accent-hover"
                    >
                      {t('gettingStarted.quickStartSetup')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenSettings('connection')}
                      className="rounded-lg border border-sf-dark-500 bg-sf-dark-900 px-3 py-2 text-xs font-semibold text-sf-text-secondary transition-colors hover:border-sf-dark-400 hover:text-sf-text-primary"
                    >
                      {t('gettingStarted.bringComfy')}
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-4">
                  {readyPathSteps.map((step) => (
                    <div
                      key={step.label}
                      className={`rounded-lg border px-3 py-2 ${
                        step.ready
                          ? 'border-green-500/25 bg-green-500/10'
                          : 'border-sf-dark-600 bg-sf-dark-900/65'
                      }`}
                    >
                      <div className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${step.ready ? 'text-green-400' : 'text-sf-text-muted'}`}>
                        {step.ready ? t('gettingStarted.status.ready') : t('gettingStarted.status.next')}
                      </div>
                      <div className="mt-1 text-xs font-medium text-sf-text-primary">{step.label}</div>
                      <div className="mt-1 text-[10px] leading-relaxed text-sf-text-muted">{step.detail}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <ChecklistCard
                  icon={FolderOpen}
                  title={t('gettingStarted.workspace.title')}
                  description={t('gettingStarted.workspace.description')}
                  statusTone={defaultProjectsLocation ? 'success' : 'warning'}
                  statusLabel={defaultProjectsLocation ? t('gettingStarted.status.ready') : t('gettingStarted.status.needsSetup')}
                  detail={defaultProjectsLocation || t('gettingStarted.workspace.none')}
                  actions={[
                    { label: t('gettingStarted.actions.openSettings'), onClick: () => handleOpenSettings('storage') },
                  ]}
                />

                <ChecklistCard
                  icon={Server}
                  title={t('gettingStarted.connection.title')}
                  description={t('gettingStarted.connection.description')}
                  statusTone={connectionState.status === 'success' ? 'success' : connectionState.status === 'warning' ? 'warning' : 'neutral'}
                  statusLabel={connectionState.status === 'success' ? t('gettingStarted.status.connected') : connectionState.status === 'warning' ? t('gettingStarted.status.checkPort') : t('gettingStarted.status.saved')}
                  detail={connectionState.message}
                  helperLines={[
                    t('gettingStarted.connection.savedEndpoint', { endpoint: comfyConnection.httpBase }),
                    t('gettingStarted.connection.portHelp'),
                  ]}
                  actions={[
                    { label: testingConnection ? t('gettingStarted.actions.testing') : t('gettingStarted.actions.testConnection'), onClick: handleTestConnection, primary: true, disabled: testingConnection },
                    { label: t('gettingStarted.actions.connectionSettings'), onClick: () => handleOpenSettings('connection') },
                  ]}
                />

                <ChecklistCard
                  icon={Clapperboard}
                  title={t('gettingStarted.workflow.title')}
                  description={t('gettingStarted.workflow.description')}
                  statusTone="neutral"
                  statusLabel={t('gettingStarted.workflow.status')}
                  helperLines={[
                    t('gettingStarted.workflow.help1'), t('gettingStarted.workflow.help2'), t('gettingStarted.workflow.help3'),
                  ]}
                  actions={[
                    { label: t('gettingStarted.workflow.action'), onClick: () => handleOpenSettings(WORKFLOW_SETUP_SECTION_ID), primary: true },
                    { label: t('gettingStarted.actions.openGenerate'), onClick: () => handleNavigate('generate') },
                  ]}
                />

                <ChecklistCard
                  icon={KeyRound}
                  title={t('gettingStarted.cloud.title')}
                  description={t('gettingStarted.cloud.description', { count: COMFY_PARTNER_WORKFLOWS.length })}
                  statusTone={partnerKeyConfigured ? 'success' : 'warning'}
                  statusLabel={partnerKeyConfigured ? t('gettingStarted.cloud.saved') : t('gettingStarted.cloud.optional')}
                  detail={partnerKeyConfigured ? t('gettingStarted.cloud.ready') : t('gettingStarted.cloud.detail')}
                  helperLines={[
                    t('gettingStarted.cloud.help1'), t('gettingStarted.cloud.help2'),
                  ]}
                  actions={[
                    { label: partnerKeyConfigured ? t('gettingStarted.cloud.changeKey') : t('gettingStarted.cloud.addKey'), onClick: () => setApiKeyDialogOpen(true), primary: true },
                  ]}
                />

                <ChecklistCard
                  icon={ImageIcon}
                  title={t('gettingStarted.stock.title')}
                  description={t('gettingStarted.stock.description')}
                  statusTone={pexelsConfigured ? 'success' : 'neutral'}
                  statusLabel={pexelsConfigured ? t('gettingStarted.stock.ready') : t('gettingStarted.stock.optional')}
                  detail={pexelsConfigured ? t('gettingStarted.stock.detected') : t('gettingStarted.stock.notDetected')}
                  helperLines={[
                    t('gettingStarted.stock.help'),
                  ]}
                  actions={[
                    { label: t('gettingStarted.stock.openSettings'), onClick: () => handleOpenSettings('stock') },
                    { label: t('gettingStarted.stock.openTab'), onClick: () => handleNavigate('stock') },
                  ]}
                />

              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-sf-dark-700 bg-sf-dark-900/70 px-4 py-3 text-sm text-sf-text-secondary">
                {t('gettingStarted.tour.intro')}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <TourCard
                  icon={Sparkles}
                  title={t('gettingStarted.tour.editorTitle')}
                  description={t('gettingStarted.tour.editorDescription')}
                  helperLines={[
                    t('gettingStarted.tour.editor1'), t('gettingStarted.tour.editor2'), t('gettingStarted.tour.editor3'), t('gettingStarted.tour.editor4'),
                  ]}
                  actionLabel={t('gettingStarted.tour.openEditor')}
                  onAction={() => handleNavigate('editor')}
                />

                <TourCard
                  icon={Rocket}
                  title={t('gettingStarted.tour.generateTitle')}
                  description={t('gettingStarted.tour.generateDescription')}
                  helperLines={[
                    t('gettingStarted.tour.generate1'), t('gettingStarted.tour.generate2'), t('gettingStarted.tour.generate3'),
                  ]}
                  actionLabel={t('gettingStarted.actions.openGenerate')}
                  onAction={() => handleNavigate('generate')}
                />

                <TourCard
                  icon={ImageIcon}
                  title={t('gettingStarted.tour.stockTitle')}
                  description={t('gettingStarted.tour.stockDescription')}
                  helperLines={[
                    t('gettingStarted.tour.stock1'), t('gettingStarted.tour.stock2'),
                  ]}
                  actionLabel={t('gettingStarted.tour.openStock')}
                  onAction={() => handleNavigate('stock')}
                />

                <TourCard
                  icon={Download}
                  title={t('gettingStarted.tour.exportTitle')}
                  description={t('gettingStarted.tour.exportDescription')}
                  helperLines={[
                    t('gettingStarted.tour.export1'), t('gettingStarted.tour.export2'),
                  ]}
                  actionLabel={t('gettingStarted.tour.openExport')}
                  onAction={() => handleNavigate('export')}
                />

                <TourCard
                  icon={Settings}
                  title={t('gettingStarted.tour.settingsTitle')}
                  description={t('gettingStarted.tour.settingsDescription')}
                  helperLines={[
                    t('gettingStarted.tour.settings1'), t('gettingStarted.tour.settings2'),
                  ]}
                  actionLabel={t('gettingStarted.actions.openSettings')}
                  onAction={() => handleOpenSettings('connection')}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-sf-dark-700 px-5 py-4">
          <div className="text-xs text-sf-text-muted">
            {t('gettingStarted.footer')}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-sf-dark-800 px-4 py-2 text-sm text-sf-text-secondary transition-colors hover:bg-sf-dark-700"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
      <ApiKeyDialog
        open={apiKeyDialogOpen}
        onClose={() => setApiKeyDialogOpen(false)}
        onSaved={(value) => setPartnerKeyConfigured(Boolean(String(value || '').trim()))}
      />
    </div>
  )
}

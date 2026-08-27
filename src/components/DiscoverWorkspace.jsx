import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ExternalLink,
  Film,
  Loader2,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Upload,
  WifiOff,
  X,
} from 'lucide-react'
import { useI18n } from '../i18n/I18nContext'
import {
  DEFAULT_BUNDLED_DISCOVER_CATALOG,
  extractYouTubeVideoId,
  getYouTubeEmbedUrl,
  getYouTubeThumbnailUrl,
  getYouTubeWatchUrl,
  loadDiscoverCatalog,
} from '../services/discoverCatalog.mjs'
import { FEEDBACK_MESSAGE_MAX_LENGTH, sendFeedback } from '../services/feedback'
import { trapDialogFocus } from '../utils/dialogFocus.mjs'

const SECTION_IDS = ['featured', 'showcase', 'tutorials']

const SUBMISSION_CATEGORIES = [
  'musicVideo',
  'podcast',
  'shortFilm',
  'social',
  'ad',
  'animation',
  'other',
]

const INITIAL_SUBMISSION = Object.freeze({
  youtubeUrl: '',
  creator: '',
  category: 'musicVideo',
  description: '',
  email: '',
  ownsRights: false,
  canFeature: false,
})

function getSectionItems(items, section) {
  if (section === 'featured') return items.filter((item) => item.featured)
  if (section === 'tutorials') return items.filter((item) => item.kind === 'tutorial')
  return items.filter((item) => item.kind === 'showcase')
}

function buildYouTubeEmbedUrl(input) {
  const youtubeId = extractYouTubeVideoId(input)
  if (!youtubeId) return ''
  // The iframe is never mounted until a user explicitly clicks Watch. Keep
  // every part of its URL local and fixed apart from the revalidated video ID.
  return `${getYouTubeEmbedUrl(youtubeId)}&autoplay=1&playsinline=1&modestbranding=1&iv_load_policy=3`
}

async function openYouTubeExternally(input) {
  const youtubeId = extractYouTubeVideoId(input)
  if (!youtubeId) return false
  const url = getYouTubeWatchUrl(youtubeId)
  if (!url) return false

  try {
    if (typeof window !== 'undefined' && window.electronAPI?.openExternalUrl) {
      const result = await window.electronAPI.openExternalUrl(url)
      if (result?.success) return true
    }
  } catch (_) {
    // Fall through to the browser-safe path below.
  }

  try {
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(url, '_blank', 'noopener,noreferrer')
      return true
    }
  } catch (_) {
    // There is no useful recovery if neither host can open a URL.
  }
  return false
}

function VideoCard({ item, onWatch, retryThumbnails }) {
  const { t } = useI18n()
  const [thumbnailFailed, setThumbnailFailed] = useState(false)
  const youtubeId = extractYouTubeVideoId(item.youtubeId)
  const thumbnailUrl = youtubeId ? getYouTubeThumbnailUrl(youtubeId) : ''
  const KindIcon = item.kind === 'tutorial' ? BookOpen : Film

  useEffect(() => {
    if (retryThumbnails) setThumbnailFailed(false)
  }, [retryThumbnails, thumbnailUrl])

  return (
    <article className="group overflow-hidden rounded-xl border border-sf-dark-700 bg-sf-dark-900 shadow-sm transition-colors hover:border-sf-dark-500">
      <button
        type="button"
        className="relative block aspect-video w-full overflow-hidden bg-sf-dark-800 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sf-accent"
        onClick={() => onWatch(item)}
        disabled={!youtubeId}
        aria-label={t('discover.actions.watch', { title: item.title }, `Watch ${item.title}`)}
      >
        {thumbnailUrl && !thumbnailFailed ? (
          <img
            src={thumbnailUrl}
            alt=""
            loading="lazy"
            draggable="false"
            onError={() => setThumbnailFailed(true)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-sf-dark-700 to-sf-dark-900">
            <KindIcon className="h-10 w-10 text-sf-text-muted" aria-hidden="true" />
          </div>
        )}
        <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" aria-hidden="true" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover:bg-black/25" aria-hidden="true">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-sf-dark-950 shadow-lg transition-transform group-hover:scale-105">
            <Play className="ml-0.5 h-5 w-5 fill-current" />
          </span>
        </span>
        {item.category && (
          <span className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-black/75 px-2 py-1 text-[10px] font-medium text-white">
            {item.category}
          </span>
        )}
      </button>

      <div className="p-3.5">
        <h3 className="text-sm font-semibold leading-snug text-sf-text-primary">{item.title}</h3>
        {item.creator && (
          <p className="mt-1 text-[11px] text-sf-text-muted">
            {t('discover.labels.by', { creator: item.creator }, `By ${item.creator}`)}
          </p>
        )}
        {item.description && (
          <p
            className="mt-2 overflow-hidden text-xs leading-relaxed text-sf-text-secondary"
            style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}
          >
            {item.description}
          </p>
        )}
        {item.tags?.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {item.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="rounded bg-sf-dark-800 px-2 py-0.5 text-[10px] text-sf-text-muted">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

function VideoPlayerModal({ item, onClose }) {
  const { t } = useI18n()
  const dialogRef = useRef(null)
  const closeButtonRef = useRef(null)
  const youtubeId = extractYouTubeVideoId(item?.youtubeId)
  const embedUrl = buildYouTubeEmbedUrl(youtubeId)

  useEffect(() => {
    const previousFocus = document.activeElement
    closeButtonRef.current?.focus()
    return () => {
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
  }, [])

  if (!item || !youtubeId || !embedUrl) return null

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="discover-player-title"
      data-discover-overlay="true"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
          return
        }
        trapDialogFocus(event, dialogRef.current)
      }}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-sf-dark-600 bg-sf-dark-900 shadow-2xl outline-none"
      >
        <div className="flex items-start gap-3 border-b border-sf-dark-700 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="discover-player-title" className="truncate text-base font-semibold text-sf-text-primary">
              {item.title}
            </h2>
            {item.creator && (
              <p className="mt-0.5 truncate text-xs text-sf-text-muted">
                {t('discover.labels.by', { creator: item.creator }, `By ${item.creator}`)}
              </p>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-sf-text-muted transition-colors hover:bg-sf-dark-700 hover:text-sf-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-sf-accent"
            aria-label={t('discover.actions.close', undefined, 'Close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="aspect-video w-full bg-black">
          <iframe
            src={embedUrl}
            title={t('discover.player.title', { title: item.title }, `YouTube video: ${item.title}`)}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sf-dark-700 px-4 py-3">
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-sf-text-muted">
            {t(
              'discover.player.privacy',
              undefined,
              'Thumbnails are provided by YouTube. Velorn loads the player only after you choose to watch a video.',
            )}
          </p>
          <button
            type="button"
            onClick={() => { void openYouTubeExternally(youtubeId) }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sf-dark-600 bg-sf-dark-800 px-3 py-1.5 text-xs font-medium text-sf-text-secondary transition-colors hover:border-sf-dark-500 hover:text-sf-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-sf-accent"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('discover.actions.openYouTube', undefined, 'Open on YouTube')}
          </button>
        </div>
      </div>
    </div>
  )
}

function SubmissionModal({ onClose }) {
  const { t } = useI18n()
  const dialogRef = useRef(null)
  const closeButtonRef = useRef(null)
  const successHeadingRef = useRef(null)
  const youtubeInputRef = useRef(null)
  const [form, setForm] = useState(INITIAL_SUBMISSION)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const previousFocus = document.activeElement
    closeButtonRef.current?.focus()
    return () => {
      if (previousFocus instanceof HTMLElement) previousFocus.focus()
    }
  }, [])

  useEffect(() => {
    if (sent) successHeadingRef.current?.focus()
  }, [sent])

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }))
    setError('')
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (sending) return

    const youtubeId = extractYouTubeVideoId(form.youtubeUrl)
    if (!youtubeId) {
      setError(t('discover.submit.invalidYouTube', undefined, 'Enter a valid YouTube video URL.'))
      return
    }
    if (!form.creator.trim() || !form.description.trim() || !form.email.trim()) {
      setError(t('discover.submit.requiredFields', undefined, 'Complete all required fields.'))
      return
    }
    if (!form.ownsRights || !form.canFeature) {
      setError(t('discover.submit.permissionsRequired', undefined, 'Confirm both permissions before submitting.'))
      return
    }

    const normalizedUrl = getYouTubeWatchUrl(youtubeId)
    const categoryLabel = t(
      `discover.submit.categories.${form.category}`,
      undefined,
      form.category,
    )
    const message = [
      '[DISCOVER SUBMISSION]',
      `YouTube URL: ${normalizedUrl}`,
      `Creator/display name: ${form.creator.trim()}`,
      `Category: ${categoryLabel}`,
      '',
      'How Velorn was used:',
      form.description.trim(),
      '',
      'Rights/authorization confirmed: Yes',
      'Permission for Velorn to feature the work: Yes',
    ].join('\n')

    if (message.length > FEEDBACK_MESSAGE_MAX_LENGTH) {
      setError(t('discover.submit.tooLong', undefined, 'Please shorten the description and try again.'))
      return
    }

    setSending(true)
    setError('')
    try {
      await sendFeedback({
        category: 'other',
        message,
        email: form.email.trim(),
        diagnostics: null,
      })
      setSent(true)
    } catch (_) {
      setError(t('discover.submit.sendFailed', undefined, 'Could not send the submission. Try again later.'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="discover-submit-title"
      data-discover-overlay="true"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          if (!sending) onClose()
          return
        }
        trapDialogFocus(event, dialogRef.current)
      }}
      onMouseDown={(event) => {
        if (!sending && event.currentTarget === event.target) onClose()
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-sf-dark-600 bg-sf-dark-900 shadow-2xl outline-none"
      >
        <div className="flex items-start gap-3 border-b border-sf-dark-700 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="discover-submit-title" className="text-base font-semibold text-sf-text-primary">
              {t('discover.submit.title', undefined, 'Submit your work')}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-sf-text-muted">
              {t(
                'discover.submit.body',
                undefined,
                'Share a YouTube video made with Velorn. Every submission is reviewed before anything is featured.',
              )}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            disabled={sending}
            className="rounded-lg p-2 text-sf-text-muted transition-colors hover:bg-sf-dark-700 hover:text-sf-text-primary disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sf-accent"
            aria-label={t('discover.actions.close', undefined, 'Close')}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {sent ? (
          <div className="overflow-y-auto px-6 py-10 text-center">
            <div role="status" aria-live="polite">
              <CheckCircle2 className="mx-auto h-10 w-10 text-green-300" aria-hidden="true" />
              <h3
                ref={successHeadingRef}
                tabIndex={-1}
                className="mt-4 text-base font-semibold text-sf-text-primary outline-none"
              >
                {t('discover.submit.successTitle', undefined, 'Submitted for review')}
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-sf-text-muted">
                {t(
                  'discover.submit.successBody',
                  undefined,
                  'Thank you. The Velorn team will review your submission; it will not be published automatically.',
                )}
              </p>
            </div>
            <div className="mt-6 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setForm(INITIAL_SUBMISSION)
                  setSent(false)
                  setError('')
                  requestAnimationFrame(() => youtubeInputRef.current?.focus())
                }}
                className="rounded-lg border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-xs font-medium text-sf-text-secondary transition-colors hover:text-sf-text-primary"
              >
                {t('discover.submit.submitAnother', undefined, 'Submit another')}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg bg-sf-accent px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-sf-accent-hover"
              >
                {t('discover.actions.close', undefined, 'Close')}
              </button>
            </div>
          </div>
        ) : (
          <form className="overflow-y-auto px-5 py-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-sf-text-secondary">
                  {t('discover.submit.youtubeUrl', undefined, 'YouTube URL')}
                </span>
                <input
                  ref={youtubeInputRef}
                  type="url"
                  required
                  value={form.youtubeUrl}
                  onChange={(event) => updateField('youtubeUrl', event.target.value)}
                  placeholder={t('discover.submit.youtubePlaceholder', undefined, 'https://www.youtube.com/watch?v=...')}
                  className="w-full rounded-lg border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-sm text-sf-text-primary outline-none transition-colors placeholder:text-sf-text-muted focus:border-sf-accent"
                />
              </label>

              <label>
                <span className="mb-1.5 block text-xs font-medium text-sf-text-secondary">
                  {t('discover.submit.creator', undefined, 'Creator or display name')}
                </span>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={form.creator}
                  onChange={(event) => updateField('creator', event.target.value)}
                  placeholder={t('discover.submit.creatorPlaceholder', undefined, 'How should we credit you?')}
                  className="w-full rounded-lg border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-sm text-sf-text-primary outline-none transition-colors placeholder:text-sf-text-muted focus:border-sf-accent"
                />
              </label>

              <label>
                <span className="mb-1.5 block text-xs font-medium text-sf-text-secondary">
                  {t('discover.submit.category', undefined, 'Category')}
                </span>
                <select
                  value={form.category}
                  onChange={(event) => updateField('category', event.target.value)}
                  className="w-full rounded-lg border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-sm text-sf-text-primary outline-none transition-colors focus:border-sf-accent"
                >
                  {SUBMISSION_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {t(`discover.submit.categories.${category}`, undefined, category)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-sf-text-secondary">
                  {t('discover.submit.description', undefined, 'How did you use Velorn?')}
                </span>
                <textarea
                  required
                  rows={4}
                  maxLength={2500}
                  value={form.description}
                  onChange={(event) => updateField('description', event.target.value)}
                  placeholder={t(
                    'discover.submit.descriptionPlaceholder',
                    undefined,
                    'Tell us briefly which parts of the project you made or edited in Velorn.',
                  )}
                  className="w-full resize-y rounded-lg border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-sm text-sf-text-primary outline-none transition-colors placeholder:text-sf-text-muted focus:border-sf-accent"
                />
                <span className="mt-1 block text-right text-[10px] text-sf-text-muted">
                  {form.description.length}/2500
                </span>
              </label>

              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-xs font-medium text-sf-text-secondary">
                  {t('discover.submit.email', undefined, 'Contact email')}
                </span>
                <input
                  type="email"
                  required
                  maxLength={200}
                  value={form.email}
                  onChange={(event) => updateField('email', event.target.value)}
                  placeholder={t('discover.submit.emailPlaceholder', undefined, 'you@example.com')}
                  className="w-full rounded-lg border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-sm text-sf-text-primary outline-none transition-colors placeholder:text-sf-text-muted focus:border-sf-accent"
                />
              </label>
            </div>

            <div className="mt-4 space-y-3 rounded-xl border border-sf-dark-700 bg-sf-dark-950/55 p-3.5">
              <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-sf-text-secondary">
                <input
                  type="checkbox"
                  required
                  checked={form.ownsRights}
                  onChange={(event) => updateField('ownsRights', event.target.checked)}
                  className="mt-0.5 accent-sf-accent"
                />
                <span>{t(
                  'discover.submit.rights',
                  undefined,
                  'I own this work or have the authorization required to submit and share it.',
                )}</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-sf-text-secondary">
                <input
                  type="checkbox"
                  required
                  checked={form.canFeature}
                  onChange={(event) => updateField('canFeature', event.target.checked)}
                  className="mt-0.5 accent-sf-accent"
                />
                <span>{t(
                  'discover.submit.featurePermission',
                  undefined,
                  'Velorn may feature the video title, thumbnail, link, description, and creator attribution.',
                )}</span>
              </label>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-sf-text-muted">
              {t(
                'discover.submit.reviewNote',
                undefined,
                'Submissions go to a private moderation queue and are never published automatically.',
              )}
            </p>
            {error && (
              <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
                {error}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2 border-t border-sf-dark-700 pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={sending}
                className="rounded-lg border border-sf-dark-600 bg-sf-dark-800 px-3 py-2 text-xs font-medium text-sf-text-secondary transition-colors hover:text-sf-text-primary disabled:opacity-40"
              >
                {t('discover.actions.close', undefined, 'Close')}
              </button>
              <button
                type="submit"
                disabled={sending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-sf-accent px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-sf-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {sending
                  ? t('discover.submit.submitting', undefined, 'Submitting…')
                  : t('discover.submit.submit', undefined, 'Submit for review')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function SubmissionCallout({ onSubmit }) {
  const { t } = useI18n()
  return (
    <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-sf-accent/25 bg-sf-accent/10 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-sf-text-primary">
          <Upload className="h-4 w-4 text-sf-accent" />
          {t('discover.submit.title', undefined, 'Submit your work')}
        </div>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-sf-text-muted">
          {t(
            'discover.submit.body',
            undefined,
            'Share a YouTube video made with Velorn. Every submission is reviewed before anything is featured.',
          )}
        </p>
      </div>
      <button
        type="button"
        onClick={onSubmit}
        className="inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-lg bg-sf-accent px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-sf-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-sf-accent focus-visible:ring-offset-2 focus-visible:ring-offset-sf-dark-900"
      >
        <Send className="h-3.5 w-3.5" />
        {t('discover.actions.submit', undefined, 'Submit your work')}
      </button>
    </div>
  )
}

export default function DiscoverWorkspace({ onClose }) {
  const { t } = useI18n()
  const loadRequestRef = useRef(0)
  const loadAbortRef = useRef(null)
  const [catalog, setCatalog] = useState(DEFAULT_BUNDLED_DISCOVER_CATALOG)
  const [catalogSource, setCatalogSource] = useState('bundled')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeSection, setActiveSection] = useState('featured')
  const [activeVideo, setActiveVideo] = useState(null)
  const [submissionOpen, setSubmissionOpen] = useState(false)
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === 'undefined' ? true : navigator.onLine !== false
  ))
  const closeVideo = useCallback(() => setActiveVideo(null), [])
  const closeSubmission = useCallback(() => setSubmissionOpen(false), [])

  const loadCatalog = useCallback(async () => {
    loadAbortRef.current?.abort()
    const controller = new AbortController()
    loadAbortRef.current = controller
    const requestId = loadRequestRef.current + 1
    loadRequestRef.current = requestId
    setLoading(true)
    setError('')
    try {
      const result = await loadDiscoverCatalog({ signal: controller.signal })
      if (loadRequestRef.current !== requestId) return
      setCatalog(result.catalog)
      setCatalogSource(result.source)
    } catch (loadError) {
      if (loadRequestRef.current !== requestId) return
      setError(loadError instanceof Error
        ? loadError.message
        : t('discover.states.error', undefined, 'Could not load Discover right now.'))
    } finally {
      if (loadRequestRef.current === requestId) {
        loadAbortRef.current = null
        setLoading(false)
      }
    }
  }, [t])

  useEffect(() => {
    void loadCatalog()
    return () => {
      loadAbortRef.current?.abort()
      loadRequestRef.current += 1
    }
  }, [loadCatalog])

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const items = Array.isArray(catalog?.items) ? catalog.items : []
  const counts = useMemo(() => ({
    featured: getSectionItems(items, 'featured').length,
    showcase: getSectionItems(items, 'showcase').length,
    tutorials: getSectionItems(items, 'tutorials').length,
  }), [items])
  const visibleItems = useMemo(
    () => getSectionItems(items, activeSection),
    [activeSection, items],
  )
  const showOfflineNotice = !isOnline || catalogSource === 'cache'

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-sf-dark-950">
      <header className="flex-shrink-0 border-b border-sf-dark-700 bg-sf-dark-950/95 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-sf-accent" />
              <h1 className="text-lg font-semibold text-sf-text-primary">
                {t('discover.title', undefined, 'Discover')}
              </h1>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-sf-text-muted">
              {t(
                'discover.subtitle',
                undefined,
                'See what creators make with Velorn and learn the workflows behind it.',
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSubmissionOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sf-accent/40 bg-sf-accent/10 px-3 py-2 text-xs font-medium text-sf-accent transition-colors hover:bg-sf-accent/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-sf-accent"
            >
              <Upload className="h-3.5 w-3.5" />
              {t('discover.actions.submit', undefined, 'Submit your work')}
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-sf-dark-700 bg-sf-dark-800 p-2 text-sf-text-muted transition-colors hover:text-sf-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-sf-accent"
                aria-label={t('discover.actions.close', undefined, 'Close')}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <nav className="mt-4 flex flex-wrap gap-1.5" aria-label={t('discover.title', undefined, 'Discover')}>
          {SECTION_IDS.map((section) => {
            const active = activeSection === section
            return (
              <button
                key={section}
                type="button"
                onClick={() => setActiveSection(section)}
                aria-current={active ? 'page' : undefined}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sf-accent ${
                  active
                    ? 'bg-sf-accent text-white'
                    : 'border border-sf-dark-700 bg-sf-dark-900 text-sf-text-muted hover:border-sf-dark-500 hover:text-sf-text-primary'
                }`}
              >
                {t(`discover.tabs.${section}`, undefined, section)}
                {!loading && <span className={`ml-1.5 ${active ? 'text-white/75' : 'text-sf-text-muted'}`}>{counts[section]}</span>}
              </button>
            )
          })}
        </nav>
      </header>

      {showOfflineNotice && catalog && (
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-amber-400/20 bg-amber-400/10 px-5 py-2 text-xs text-amber-200" role="status">
          <WifiOff className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="min-w-0 flex-1">
            {t(
              'discover.states.offline',
              undefined,
              'Showing saved Discover content. New videos may appear when you are back online.',
            )}
          </span>
          <button
            type="button"
            onClick={() => { void loadCatalog() }}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded px-2 py-1 font-medium text-amber-100 hover:bg-amber-300/10 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            {t('discover.actions.retry', undefined, 'Retry')}
          </button>
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {loading && !catalog ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center text-center" role="status">
            <Loader2 className="h-8 w-8 animate-spin text-sf-accent" />
            <p className="mt-3 text-sm text-sf-text-muted">
              {t('discover.states.loading', undefined, 'Loading Discover…')}
            </p>
          </div>
        ) : error && !catalog ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center text-center" role="alert">
            <AlertCircle className="h-9 w-9 text-red-300" />
            <p className="mt-3 text-sm font-medium text-sf-text-primary">
              {t('discover.states.error', undefined, 'Could not load Discover right now.')}
            </p>
            <p className="mt-1 max-w-md text-xs text-sf-text-muted">{error}</p>
            <button
              type="button"
              onClick={() => { void loadCatalog() }}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-sf-accent px-3 py-2 text-xs font-medium text-white hover:bg-sf-accent-hover"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('discover.actions.retry', undefined, 'Retry')}
            </button>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-7xl">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-sf-text-primary">
                {t(`discover.sections.${activeSection}`, undefined, activeSection)}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-sf-text-muted">
                {t(`discover.sections.${activeSection}Description`, undefined, '')}
              </p>
            </div>

            {visibleItems.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visibleItems.map((item) => (
                  <VideoCard
                    key={item.id}
                    item={item}
                    onWatch={setActiveVideo}
                    retryThumbnails={isOnline}
                  />
                ))}
              </div>
            ) : (
              <div className="flex min-h-[230px] flex-col items-center justify-center rounded-2xl border border-dashed border-sf-dark-600 bg-sf-dark-900/40 px-5 text-center">
                {activeSection === 'tutorials'
                  ? <BookOpen className="h-9 w-9 text-sf-text-muted" />
                  : <Film className="h-9 w-9 text-sf-text-muted" />}
                <p className="mt-3 text-sm font-medium text-sf-text-primary">
                  {t('discover.states.empty', undefined, 'There is nothing in this section yet.')}
                </p>
              </div>
            )}

            {activeSection !== 'tutorials' && <SubmissionCallout onSubmit={() => setSubmissionOpen(true)} />}
          </div>
        )}
      </main>

      {activeVideo && <VideoPlayerModal item={activeVideo} onClose={closeVideo} />}
      {submissionOpen && <SubmissionModal onClose={closeSubmission} />}
    </div>
  )
}

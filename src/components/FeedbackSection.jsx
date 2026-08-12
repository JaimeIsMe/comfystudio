import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, MessageCircle, Send } from 'lucide-react'
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  collectFeedbackDiagnostics,
  sendFeedback,
} from '../services/feedback'
import { useI18n } from '../i18n/I18nContext'

const DIAGNOSTIC_LABELS = [
  'appVersion', 'platform', 'os', 'gpu', 'comfyConnected', 'screen',
]

const DISCORD_INVITE_URL = 'https://discord.gg/QWZUuUChVK'

function DiscordCallout() {
  const { t } = useI18n()
  return (
    <a
      href={DISCORD_INVITE_URL}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center gap-3 rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-3 py-2.5 transition-colors hover:border-indigo-400/60 hover:bg-indigo-500/15"
    >
      <MessageCircle className="h-5 w-5 flex-shrink-0 text-indigo-300" />
      <span className="min-w-0 text-[11px] leading-snug text-sf-text-secondary">
        <span className="font-semibold text-sf-text-primary">{t('feedback.discordTitle')}</span>{' '}
        {t('feedback.discordBody')}
      </span>
      <span className="ml-auto flex-shrink-0 rounded bg-indigo-500/80 px-2 py-1 text-[10px] font-medium text-white transition-colors group-hover:bg-indigo-500">
        {t('feedback.join')}
      </span>
    </a>
  )
}

function formatDiagnosticValue(value, t) {
  if (value === null || value === undefined || value === '') return t('feedback.unknown')
  if (value === true) return t('feedback.yes')
  if (value === false) return t('feedback.no')
  return String(value)
}

export default function FeedbackSection() {
  const { t } = useI18n()
  const [category, setCategory] = useState('bug')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true)
  const [diagnostics, setDiagnostics] = useState(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const collected = await collectFeedbackDiagnostics()
      if (!cancelled) setDiagnostics(collected)
    })()
    return () => { cancelled = true }
  }, [])

  const handleSend = async () => {
    if (sending) return
    setError('')
    setSending(true)
    try {
      await sendFeedback({
        category,
        message,
        email,
        diagnostics: includeDiagnostics ? diagnostics : null,
      })
      setSent(true)
      setMessage('')
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : t('feedback.sendFailed'))
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-sf-dark-700 bg-sf-dark-900/60 px-4 py-6 text-center">
          <CheckCircle2 className="mx-auto h-8 w-8 text-green-300" />
          <div className="mt-3 text-sm font-medium text-sf-text-primary">{t('feedback.thanks')}</div>
          <p className="mt-1 text-[11px] text-sf-text-muted">
            {t('feedback.thanksBody')}
          </p>
          <button
            type="button"
            onClick={() => { setSent(false); setError('') }}
            className="mt-4 rounded bg-sf-dark-700 px-3 py-1.5 text-[11px] text-sf-text-secondary hover:bg-sf-dark-600"
          >
            {t('feedback.sendAnother')}
          </button>
        </div>
        <DiscordCallout />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <DiscordCallout />
      <div className="rounded-lg border border-sf-dark-700 bg-sf-dark-900/60 px-3 py-3">
        <div className="text-sm font-medium text-sf-text-primary">{t('feedback.title')}</div>
        <p className="mt-1 text-[11px] text-sf-text-muted">
          {t('feedback.description')}
        </p>

        <div className="mt-3 flex items-center gap-1.5">
          {FEEDBACK_CATEGORIES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setCategory(entry.id)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                category === entry.id
                  ? 'bg-sf-accent text-white'
                  : 'border border-sf-dark-700 bg-sf-dark-800 text-sf-text-muted hover:border-sf-dark-500 hover:text-sf-text-primary'
              }`}
            >
              {t(`feedback.categories.${entry.id}`, undefined, entry.label)}
            </button>
          ))}
        </div>

        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
          rows={5}
          placeholder={category === 'bug'
            ? t('feedback.bugPlaceholder')
            : t('feedback.generalPlaceholder')}
          className="mt-3 w-full resize-y rounded-lg border border-sf-dark-700 bg-sf-dark-800 px-3 py-2 text-xs text-sf-text-primary outline-none transition-colors placeholder:text-sf-text-muted focus:border-sf-accent"
        />

        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t('feedback.emailPlaceholder')}
          className="mt-2 w-full rounded-lg border border-sf-dark-700 bg-sf-dark-800 px-3 py-2 text-xs text-sf-text-primary outline-none transition-colors placeholder:text-sf-text-muted focus:border-sf-accent"
        />

        <label className="mt-3 flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            checked={includeDiagnostics}
            onChange={(event) => setIncludeDiagnostics(event.target.checked)}
            className="mt-0.5 accent-sf-accent"
          />
          <span className="text-[11px] text-sf-text-muted">
            {t('feedback.includeDiagnostics')}
          </span>
        </label>

        {includeDiagnostics && (
          <div className="mt-2 rounded border border-sf-dark-700 bg-black/30 px-3 py-2">
            {diagnostics ? (
              <dl className="space-y-0.5">
                {DIAGNOSTIC_LABELS.map((key) => (
                  <div key={key} className="flex gap-2 text-[11px]">
                    <dt className="w-36 flex-shrink-0 text-sf-text-muted">{t(`feedback.diagnostics.${key}`)}</dt>
                    <dd className="min-w-0 truncate text-sf-text-secondary">{formatDiagnosticValue(diagnostics[key], t)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div className="text-[11px] text-sf-text-muted">{t('feedback.collecting')}</div>
            )}
          </div>
        )}

        {error && <p className="mt-2 text-[11px] text-red-300">{error}</p>}

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[10px] text-sf-text-muted">
            {message.trim().length}/{FEEDBACK_MESSAGE_MAX_LENGTH}
          </span>
          <button
            type="button"
            onClick={() => { void handleSend() }}
            disabled={sending || message.trim().length === 0}
            className="inline-flex items-center gap-1.5 rounded bg-sf-accent px-3 py-1.5 text-[11px] font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            {sending ? t('feedback.sending') : t('feedback.title')}
          </button>
        </div>
      </div>
    </div>
  )
}

import { X } from 'lucide-react'

export default function ConfirmDialog({
  isOpen,
  title = 'Confirm action',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel,
}) {
  if (!isOpen) return null

  const confirmToneClass = tone === 'danger'
    ? 'bg-sf-error hover:bg-red-500 text-white'
    : 'bg-sf-accent hover:bg-sf-accent-hover text-white'

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70" onClick={onCancel}>
      <div
        className="w-full max-w-md mx-4 rounded-xl border border-sf-dark-600 bg-sf-dark-900 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-sf-dark-700">
          <h3 className="text-sm font-medium text-sf-text-primary">{title}</h3>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded hover:bg-sf-dark-700 text-sf-text-muted"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-4 text-sm text-sf-text-secondary whitespace-pre-line">
          {message}
        </div>
        <div className="px-4 py-3 border-t border-sf-dark-700 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded bg-sf-dark-700 hover:bg-sf-dark-600 text-sf-text-secondary text-xs"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 rounded text-xs ${confirmToneClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

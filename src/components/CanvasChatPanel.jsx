import { useEffect, useRef, useState } from 'react'
import { Bot, Loader2, MessageCircle, Send, Trash2, X } from 'lucide-react'

export default function CanvasChatPanel({ open, messages, agentLabel, busy, error, onSend, onClose, onDiscard }) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef(null)

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy, open])

  if (!open) return null

  const submit = (event) => {
    event.preventDefault()
    const content = draft.trim()
    if (!content || busy) return
    setDraft('')
    onSend(content)
  }

  return (
    <aside className="absolute inset-y-3 right-3 z-20 flex w-[420px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border border-slate-300/20 bg-slate-950/95 shadow-2xl shadow-black/50 backdrop-blur-xl">
      <header className="flex items-start justify-between gap-3 border-b border-slate-400/15 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-sf-text-primary"><MessageCircle className="h-4 w-4 text-sf-accent" /> Canvas Chat</div>
          <p className="mt-0.5 truncate text-[10px] text-slate-400">{agentLabel ? `Using ${agentLabel} · Canvas + Velorn MCP context` : 'Configure a Canvas LLM agent in Settings first'}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button type="button" onClick={onDiscard} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] text-slate-300 hover:bg-red-950/60 hover:text-red-200" title="Discard this conversation"><Trash2 className="h-3.5 w-3.5" /> Discard</button>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100" aria-label="Close Canvas Chat"><X className="h-4 w-4" /></button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {!messages.length && !busy && (
          <div className="rounded-xl border border-slate-400/15 bg-slate-900/60 p-3 text-[11px] leading-relaxed text-slate-300">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-sf-text-primary"><Bot className="h-3.5 w-3.5 text-sf-accent" /> Grounded in this Canvas</div>
            Ask about the current production structure, available Canvas nodes, or what Velorn MCP can inspect and plan. This chat never makes MCP changes on its own.
          </div>
        )}
        {messages.map((message) => (
          <div key={message.id} className={`max-w-[92%] whitespace-pre-wrap rounded-xl px-3 py-2 text-xs leading-relaxed ${message.role === 'user' ? 'ml-auto bg-sf-accent/20 text-slate-100' : 'border border-slate-400/15 bg-slate-900/75 text-slate-200'}`}>
            {message.content}
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-[11px] text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking with the current Canvas…</div>}
        {error && <div className="rounded-lg border border-red-400/25 bg-red-950/30 px-3 py-2 text-[11px] text-red-200">{error}</div>}
      </div>

      <form onSubmit={submit} className="border-t border-slate-400/15 p-3">
        <div className="flex gap-2">
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={2} disabled={!agentLabel || busy} placeholder={agentLabel ? 'Ask about this Canvas or Velorn capabilities…' : 'Select and configure a Canvas agent in Settings'} className="min-h-[52px] min-w-0 flex-1 resize-none rounded-lg border border-slate-500/40 bg-slate-900 px-3 py-2 text-xs text-sf-text-primary outline-none placeholder:text-slate-500 focus:border-sf-accent disabled:cursor-not-allowed disabled:opacity-60" />
          <button type="submit" disabled={!draft.trim() || !agentLabel || busy} className="inline-flex h-[52px] w-11 items-center justify-center rounded-lg bg-sf-accent text-white transition-colors hover:bg-sf-accent-hover disabled:cursor-not-allowed disabled:opacity-50" aria-label="Send Canvas Chat message"><Send className="h-4 w-4" /></button>
        </div>
      </form>
    </aside>
  )
}

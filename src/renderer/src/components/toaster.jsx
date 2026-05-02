import { CheckCircle2, XCircle, Info, X } from 'lucide-react'
import { useToastStore } from '@/store/toast.store.js'
import { cn } from '@/lib/utils'

/**
 * Глобальный портал для тостов. Монтируется один раз в App.jsx.
 * Тосты позиционируются bottom-right, новейшие сверху стека.
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[80] flex flex-col-reverse gap-2 max-w-sm">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onDismiss }) {
  const { kind, message } = toast
  const Icon =
    kind === 'ok' ? CheckCircle2 : kind === 'error' ? XCircle : Info
  const palette =
    kind === 'ok'
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
      : kind === 'error'
        ? 'border-destructive/40 bg-destructive/10 text-destructive'
        : 'border-border bg-card text-foreground'

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-xs shadow-lg backdrop-blur animate-in slide-in-from-right-4 fade-in duration-200',
        palette
      )}
    >
      <Icon size={14} className="mt-0.5 shrink-0" />
      <div className="flex-1 break-words whitespace-pre-line">{message}</div>
      <button
        onClick={onDismiss}
        className="shrink-0 -m-0.5 p-0.5 opacity-60 hover:opacity-100"
        title="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  )
}

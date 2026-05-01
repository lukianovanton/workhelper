import { Loader2, AlertCircle, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'

/**
 * Унифицированные «состояния списка» — loading / empty / error —
 * используются на projects-list, my-tasks, в табах drawer'а.
 *
 * Цель — одинаковый вид и размер, чтобы переключения между разными
 * экранами не давали ощущения «другого приложения». Caller
 * отвечает только за тексты и опциональные icon / cta.
 */

/**
 * Маленький inline-спиннер с подписью. Подходит для небольших
 * блоков (popover, секция drawer'а), не для full-page загрузок.
 */
export function LoadingInline({ message, className }) {
  const t = useT()
  return (
    <div
      className={cn(
        'text-xs text-muted-foreground inline-flex items-center gap-2',
        className
      )}
    >
      <Loader2 size={12} className="animate-spin" />
      {message ?? t('common.loading')}
    </div>
  )
}

/**
 * Skeleton-плашка для list-style загрузок. Несколько серых полосок
 * в соответствующем padding'е, имитируют структуру строки. Caller
 * выбирает количество.
 */
export function ListSkeleton({ rows = 6, className }) {
  return (
    <div className={cn('p-6 space-y-3', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-3 bg-muted rounded w-3/4 animate-pulse" />
          <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
        </div>
      ))}
    </div>
  )
}

/**
 * Generic empty state — для случаев "запрос прошёл, но результат
 * пуст". Опциональный icon (большой, по центру), title (жирный),
 * message (приглушённый), cta (кнопка/ссылка под текстом).
 */
export function EmptyState({ icon: Icon, title, message, cta, className }) {
  return (
    <div
      className={cn(
        'h-full flex items-center justify-center text-center p-8',
        className
      )}
    >
      <div className="max-w-sm space-y-3">
        {Icon && (
          <Icon size={32} className="mx-auto text-muted-foreground/40" />
        )}
        {title && <h3 className="font-medium">{title}</h3>}
        {message && (
          <p className="text-sm text-muted-foreground">{message}</p>
        )}
        {cta}
      </div>
    </div>
  )
}

/**
 * Generic error state — AlertCircle + title (по умолчанию из i18n)
 * + message от error.message. Если передан onRetry — кнопка
 * Retry; если cta — рендерится дополнительно (для случая когда
 * error связан с config'ом и хочется отправить в Settings).
 */
export function ErrorState({
  title,
  message,
  error,
  onRetry,
  cta,
  className
}) {
  const t = useT()
  const text = message || error?.message || String(error || '')
  return (
    <div
      className={cn(
        'h-full flex items-center justify-center p-8',
        className
      )}
    >
      <div className="max-w-md text-center space-y-3">
        <AlertCircle className="mx-auto text-destructive" size={32} />
        {title && <h3 className="font-medium">{title}</h3>}
        {text && (
          <p className="text-sm text-muted-foreground break-words">
            {text}
          </p>
        )}
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw size={12} /> {t('drawer.tab.errorState.retry')}
          </Button>
        )}
        {cta}
      </div>
    </div>
  )
}

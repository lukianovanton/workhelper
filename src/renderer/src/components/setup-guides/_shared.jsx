import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Общие визуальные элементы для setup-гайдов в Settings. Каждый
 * гайд собирается из <Step>, <Section>, <ExtLink>; так все они
 * выглядят однородно и легко добавлять новые.
 */

export function Step({ number, title, children }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-sky-500/20 text-sky-300 text-[11px] tabular-nums">
          {number}
        </span>
        {title}
      </h3>
      <div className="space-y-2 pl-7 text-muted-foreground">{children}</div>
    </section>
  )
}

export function Section({ title, children, className }) {
  return (
    <section className={cn('space-y-2', className)}>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <div className="space-y-2 text-muted-foreground">{children}</div>
    </section>
  )
}

export function ExtLink({ href, children }) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault()
        window.open(href, '_blank')
      }}
      className="text-sky-400 hover:underline inline-flex items-center gap-1 align-baseline"
    >
      {children}
      <ExternalLink size={11} />
    </button>
  )
}

export function GuideShell({ children }) {
  return (
    <div className="space-y-6 text-sm leading-relaxed">{children}</div>
  )
}

import { ExternalLink, Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Рекурсивный рендерер Atlassian Document Format (ADF) в React.
 *
 * ADF — это tree из nodes. Каждая node имеет type, опционально
 * content (children) и attrs / marks. Документация:
 *   https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
 *
 * Покрытие:
 *  - Базовые блоки: doc, paragraph, hardBreak, heading, blockquote,
 *    codeBlock, rule, panel
 *  - Списки: bulletList, orderedList, listItem
 *  - Inline: text (с marks: link, code, strong, em, strike, underline)
 *  - Smart-cards: inlineCard, blockCard (рендерятся как ссылка)
 *  - Mentions: @display
 *  - Media: mediaSingle / mediaGroup / media — placeholder с
 *    иконкой 📎 и именем файла. Полноценная подгрузка картинок
 *    из Jira требует отдельного запроса /attachment/content/{id} —
 *    отложено.
 *  - Любой неизвестный type — рекурсивно рендерим content (если
 *    есть), не пытаясь воспроизвести специфическое поведение.
 */
export function AdfRenderer({ node }) {
  if (node == null) return null
  if (typeof node === 'string') return node
  if (Array.isArray(node)) {
    return node.map((c, i) => <AdfRenderer key={i} node={c} />)
  }
  return renderNode(node)
}

function renderChildren(node) {
  if (!Array.isArray(node?.content)) return null
  return node.content.map((c, i) => <AdfRenderer key={i} node={c} />)
}

function renderNode(node) {
  const { type, attrs } = node

  switch (type) {
    case 'doc':
      return <>{renderChildren(node)}</>

    case 'paragraph':
      return <p className="my-1 first:mt-0 last:mb-0">{renderChildren(node)}</p>

    case 'text':
      return renderTextWithMarks(node)

    case 'hardBreak':
      return <br />

    case 'heading': {
      const level = attrs?.level || 3
      const cls = 'font-semibold text-foreground'
      const sizeCls =
        level === 1
          ? 'text-base mt-3'
          : level === 2
          ? 'text-sm mt-3'
          : 'text-xs mt-2 uppercase tracking-wide text-muted-foreground'
      return (
        <div className={cn(cls, sizeCls)}>{renderChildren(node)}</div>
      )
    }

    case 'bulletList':
      return (
        <ul className="list-disc pl-5 space-y-0.5 my-1">
          {renderChildren(node)}
        </ul>
      )

    case 'orderedList':
      return (
        <ol className="list-decimal pl-5 space-y-0.5 my-1">
          {renderChildren(node)}
        </ol>
      )

    case 'listItem':
      return <li>{renderChildren(node)}</li>

    case 'codeBlock':
      return (
        <pre className="bg-zinc-950 text-zinc-200 rounded text-[11px] p-2 overflow-x-auto my-1.5">
          {renderChildren(node)}
        </pre>
      )

    case 'blockquote':
      return (
        <blockquote className="border-l-2 border-border pl-3 text-muted-foreground my-1">
          {renderChildren(node)}
        </blockquote>
      )

    case 'rule':
      return <hr className="border-border my-2" />

    case 'panel': {
      // Panel'ы у Jira бывают info / warning / note / success / error.
      // Цветим border соответственно.
      const tone = attrs?.panelType || 'info'
      const toneCls =
        tone === 'warning' || tone === 'error'
          ? 'border-amber-500/60 bg-amber-500/10'
          : tone === 'success'
          ? 'border-emerald-500/60 bg-emerald-500/10'
          : 'border-sky-500/60 bg-sky-500/10'
      return (
        <div className={cn('border-l-2 pl-3 py-1 my-1.5', toneCls)}>
          {renderChildren(node)}
        </div>
      )
    }

    case 'inlineCard':
    case 'blockCard': {
      const url = attrs?.url || attrs?.data?.url
      if (!url) return null
      return <SmartLink url={url} block={type === 'blockCard'} />
    }

    case 'mention': {
      // attrs.text обычно вида "@Display Name" — берём как есть,
      // подкрашиваем чтоб не сливалось с обычным текстом.
      const text = attrs?.text || `@${attrs?.id || 'user'}`
      return (
        <span className="text-sky-400 bg-sky-500/10 px-1 rounded-sm">
          {text}
        </span>
      )
    }

    case 'emoji':
      return <span>{attrs?.text || attrs?.shortName || ''}</span>

    case 'date':
      return (
        <span className="text-muted-foreground font-mono text-[11px]">
          {attrs?.timestamp
            ? new Date(Number(attrs.timestamp)).toLocaleDateString()
            : ''}
        </span>
      )

    case 'mediaSingle':
    case 'mediaGroup':
      return (
        <div className="my-1.5 flex flex-wrap gap-2">
          {renderChildren(node)}
        </div>
      )

    case 'media': {
      // Для рендера реальной картинки нужен отдельный запрос на
      // /attachment/content/{id} с авторизацией; отложено. Пока
      // показываем placeholder с именем файла, чтобы хотя бы было
      // понятно что в этом месте было приложение.
      const name = attrs?.alt || attrs?.collection || attrs?.id || 'attachment'
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/30 border border-border/40 rounded px-1.5 py-0.5">
          <Paperclip size={10} />
          <span className="truncate max-w-[20rem]">{String(name)}</span>
        </span>
      )
    }

    default:
      // Неизвестный type — fallback, пытаемся отрендерить children.
      return renderChildren(node) || null
  }
}

/**
 * Рендер текста с marks. Marks применяются изнутри наружу:
 * link оборачивает <a>, code/strong/em/strike/underline — обёртки
 * соответствующих тегов.
 */
function renderTextWithMarks(node) {
  const text = node.text || ''
  const marks = node.marks || []
  if (marks.length === 0) return text

  let el = text
  for (const mark of marks) {
    el = applyMark(el, mark)
  }
  return el
}

function applyMark(child, mark) {
  switch (mark.type) {
    case 'strong':
      return <strong>{child}</strong>
    case 'em':
      return <em>{child}</em>
    case 'underline':
      return <u>{child}</u>
    case 'strike':
      return <s>{child}</s>
    case 'code':
      return (
        <code className="bg-muted/40 text-foreground/90 px-1 rounded text-[11px] font-mono">
          {child}
        </code>
      )
    case 'subsup':
      return mark.attrs?.type === 'sub' ? <sub>{child}</sub> : <sup>{child}</sup>
    case 'textColor':
      return (
        <span style={{ color: mark.attrs?.color || 'inherit' }}>{child}</span>
      )
    case 'link': {
      const href = mark.attrs?.href
      if (!href) return child
      return <SmartLink url={href} inline label={child} />
    }
    default:
      return child
  }
}

/**
 * Кликабельная ссылка, открывает в системном браузере. Если block=
 * true — отдельный блок с иконкой; иначе inline-якорь.
 */
function SmartLink({ url, label, block, inline }) {
  const open = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (url) window.open(url, '_blank')
  }
  if (block) {
    return (
      <a
        href={url}
        onClick={open}
        className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline bg-muted/20 border border-border/40 rounded px-2 py-1 my-1"
      >
        <ExternalLink size={11} />
        <span className="truncate max-w-[28rem]">{label || url}</span>
      </a>
    )
  }
  return (
    <a
      href={url}
      onClick={open}
      className={cn(
        'text-sky-400 hover:underline cursor-pointer',
        inline && 'inline'
      )}
    >
      {label || url}
    </a>
  )
}

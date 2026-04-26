import { Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Полоска сверху экрана: «Update X.Y.Z is ready. [Restart now] [×]».
 * Появляется только когда electron-updater уже скачал апдейт
 * (autoDownload по умолчанию). При клике Restart now приложение
 * закрывается и инсталлятор обновления стартует автоматически.
 */
export function UpdateBanner({ version, onRestart, onDismiss }) {
  return (
    <div className="fixed top-0 left-0 right-0 z-[60] flex items-center justify-center gap-3 px-4 py-2 bg-sky-600 text-white text-sm shadow-lg">
      <Download size={14} className="shrink-0" />
      <span>
        Update <strong>{version || 'latest'}</strong> downloaded — restart
        to install.
      </span>
      <Button
        size="sm"
        variant="secondary"
        className="h-7 ml-2"
        onClick={onRestart}
      >
        Restart now
      </Button>
      <button
        onClick={onDismiss}
        className="ml-1 opacity-80 hover:opacity-100"
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}

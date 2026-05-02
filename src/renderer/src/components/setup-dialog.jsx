import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  AlertTriangle,
  FolderOpen,
  Play,
  Code2
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useSetupStore } from '@/store/setup.store.js'
import { cn } from '@/lib/utils'
import { api } from '@/api'

/**
 * Setup & Run / Setup remaining dialog.
 * Pre-flight → running → done/error/cancelled.
 *
 * Closing during running is blocked (overlay/escape disabled);
 * only Cancel button works (with confirmation).
 */
export function SetupDialog({ project, open, onOpenChange }) {
  const slug = project.slug
  const setupState = useSetupStore((s) => s.bySlug[slug])
  const clearSetup = useSetupStore((s) => s.clear)

  // Pre-flight options
  const initialDumpPath = project.db.dumpPath || null
  const [dumpPath, setDumpPath] = useState(initialDumpPath)
  const [skipRestore, setSkipRestore] = useState(false)
  // setupDb: создавать ли БД у проекта вообще. Дефолт — true для
  // обратной совместимости и потому что у legacy-юзеров большинство
  // проектов с БД. Юзер выключает для фронтенд-only / no-db проектов.
  const [setupDb, setSetupDb] = useState(true)
  // Опциональные пост-шаги — по умолчанию OFF.
  const [openWorkspace, setOpenWorkspace] = useState(false)
  const [runAfter, setRunAfter] = useState(false)
  const [acknowledgeReplace, setAcknowledgeReplace] = useState(false)
  const [picking, setPicking] = useState(false)
  const [pickError, setPickError] = useState(null)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  const phase = setupState?.phase ?? 'pre-flight'
  const isRunning = phase === 'running'
  const isTerminal =
    phase === 'finished' || phase === 'failed' || phase === 'cancelled'

  // Reset pre-flight options when reopening on a fresh project state
  useEffect(() => {
    if (!open) return
    if (!setupState) {
      setDumpPath(project.db.dumpPath || null)
      setSkipRestore(false)
      // Дефолт setupDb: ON если у проекта уже есть DB-override (юзер
      // явно привязал подключение / имя), ИЛИ если БД с таким slug
      // уже существует (project.db.exists). Иначе считаем что DB не
      // нужен и пред-выключаем — фронтенд-проекты без БД не должны
      // спотыкаться об «No engine configured».
      const hasDbBinding =
        project.db.exists ||
        (project.db.name && project.db.name !== '')
      setSetupDb(!!hasDbBinding)
      setOpenWorkspace(false)
      setRunAfter(false)
      setAcknowledgeReplace(false)
      setSubmitError(null)
    }
  }, [
    open,
    project.slug,
    project.db.dumpPath,
    project.db.exists,
    project.db.name,
    setupState
  ])

  // dump filename for display
  const dumpFilename = useMemo(() => {
    if (!dumpPath) return null
    return dumpPath.split(/[\\/]/).pop()
  }, [dumpPath])

  const dbHasData = project.db.exists && (project.db.sizeBytes ?? 0) > 0
  const willRestore = setupDb && !skipRestore && !!dumpPath
  const willReplace = willRestore && dbHasData
  const canStart = !willReplace || acknowledgeReplace

  const onPickDump = async () => {
    setPicking(true)
    setPickError(null)
    try {
      const picked = await api.fs.pickDump()
      if (picked) {
        setDumpPath(picked)
        setSkipRestore(false)
      }
    } catch (e) {
      setPickError(e?.message || String(e))
    } finally {
      setPicking(false)
    }
  }

  const onStart = async () => {
    setSubmitError(null)
    try {
      await api.setup.runFull({
        slug,
        dumpPath: setupDb && !skipRestore ? dumpPath : null,
        skipRestore: !setupDb || skipRestore,
        skipDb: !setupDb,
        openWorkspace,
        runAfter
      })
    } catch (e) {
      // failed/cancelled state уже зеркалится из broadcast
      // Здесь только non-broadcast ошибки (например, parallel start).
      if (!setupState || setupState.phase === 'pre-flight') {
        setSubmitError(e?.message || String(e))
      }
    }
  }

  const onCancelRunning = async () => {
    setCancelDialogOpen(false)
    try {
      await api.setup.cancel(slug)
    } catch {
      // ignore
    }
  }

  const onClose = () => {
    if (isTerminal && setupState) {
      clearSetup(slug)
    }
    onOpenChange(false)
  }

  const handleOpenChange = (next) => {
    if (next) {
      onOpenChange(true)
      return
    }
    if (isRunning) {
      // Blocked — must use Cancel button
      return
    }
    onClose()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="sm:max-w-2xl"
          hideClose={isRunning}
          onEscapeKeyDown={(e) => {
            if (isRunning) e.preventDefault()
          }}
          onPointerDownOutside={(e) => {
            if (isRunning) e.preventDefault()
          }}
          onInteractOutside={(e) => {
            if (isRunning) e.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {phase === 'pre-flight' &&
                (project.local.cloned ? 'Setup remaining' : 'Setup & Run')}
              {phase === 'running' && `Setting up ${slug}`}
              {phase === 'finished' && `${slug} is ready`}
              {phase === 'failed' && `Setup failed`}
              {phase === 'cancelled' && `Setup cancelled`}
            </DialogTitle>
            {phase === 'pre-flight' && (
              <DialogDescription>
                Review the steps below and start when ready.
              </DialogDescription>
            )}
          </DialogHeader>

          {phase === 'pre-flight' && (
            <PreFlight
              project={project}
              dumpPath={dumpPath}
              dumpFilename={dumpFilename}
              setupDb={setupDb}
              setSetupDb={setSetupDb}
              skipRestore={skipRestore}
              setSkipRestore={setSkipRestore}
              openWorkspace={openWorkspace}
              setOpenWorkspace={setOpenWorkspace}
              runAfter={runAfter}
              setRunAfter={setRunAfter}
              willReplace={willReplace}
              acknowledgeReplace={acknowledgeReplace}
              setAcknowledgeReplace={setAcknowledgeReplace}
              dbHasData={dbHasData}
              onPickDump={onPickDump}
              picking={picking}
              pickError={pickError}
              submitError={submitError}
            />
          )}

          {(isRunning || isTerminal) && (
            <RunningSteps
              project={project}
              steps={setupState?.steps || {}}
              phase={phase}
              error={setupState?.error}
              runAfter={runAfter}
            />
          )}

          <DialogFooter>
            {phase === 'pre-flight' && (
              <>
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button onClick={onStart} disabled={!canStart}>
                  Start setup
                </Button>
              </>
            )}
            {isRunning && (
              <Button
                variant="outline"
                className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setCancelDialogOpen(true)}
              >
                Cancel setup
              </Button>
            )}
            {isTerminal && <Button onClick={onClose}>Done</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel setup?</AlertDialogTitle>
            <AlertDialogDescription>
              The current step will be interrupted where possible (DB
              restore stops immediately; an active git clone may take up
              to a minute to wind down). Already-completed steps stay
              as-is.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              onClick={onCancelRunning}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancel setup
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function PreFlight({
  project,
  dumpPath,
  dumpFilename,
  setupDb,
  setSetupDb,
  skipRestore,
  setSkipRestore,
  openWorkspace,
  setOpenWorkspace,
  runAfter,
  setRunAfter,
  willReplace,
  acknowledgeReplace,
  setAcknowledgeReplace,
  dbHasData,
  onPickDump,
  picking,
  pickError,
  submitError
}) {
  const cloned = project.local.cloned
  const dbExists = project.db.exists
  const slug = project.slug

  // Source-aware clone label: project.url приходит из VCS-провайдера и
  // содержит реальный URL источника (https://github.com/<owner>/<slug>
  // для GH или https://bitbucket.org/<ws>/<slug> для BB). Срезаем
  // протокол для краткости.
  const cloneOrigin = (project.url || '').replace(/^https?:\/\//, '')

  const dumpsRoot =
    project.db.dumpPath && dumpFilename
      ? project.db.dumpPath.slice(
          0,
          project.db.dumpPath.length - dumpFilename.length - 1
        )
      : null

  return (
    <div className="space-y-4">
      <PreFlightItem
        on={!cloned}
        skip={cloned}
        title={
          cloned
            ? `Skip clone — already cloned at ${project.local.path}`
            : `Clone from ${cloneOrigin || slug}`
        }
      />

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
          <Checkbox
            checked={setupDb}
            onCheckedChange={(v) => setSetupDb(!!v)}
          />
          <span>Set up a database for this project</span>
        </label>
        {!setupDb && (
          <div className="pl-7 text-[11px] text-muted-foreground/70">
            DB create / restore steps are skipped. Pick this if the
            project doesn't need a database (frontend-only, library,
            etc.).
          </div>
        )}
      </div>

      {setupDb && (
        <>
          <PreFlightItem
            on={!dbExists}
            skip={dbExists}
            title={
              dbExists
                ? `Skip database create — ${project.db.name} already exists`
                : `Create database ${project.db.name}`
            }
          />

          <div className="space-y-2">
            <PreFlightItem
              on={!skipRestore && !!dumpPath}
              skip={skipRestore || !dumpPath}
              title={
                !dumpPath
                  ? 'No dump auto-detected — choose file or skip'
                  : skipRestore
                  ? 'Skip database restore'
                  : `Restore from ${dumpFilename}`
              }
              right={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onPickDump}
                  disabled={picking}
                >
                  {picking ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <FolderOpen />
                  )}
                  {dumpPath ? 'Change…' : 'Choose file…'}
                </Button>
              }
            />
            {dumpPath && dumpsRoot && (
              <div className="pl-7 text-[11px] text-muted-foreground/70">
                From <code className="text-[11px]">{dumpsRoot}</code>
              </div>
            )}
            {pickError && (
              <div className="pl-7 text-xs text-destructive">{pickError}</div>
            )}
            <label className="pl-7 flex items-center gap-2 text-xs text-muted-foreground select-none cursor-pointer">
              <Checkbox
                checked={skipRestore}
                onCheckedChange={(v) => setSkipRestore(!!v)}
              />
              <span>Skip database restore</span>
            </label>
          </div>
        </>
      )}

      <div className="space-y-2 pt-2">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Optional post-steps
        </div>
        <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
          <Checkbox
            checked={openWorkspace}
            onCheckedChange={(v) => setOpenWorkspace(!!v)}
          />
          <Code2 size={14} className="text-muted-foreground" />
          <span>Open {slug} in VS Code after setup</span>
        </label>
        <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
          <Checkbox
            checked={runAfter}
            onCheckedChange={(v) => setRunAfter(!!v)}
          />
          <Play size={14} className="text-muted-foreground" />
          <span>Run after setup</span>
        </label>
      </div>

      {willReplace && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <div>
              Database <code className="font-mono">{project.db.name}</code>{' '}
              already has{' '}
              <strong>{formatBytes(project.db.sizeBytes)}</strong> of data.
              Setup will <strong>DROP and recreate</strong> it from{' '}
              <code className="font-mono">{dumpFilename}</code>. Existing
              data will be permanently lost.
            </div>
          </div>
          <label className="flex items-start gap-2 cursor-pointer text-foreground">
            <Checkbox
              checked={acknowledgeReplace}
              onCheckedChange={(v) => setAcknowledgeReplace(!!v)}
              className="mt-0.5"
            />
            <span>
              I understand. Replace the database during setup.
            </span>
          </label>
        </div>
      )}

      {dbHasData && skipRestore && (
        <div className="text-xs text-muted-foreground pl-7">
          Existing data in {project.db.name} will be kept (restore skipped).
        </div>
      )}

      {submitError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive flex items-start gap-2">
          <XCircle size={14} className="mt-0.5 shrink-0" />
          <div>{submitError}</div>
        </div>
      )}
    </div>
  )
}

function PreFlightItem({ on, skip, title, right }) {
  const Icon = skip ? Circle : on ? CheckCircle2 : Circle
  const color = skip
    ? 'text-muted-foreground/60'
    : on
    ? 'text-emerald-500'
    : 'text-muted-foreground'
  return (
    <div className="flex items-start gap-3">
      <Icon size={16} className={cn('mt-0.5 shrink-0', color)} />
      <div className="flex-1 text-sm">{title}</div>
      {right}
    </div>
  )
}

const STEPS_ORDER = [
  { kind: 'clone', label: 'Clone repository' },
  { kind: 'db-create', label: 'Create database' },
  { kind: 'db-restore', label: 'Restore dump' },
  { kind: 'workspace', label: 'Open VS Code workspace' }
]

function RunningSteps({ project, steps, phase, error, runAfter }) {
  return (
    <div className="space-y-3">
      {STEPS_ORDER.map(({ kind, label }) => (
        <StepRow
          key={kind}
          kind={kind}
          label={label}
          step={steps[kind]}
          dbName={project.db.name}
        />
      ))}

      {phase === 'finished' && runAfter && (
        <div className="text-sm text-muted-foreground pl-7">
          dotnet starting in background — runtime status updates in the
          drawer.
        </div>
      )}

      {phase === 'failed' && error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive flex items-start gap-2">
          <XCircle size={14} className="mt-0.5 shrink-0" />
          <div className="flex-1 break-words">{error}</div>
        </div>
      )}

      {phase === 'cancelled' && (
        <div className="text-xs text-muted-foreground">
          Setup cancelled. Already-completed steps were preserved.
        </div>
      )}
    </div>
  )
}

function StepRow({ kind, label, step, dbName }) {
  const status = step?.status
  const Icon =
    status === 'done'
      ? CheckCircle2
      : status === 'progress' || status === 'start'
      ? Loader2
      : status === 'error'
      ? XCircle
      : Circle
  const color =
    status === 'done'
      ? 'text-emerald-500'
      : status === 'progress' || status === 'start'
      ? 'text-sky-500'
      : status === 'error'
      ? 'text-destructive'
      : 'text-muted-foreground/50'
  const animate = status === 'progress' || status === 'start' ? 'animate-spin' : ''

  const isRestore = kind === 'db-restore'
  const percent =
    isRestore && step?.percent != null ? Math.floor(step.percent) : null
  const bytesRead = step?.bytesRead ?? 0
  const totalBytes = step?.totalBytes ?? 0

  return (
    <div className="flex items-start gap-3">
      <Icon
        size={16}
        className={cn('mt-0.5 shrink-0', color, animate)}
      />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="text-sm flex items-center gap-3 flex-wrap">
          <span className="font-medium">
            {kind === 'db-create'
              ? `Create database ${dbName}`
              : kind === 'db-restore'
              ? `Restore dump`
              : label}
          </span>
          {step?.durationMs != null && status === 'done' && (
            <span className="text-xs text-muted-foreground">
              done in {(step.durationMs / 1000).toFixed(1)}s
            </span>
          )}
          {step?.message && status === 'done' && (
            <span className="text-xs text-muted-foreground">
              {step.message}
            </span>
          )}
        </div>
        {isRestore && status === 'progress' && totalBytes > 0 && (
          <>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-sky-500 transition-[width] duration-200 rounded-full"
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
            <div className="text-[11px] text-muted-foreground tabular-nums">
              {percent}% · {formatBytes(bytesRead)} /{' '}
              {formatBytes(totalBytes)}
            </div>
          </>
        )}
        {status === 'error' && step?.message && (
          <div className="text-xs text-destructive break-words">
            {step.message}
          </div>
        )}
      </div>
    </div>
  )
}

function formatBytes(n) {
  if (n == null || Number.isNaN(n)) return '—'
  if (n === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

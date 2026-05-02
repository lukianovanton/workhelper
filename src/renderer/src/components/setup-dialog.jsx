import { useEffect, useMemo, useRef, useState } from 'react'
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

  // Auto-detected stack: пустой объект на старте; заполняется через
  // api.setup.detectStack когда диалог открыт И проект клонирован.
  // Используется чтобы предложить умный дефолт для setupDb (нужна БД
  // или нет) и показать пользователю «что мы поняли про проект».
  const [detectedStack, setDetectedStack] = useState(null)
  // Node-status для Node-проектов: required version из engines/.nvmrc,
  // системная версия, Volta info, satisfied-флаг. Если репо не Node —
  // required = null и UI ничего не рендерит.
  const [nodeStatus, setNodeStatus] = useState(null)
  // Toolchain: VS Build Tools + Python detection + missing-list для
  // native-deps. Если у проекта нет нативных модулей и не Node —
  // UI ничего не рендерит.
  const [toolchainStatus, setToolchainStatus] = useState(null)
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
      // Дефолт setupDb: ON если у проекта УЖЕ есть БД (project.db.exists).
      // Иначе сначала false, а после auto-detect ниже выставится в
      // detectedStack.needsDatabase. Это снижает количество ложно-
      // положительных «давайте создадим БД» для no-DB проектов.
      setSetupDb(!!project.db.exists)
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
    setupState
  ])

  // Auto-detect стека после открытия диалога. Backend сам решает
  // источник данных: для клонированного проекта читает файлы локально,
  // для не-клона тянет root-listing + нужные манифесты через
  // VcsProvider.{listRootFiles, getFileText}. UI в обоих случаях
  // получает одинаковый shape; отдельных code-path'ов нет.
  // Применяет needsDatabase к setupDb, но только если юзер ещё не
  // успел руками тоггльнуть (we use a ref to track it).
  const userTouchedSetupDbRef = useRef(false)
  useEffect(() => {
    if (!open) {
      setDetectedStack(null)
      setNodeStatus(null)
      setToolchainStatus(null)
      userTouchedSetupDbRef.current = false
      return
    }
    let cancelled = false
    api.setup.detectStack(project.slug).then((r) => {
      if (cancelled || !r) return
      setDetectedStack(r)
      // Apply needsDatabase only if user hasn't touched the toggle yet.
      if (!userTouchedSetupDbRef.current) {
        // Если БД уже существует — не выключаем (явный сигнал что нужно).
        if (project.db.exists) return
        setSetupDb(!!r.needsDatabase)
      }
    })
    // Параллельно запрашиваем Node-status. Для не-Node проектов
    // backend вернёт required=null — UI просто скрывает банер.
    api.node?.status?.(project.slug).then((s) => {
      if (cancelled) return
      setNodeStatus(s || null)
    })
    // Toolchain status — native deps + системные tool'ы. Для не-Node
    // / no-native проектов banner не рендерится.
    api.toolchain?.status?.(project.slug).then((s) => {
      if (cancelled) return
      setToolchainStatus(s || null)
    })
    return () => {
      cancelled = true
    }
  }, [open, project.slug, project.db.exists])

  // Refetch только Node-status (после write .nvmrc / install Volta).
  // Используется баннером NodeStatusBanner чтобы UI сразу обновился
  // с picker'а на «Node X ready».
  const refetchNodeStatus = async () => {
    try {
      const s = await api.node?.status?.(project.slug)
      setNodeStatus(s || null)
    } catch {
      // ignore
    }
  }
  const refetchToolchain = async () => {
    try {
      await api.toolchain?.invalidateCache?.()
      const s = await api.toolchain?.status?.(project.slug)
      setToolchainStatus(s || null)
    } catch {
      // ignore
    }
  }

  const onSetSetupDb = (v) => {
    userTouchedSetupDbRef.current = true
    setSetupDb(v)
  }

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
              setSetupDb={onSetSetupDb}
              detectedStack={detectedStack}
              nodeStatus={nodeStatus}
              refetchNodeStatus={refetchNodeStatus}
              toolchainStatus={toolchainStatus}
              refetchToolchain={refetchToolchain}
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
  detectedStack,
  nodeStatus,
  refetchNodeStatus,
  toolchainStatus,
  refetchToolchain,
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

      {detectedStack?.stackKind && (
        <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <DetectedStackLine stack={detectedStack} />
        </div>
      )}

      <NodeStatusBanner
        project={project}
        status={nodeStatus}
        onStatusRefetch={refetchNodeStatus}
      />

      <ToolchainBanner
        status={toolchainStatus}
        onRefetch={refetchToolchain}
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

/**
 * Однострочная подсказка «что мы детектнули в проекте». Только
 * информативная, никаких кнопок: dialog уже подкорректировал
 * defaults (setupDb / runCommand) на основе этого результата.
 */
function DetectedStackLine({ stack }) {
  const labels = {
    dotnet: '.NET',
    node: 'Node.js',
    cargo: 'Rust (Cargo)',
    go: 'Go',
    make: 'Make-based'
  }
  const stackLabel = labels[stack.stackKind] || stack.stackKind
  const cmd = stack.runCommand
    ? ` · run with `
    : ''
  return (
    <span>
      <strong className="text-foreground">Detected:</strong> {stackLabel}
      {stack.cwd && (
        <>
          {' '}in <code className="text-foreground">{stack.cwd}/</code>
        </>
      )}
      {stack.runCommand && (
        <>
          {cmd}
          <code className="text-foreground">{stack.runCommand}</code>
        </>
      )}
      {stack.needsDatabase ? ' · DB references found' : ' · no DB references'}
    </span>
  )
}

/**
 * Banner под Detected-stack'ом. Показывается только если у проекта
 * закреплена Node-version (engines / .nvmrc / volta.node) и есть
 * расхождение с системной версией. Три состояния:
 *
 *   1. Required матчит system или Volta уже знает версию
 *      → emerald «Node version ready»
 *   2. Volta installed, версия отсутствует
 *      → amber, info: setup install'нет автоматически в node-prep step
 *   3. Volta NOT installed, версия не матчит
 *      → amber, action: «Install Volta» button (открывает Settings)
 */
/**
 * Common Node major-versions для picker'а. Покрывают типичные случаи:
 * 14 (легаси проекты с node-sass 4-5), 16 (популярная LTS времён 2021-22),
 * 18 (LTS 2022-2024), 20 (текущая LTS), 22 (последняя). Юзер может
 * также набрать любую другую через free-text input.
 */
const COMMON_NODE_VERSIONS = ['14', '16', '18', '20', '22']

function NodeStatusBanner({ project, status, onStatusRefetch }) {
  const [installingVolta, setInstallingVolta] = useState(false)
  const [installResult, setInstallResult] = useState(null)
  const [picking, setPicking] = useState(false)
  const [pickedVersion, setPickedVersion] = useState('18')
  const [customVersion, setCustomVersion] = useState('')
  const [savingVersion, setSavingVersion] = useState(false)

  if (!status) return null
  // Не Node-проект — banner вообще не показываем.
  if (!status.isNodeProject) return null

  const required = status.required
  const sys = status.systemVersion
  const volta = status.volta
  const satisfied = status.satisfied

  const onInstallVolta = async () => {
    setInstallingVolta(true)
    setInstallResult(null)
    try {
      const r = await api.node.installVolta()
      setInstallResult(r)
      if (r.ok) onStatusRefetch?.()
    } catch (e) {
      setInstallResult({ ok: false, message: e?.message || String(e) })
    } finally {
      setInstallingVolta(false)
    }
  }

  const onSaveVersion = async () => {
    const version = (customVersion.trim() || pickedVersion || '').trim()
    if (!version) return
    setSavingVersion(true)
    setInstallResult(null)
    try {
      const r = await api.node.writeNvmrc(project.slug, version)
      setInstallResult(r)
      if (r.ok) {
        setPicking(false)
        onStatusRefetch?.()
      }
    } catch (e) {
      setInstallResult({ ok: false, message: e?.message || String(e) })
    } finally {
      setSavingVersion(false)
    }
  }

  // ── Состояние 1: всё ок (required pinned, satisfied) ──
  if (required && satisfied) {
    return (
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 text-emerald-400 px-3 py-2 text-xs flex items-start gap-2">
        <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
        <span>
          Node <code>{required.raw}</code> ready
          {volta.installed ? ' (via Volta)' : ` (system Node ${sys})`}.
        </span>
      </div>
    )
  }

  // ── Состояние 2: required pinned, but mismatch ──
  if (required && !satisfied) {
    if (volta.installed) {
      return (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-400 px-3 py-2 text-xs flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Project requires Node <code>{required.raw}</code> (system has{' '}
            {sys || 'no node'}). Will install via Volta during setup.
          </span>
        </div>
      )
    }
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-400 px-3 py-2 text-xs flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <div className="flex-1 space-y-1.5">
          <span>
            Project requires Node <code>{required.raw}</code> (system has{' '}
            {sys || 'no node'}). Install Volta to auto-manage Node versions —
            without it, npm install may fail on native deps.
          </span>
          <div>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={onInstallVolta}
              disabled={installingVolta}
            >
              {installingVolta && <Loader2 size={12} className="animate-spin" />}
              Install Volta
            </Button>
            {installResult && (
              <div
                className={cn(
                  'mt-1.5 text-[11px]',
                  installResult.ok ? 'text-emerald-500' : 'text-destructive'
                )}
              >
                {installResult.message}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Состояние 3: NOT pinned, Node-проект — picker ──
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-400 px-3 py-2 text-xs flex items-start gap-2">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <div className="flex-1 space-y-2">
        <span>
          No Node version pinned for this project (no <code>.nvmrc</code> /{' '}
          <code>engines.node</code>). System has Node {sys || '—'}. If
          npm install fails on native deps, pick a compatible Node version
          below — we'll write <code>.nvmrc</code>{' '}
          {volta.installed ? 'and install via Volta' : '(install Volta to auto-switch)'}.
        </span>
        {!picking ? (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => {
                setPicking(true)
                setInstallResult(null)
              }}
            >
              Pick Node version
            </Button>
            {!volta.installed && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={onInstallVolta}
                disabled={installingVolta}
              >
                {installingVolta && (
                  <Loader2 size={12} className="animate-spin" />
                )}
                Install Volta
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {COMMON_NODE_VERSIONS.map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setPickedVersion(v)
                    setCustomVersion('')
                  }}
                  className={cn(
                    'px-2 py-1 rounded-md border text-xs',
                    pickedVersion === v && !customVersion
                      ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                      : 'border-border hover:bg-accent text-muted-foreground'
                  )}
                >
                  Node {v}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customVersion}
                onChange={(e) => setCustomVersion(e.target.value)}
                placeholder="or exact: 16.20.2"
                className="flex-1 bg-background border border-input rounded-md px-2 py-1 text-xs placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                size="sm"
                className="h-7"
                onClick={onSaveVersion}
                disabled={savingVersion}
              >
                {savingVersion && <Loader2 size={12} className="animate-spin" />}
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() => setPicking(false)}
                disabled={savingVersion}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        {installResult && (
          <div
            className={cn(
              'text-[11px]',
              installResult.ok ? 'text-emerald-500' : 'text-destructive'
            )}
          >
            {installResult.message}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Toolchain banner — VS Build Tools + Python для node-gyp нативных
 * сборок. Рендерится только если у проекта есть нативные deps И на
 * системе чего-то не хватает.
 *
 * Не-Node проекты: server возвращает requirements=null → банер скрыт.
 * Node без native-deps: missing.ok=true → банер скрыт.
 * Node с native-deps + всё уже стоит: тоже missing.ok=true → скрыт.
 *
 * Состояние «надо ставить»: показываем список missing tools + кнопки
 * установки. Build Tools — UAC required (объяснение в подсказке);
 * Python — silent per-user. После каждой install'ки refetch'аем
 * toolchainStatus так что UI прогрессивно зеленеет.
 */
function ToolchainBanner({ status, onRefetch }) {
  const [installing, setInstalling] = useState(null) // 'buildTools' | 'python' | null
  const [lastResult, setLastResult] = useState(null)

  if (!status) return null
  const { requirements, state, missing } = status
  if (!requirements?.isNodeProject) return null
  if (!requirements.node.nativeDeps?.length) return null
  if (missing.ok) {
    // Всё хорошо для этого проекта.
    return (
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 text-emerald-400 px-3 py-2 text-xs flex items-start gap-2">
        <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
        <span>
          Native build toolchain ready — <code>
            {requirements.node.nativeDeps.slice(0, 3).join(', ')}
            {requirements.node.nativeDeps.length > 3 ? ', …' : ''}
          </code>
          {' '}can compile.
        </span>
      </div>
    )
  }

  const onInstall = async (which) => {
    setInstalling(which)
    setLastResult(null)
    try {
      const fn =
        which === 'buildTools'
          ? api.toolchain.installBuildTools
          : api.toolchain.installPython
      const result = await fn()
      setLastResult({ which, ...result })
      if (result.ok && onRefetch) await onRefetch()
    } catch (e) {
      setLastResult({
        which,
        ok: false,
        message: e?.message || String(e)
      })
    } finally {
      setInstalling(null)
    }
  }

  const buildToolsNeeded = missing.buildTools
  const pythonNeeded = missing.python

  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-400 px-3 py-2 text-xs flex items-start gap-2">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <div className="flex-1 space-y-2">
        <div>
          Project has native dependencies (
          <code>
            {requirements.node.nativeDeps.slice(0, 3).join(', ')}
            {requirements.node.nativeDeps.length > 3 ? ', …' : ''}
          </code>
          ) which require system build tools to compile during npm install.
          Missing on this machine:
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            {missing.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {buildToolsNeeded && (
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => onInstall('buildTools')}
              disabled={installing != null}
              title="Visual Studio Build Tools — Microsoft installer, ~2GB. Triggers a UAC prompt."
            >
              {installing === 'buildTools' && (
                <Loader2 size={12} className="animate-spin" />
              )}
              Install Build Tools (UAC)
            </Button>
          )}
          {pythonNeeded && (
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => onInstall('python')}
              disabled={installing != null}
              title="Python 3.12 per-user install (~25 MB). No UAC needed."
            >
              {installing === 'python' && (
                <Loader2 size={12} className="animate-spin" />
              )}
              Install Python
            </Button>
          )}
        </div>
        {installing === 'buildTools' && (
          <div className="text-[11px] text-muted-foreground">
            Build Tools installer is running quietly (~5–15 minutes,
            ~2 GB download). The system progress dialog may appear briefly.
            You can leave this dialog open.
          </div>
        )}
        {lastResult && (
          <div
            className={cn(
              'text-[11px]',
              lastResult.ok ? 'text-emerald-500' : 'text-destructive'
            )}
          >
            {lastResult.message}
          </div>
        )}
      </div>
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
  { kind: 'toolchain-prep', label: 'Verify build toolchain' },
  { kind: 'node-prep', label: 'Prepare Node version' },
  { kind: 'deps', label: 'Install dependencies' },
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
          Starting in background — runtime status updates in the drawer.
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

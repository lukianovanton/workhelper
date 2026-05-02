import {
  useEffect,
  useState,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle
} from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  Sun,
  Moon,
  Monitor,
  Rows3,
  Rows4,
  Cloud,
  Folder,
  Database,
  Code2,
  Users,
  Palette,
  BookOpen,
  Plus,
  Trash2,
  Inbox
} from 'lucide-react'
import { usePrefsStore } from '@/store/prefs.store.js'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
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
import { JiraSetupGuide } from '@/components/setup-guides/jira'
import { PathsSetupGuide } from '@/components/setup-guides/paths'
import { DotnetSetupGuide } from '@/components/setup-guides/dotnet'
import { PresenceSetupGuide } from '@/components/setup-guides/presence'
import { AppearanceSetupGuide } from '@/components/setup-guides/appearance'
import {
  VCS_PROVIDERS,
  getVcsProvider,
  listVcsProviders
} from '@/lib/vcs-providers'
import {
  DB_ENGINES,
  getDbEngine,
  listDbEngines
} from '@/lib/db-engines'
import { useT, SUPPORTED_LANGUAGES } from '@/i18n'
import { api } from '@/api'

// Гайды для секций (paths / jira / defaults / presence / appearance) —
// один централизованный Dialog с переключаемым контентом по id.
// Гайды для VCS-провайдеров и DB-движков идут из их соответствующих
// renderer-side реестров (lib/vcs-providers.jsx, lib/db-engines.jsx) —
// добавление нового провайдера/движка не требует правки этого файла.
const SECTION_GUIDES = {
  jira: {
    titleKey: 'settings.jira.title',
    descriptionKey: 'settings.guide.jira.dialogDescription',
    Component: JiraSetupGuide
  },
  paths: {
    titleKey: 'settings.paths.title',
    descriptionKey: 'settings.guide.paths.dialogDescription',
    Component: PathsSetupGuide
  },
  defaults: {
    titleKey: 'settings.defaults.title',
    descriptionKey: 'settings.guide.dotnet.dialogDescription',
    Component: DotnetSetupGuide
  },
  presence: {
    titleKey: 'settings.presence.title',
    descriptionKey: 'settings.guide.presence.dialogDescription',
    Component: PresenceSetupGuide
  },
  appearance: {
    titleKey: 'settings.appearance.title',
    descriptionKey: 'settings.guide.appearance.dialogDescription',
    Component: AppearanceSetupGuide
  }
}

/**
 * Резолв гайда по его id. id может быть:
 *   - тип VCS-провайдера ('bitbucket', 'github', ...) → берём из VCS_PROVIDERS
 *   - тип DB-engine'а ('mysql', 'postgres', ...) → DB_ENGINES
 *   - id секции ('jira', 'paths', etc.) → SECTION_GUIDES
 */
function resolveGuide(id) {
  const vcs = getVcsProvider(id)
  if (vcs) {
    return {
      titleKey: vcs.guideTitleKey,
      descriptionKey: vcs.guideDescriptionKey,
      Component: vcs.GuideComponent
    }
  }
  const db = getDbEngine(id)
  if (db) {
    return {
      titleKey: db.guideTitleKey,
      descriptionKey: db.guideDescriptionKey,
      Component: db.GuideComponent
    }
  }
  return SECTION_GUIDES[id] || null
}

// Persistent: при возврате в Settings показывается тот же раздел,
// который был открыт. localStorage, не часть config.json.
const SECTION_STORAGE_KEY = 'settings-active-section'

const SECTIONS = /** @type {const} */ ([
  { id: 'sources', labelKey: 'settings.section.sources', icon: Cloud },
  { id: 'jira', labelKey: 'settings.section.jira', icon: Inbox },
  { id: 'paths', labelKey: 'settings.section.paths', icon: Folder },
  { id: 'database', labelKey: 'settings.section.database', icon: Database },
  { id: 'defaults', labelKey: 'settings.section.defaults', icon: Code2 },
  { id: 'presence', labelKey: 'settings.section.presence', icon: Users },
  { id: 'appearance', labelKey: 'settings.section.appearance', icon: Palette }
])

// Legacy id маппинги: пользователи с сохранённой активной секцией от
// до-A.6 версии увидят соответствующую новую секцию вместо «404».
// 'atlassian' / 'bitbucket' разводятся в Sources; 'dotnet' → 'defaults'.
const LEGACY_SECTION_MAP = {
  atlassian: 'sources',
  bitbucket: 'sources',
  dotnet: 'defaults'
}

function loadActiveSection() {
  try {
    const v = localStorage.getItem(SECTION_STORAGE_KEY)
    const mapped = LEGACY_SECTION_MAP[v] || v
    if (mapped && SECTIONS.some((s) => s.id === mapped)) return mapped
  } catch {
    // ignore
  }
  return 'sources'
}

export default function Settings() {
  const navigate = useNavigate()
  const t = useT()
  const [config, setConfig] = useState(null)
  const [secretsStatus, setSecretsStatus] = useState({
    bitbucketApiToken: false,
    dbPassword: false,
    jiraApiToken: false
  })
  const [jiraApiToken, setJiraApiToken] = useState('')
  const [vscodeDetected, setVscodeDetected] = useState(null)
  // Per-engine detected executable, ключ = engine.type. Динамически
  // строится по DB_ENGINES чтобы добавление нового движка (mssql, mongo)
  // не требовало правки этого useState.
  const [dbExecutablesDetected, setDbExecutablesDetected] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState(null)
  const [testingJira, setTestingJira] = useState(false)
  const [jiraTestResult, setJiraTestResult] = useState(null)
  const [activeSection, setActiveSection] = useState(loadActiveSection)
  // Открыт ли setup-guide modal. Один state на все секции (одновременно
  // открыт максимум один guide), значение — id секции / null.
  const [guideOpen, setGuideOpen] = useState(null)
  // Refs на section-компоненты, экспонирующие imperative API:
  // page-header «+ Add Bitbucket / GitHub / MySQL / Postgres» зовёт
  // ref.current.startAdd(type) — создаётся новый draft внутри секции,
  // её state owner.
  const sourcesSectionRef = useRef(null)
  const databasesSectionRef = useRef(null)
  useEffect(() => {
    try {
      localStorage.setItem(SECTION_STORAGE_KEY, activeSection)
    } catch {
      // ignore
    }
  }, [activeSection])

  const loadAll = useCallback(async () => {
    const [c, s] = await Promise.all([
      api.config.get(),
      api.config.secretsStatus()
    ])
    setConfig(c)
    setSecretsStatus(s)
    setJiraApiToken('')
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Детектим по каноническому имени из PATH, а не по текущему значению
  // поля. Иначе если у пользователя в поле случайно осталось что-то
  // выглядящее абсолютным путём (например 'C:\' от полу-вписанной
  // правки), whichBinary возвращает это назад как-есть и кнопка
  // «Use detected» предлагает уже сломанное значение.
  useEffect(() => {
    if (!config) return
    api.config.whichBinary('code').then(setVscodeDetected)
    // Парсим список движков из реестра — добавление mssql / mongo
    // подхватится без правок здесь. Каждый detect асинхронно складывает
    // результат в dbExecutablesDetected[engine.type].
    for (const engine of listDbEngines()) {
      api.config.whichBinary(engine.executableName).then((path) => {
        setDbExecutablesDetected((prev) => ({
          ...prev,
          [engine.type]: path
        }))
      })
    }
  }, [config])

  if (!config) {
    return (
      <div className="h-screen flex items-center justify-center text-muted-foreground text-sm">
        <Loader2 className="animate-spin mr-2" /> Loading settings…
      </div>
    )
  }

  const updatePath = (section, key) => (value) => {
    setConfig((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value }
    }))
    if (section === 'jira') setJiraTestResult(null)
  }

  const onTestJira = async () => {
    setTestingJira(true)
    setJiraTestResult(null)
    try {
      const result = await api.jira.testConnection()
      setJiraTestResult(result)
    } catch (e) {
      setJiraTestResult({
        ok: false,
        stage: 'error',
        message: e?.message || String(e)
      })
    } finally {
      setTestingJira(false)
    }
  }

  const onSave = async () => {
    setSaving(true)
    setSaveStatus(null)
    try {
      await api.config.set(config)
      if (jiraApiToken) {
        await api.config.setSecret('jiraApiToken', jiraApiToken)
      }
      await loadAll()
      setSaveStatus({ ok: true, message: 'Saved' })
    } catch (e) {
      setSaveStatus({ ok: false, message: e?.message || String(e) })
    } finally {
      setSaving(false)
      // Только успех само исчезает через 3с; ошибка остаётся до
      // явного закрытия (✕) — её часто хочется прочитать и
      // скопировать (например, чтобы вставить в issue или поиск).
      setTimeout(() => {
        setSaveStatus((prev) => (prev && prev.ok ? null : prev))
      }, 3000)
    }
  }

  const onClearSecret = async (key) => {
    await api.config.clearSecret(key)
    await loadAll()
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-background">
      <header className="px-6 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/projects')}>
            <ArrowLeft />
            {t('common.back')}
          </Button>
          <h2 className="text-base font-medium">{t('settings.title')}</h2>
        </div>
        <div className="flex items-center gap-3">
          {saveStatus && (
            <span
              className={cn(
                'text-xs flex items-center gap-1.5 max-w-md',
                saveStatus.ok ? 'text-emerald-500' : 'text-destructive'
              )}
            >
              {saveStatus.ok ? (
                <Check size={14} className="shrink-0" />
              ) : (
                <X size={14} className="shrink-0" />
              )}
              <span className="break-words">
                {saveStatus.ok && saveStatus.message === 'Saved'
                  ? t('common.saved')
                  : saveStatus.message}
              </span>
              {!saveStatus.ok && (
                <button
                  onClick={() => setSaveStatus(null)}
                  className="ml-1 shrink-0 opacity-60 hover:opacity-100"
                  title={t('common.dismiss')}
                >
                  <X size={11} />
                </button>
              )}
            </span>
          )}
          {/* Section-aware actions: Sources / Databases имеют per-card
              Apply, поэтому глобальный Save в этих секциях прячется и
              на его месте появляются «+ Add ...» кнопки конкретного
              типа. Остальные секции (paths, defaults, jira, presence,
              appearance) пишут в config — там остаётся обычный Save. */}
          {activeSection === 'sources' ? (
            listVcsProviders().map((p) => (
              <Button
                key={p.type}
                variant="outline"
                size="sm"
                onClick={() => sourcesSectionRef.current?.startAdd(p.type)}
              >
                <Plus />
                {t(p.addButtonLabelKey)}
              </Button>
            ))
          ) : activeSection === 'database' ? (
            listDbEngines().map((e) => (
              <Button
                key={e.type}
                variant="outline"
                size="sm"
                onClick={() => databasesSectionRef.current?.startAdd(e.type)}
              >
                <Plus />
                {t(e.addButtonLabelKey)}
              </Button>
            ))
          ) : (
            <Button onClick={onSave} disabled={saving}>
              {saving && <Loader2 className="animate-spin" />}
              {t('common.save')}
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-56 shrink-0 border-r border-border bg-card flex flex-col">
          <nav className="flex-1 p-3 space-y-1 text-sm overflow-y-auto">
            {SECTIONS.map((s) => {
              const Icon = s.icon
              const active = s.id === activeSection
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-md flex items-center gap-2 transition-colors',
                    active
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/60 text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon size={14} />
                  <span>{t(s.labelKey)}</span>
                </button>
              )
            })}
          </nav>
          <div className="p-3 border-t border-border text-[11px] text-muted-foreground space-y-1 leading-snug">
            <p>
              {t('settings.footer.configPrefix')}{' '}
              <code className="text-[10px]">
                %APPDATA%\\project-hub\\config.json
              </code>
            </p>
            <p>
              {t('settings.footer.secretsPrefix')}{' '}
              <code className="text-[10px]">secrets.json</code>
            </p>
          </div>
        </aside>

        <main className="flex-1 overflow-auto">
          <div
            className={cn(
              'p-6',
              activeSection === 'sources' || activeSection === 'database'
                ? 'max-w-7xl'
                : 'max-w-2xl'
            )}
          >
            {activeSection === 'sources' && (
              <SourcesSection
                ref={sourcesSectionRef}
                onOpenGuide={(id) => setGuideOpen(id)}
              />
            )}

            {activeSection === 'jira' && (
              <Card>
                <SectionCardHeader
                  title={t('settings.jira.title')}
                  description={t('settings.jira.description')}
                  onOpenGuide={() => setGuideOpen('jira')}
                />
                <CardContent className="space-y-4">
                  <Field
                    label={t('settings.jira.host')}
                    hint={t('settings.jira.host.hint')}
                  >
                    <Input
                      value={config.jira?.host || ''}
                      onChange={(e) =>
                        updatePath('jira', 'host')(e.target.value)
                      }
                      placeholder="https://yourcompany.atlassian.net"
                    />
                  </Field>
                  <SecretField
                    label={t('settings.jira.token')}
                    hint={t('settings.jira.token.hint')}
                    status={secretsStatus.jiraApiToken}
                    value={jiraApiToken}
                    onChange={setJiraApiToken}
                    onClear={() => {
                      onClearSecret('jiraApiToken')
                      setJiraTestResult(null)
                    }}
                  />
                  <div className="pt-1 space-y-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onTestJira}
                      disabled={testingJira}
                    >
                      {testingJira && (
                        <Loader2 className="animate-spin" />
                      )}
                      {t('common.testConnection')}
                    </Button>
                    <JiraTestResult result={jiraTestResult} />
                  </div>
                </CardContent>
              </Card>
            )}

            {activeSection === 'paths' && (
              <Card>
                <SectionCardHeader
                  title={t('settings.paths.title')}
                  description={t('settings.paths.description')}
                  onOpenGuide={() => setGuideOpen('paths')}
                />
                <CardContent className="space-y-4">
                  <Field
                    label={t('settings.paths.projectsRoot')}
                    hint={t('settings.paths.projectsRoot.hint')}
                  >
                    <Input
                      value={config.paths.projectsRoot}
                      onChange={(e) =>
                        updatePath('paths', 'projectsRoot')(e.target.value)
                      }
                      placeholder="C:\\Projects"
                    />
                  </Field>
                  <Field
                    label={t('settings.paths.dumpsRoot')}
                    hint={t('settings.paths.dumpsRoot.hint')}
                  >
                    <Input
                      value={config.paths.dumpsRoot}
                      onChange={(e) =>
                        updatePath('paths', 'dumpsRoot')(e.target.value)
                      }
                      placeholder="C:\\Dumps"
                    />
                  </Field>
                  <BinaryPathField
                    label={t('settings.paths.vscode')}
                    value={config.paths.vscodeExecutable}
                    detected={vscodeDetected}
                    placeholder="code"
                    notFoundHint={t('settings.paths.vscode.notFound')}
                    onChange={(v) =>
                      updatePath('paths', 'vscodeExecutable')(v)
                    }
                  />
                </CardContent>
              </Card>
            )}

            {activeSection === 'database' && (
              <DatabasesSection
                ref={databasesSectionRef}
                onOpenGuide={(id) => setGuideOpen(id)}
                detected={dbExecutablesDetected}
              />
            )}

            {activeSection === 'defaults' && (
              <Card>
                <SectionCardHeader
                  title={t('settings.defaults.title')}
                  description={t('settings.defaults.description')}
                  onOpenGuide={() => setGuideOpen('defaults')}
                />
                <CardContent className="space-y-4">
                  <Field
                    label={t('settings.defaults.runCommand')}
                    hint={t('settings.defaults.runCommand.hint')}
                  >
                    <Input
                      value={config.defaults?.runCommand || ''}
                      onChange={(e) =>
                        updatePath(
                          'defaults',
                          'runCommand'
                        )(e.target.value)
                      }
                      placeholder="dotnet run"
                    />
                  </Field>
                </CardContent>
              </Card>
            )}

            {activeSection === 'presence' && (
              <PresenceCard
                config={config}
                updatePath={updatePath}
                onOpenGuide={() => setGuideOpen('presence')}
              />
            )}

            {activeSection === 'appearance' && (
              <AppearanceCard
                onOpenGuide={() => setGuideOpen('appearance')}
              />
            )}
          </div>
        </main>
      </div>

      <Dialog
        open={!!guideOpen}
        onOpenChange={(o) => !o && setGuideOpen(null)}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {(() => {
            const guide = guideOpen ? resolveGuide(guideOpen) : null
            if (!guide) return null
            const G = guide.Component
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{t(guide.titleKey)}</DialogTitle>
                  <DialogDescription>
                    {t(guide.descriptionKey)}
                  </DialogDescription>
                </DialogHeader>
                <G />
              </>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Заголовок-обёртка для всех Settings-карточек: title + description
 * слева, кнопка "Setup guide" справа. Сделана отдельно, чтобы
 * добавление guide-кнопки в новую карточку было одной строчкой.
 */
function SectionCardHeader({ title, description, onOpenGuide }) {
  const t = useT()
  return (
    <CardHeader>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {onOpenGuide && (
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenGuide}
            title={t('settings.openSetupGuide')}
          >
            <BookOpen size={13} />
            {t('settings.setupGuide')}
          </Button>
        )}
      </div>
    </CardHeader>
  )
}

function PresenceCard({ config, updatePath, onOpenGuide }) {
  const t = useT()
  const enabled = !!config.presence?.enabled

  const onToggle = async (next) => {
    updatePath('presence', 'enabled')(next)
    // Запускаем/останавливаем сразу, не дожидаясь Save — чтобы тоггл
    // ощущался отзывчивым. На Save главный конфиг тоже сохранится.
    try {
      await api.presence.setEnabled(next)
    } catch {
      // ignore — UI всё равно отразит состояние
    }
  }

  return (
    <Card>
      <SectionCardHeader
        title={t('settings.presence.title')}
        description={t('settings.presence.description')}
        onOpenGuide={onOpenGuide}
      />
      <CardContent className="space-y-2">
        <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
            className="rounded border-input"
          />
          {t('settings.presence.enable')}
        </label>
        <p className="text-xs text-muted-foreground">
          {t('settings.presence.privacy')}
        </p>
      </CardContent>
    </Card>
  )
}

function AppearanceCard({ onOpenGuide }) {
  const t = useT()
  const theme = usePrefsStore((s) => s.theme)
  const setTheme = usePrefsStore((s) => s.setTheme)
  const density = usePrefsStore((s) => s.density)
  const setDensity = usePrefsStore((s) => s.setDensity)
  const autoRefreshMs = usePrefsStore((s) => s.autoRefreshMs)
  const setAutoRefreshMs = usePrefsStore((s) => s.setAutoRefreshMs)
  const searchHighlight = usePrefsStore((s) => s.searchHighlight)
  const setSearchHighlight = usePrefsStore((s) => s.setSearchHighlight)
  const language = usePrefsStore((s) => s.language) || 'en'
  const setLanguage = usePrefsStore((s) => s.setLanguage)

  return (
    <Card>
      <SectionCardHeader
        title={t('settings.appearance.title')}
        description={t('settings.appearance.description')}
        onOpenGuide={onOpenGuide}
      />
      <CardContent className="space-y-4">
        <Field label={t('settings.appearance.language')}>
          <SegmentedRadio
            options={SUPPORTED_LANGUAGES.map((l) => ({
              value: l.id,
              label: l.label
            }))}
            value={language}
            onChange={setLanguage}
          />
        </Field>
        <Field label={t('settings.appearance.theme')}>
          <SegmentedRadio
            options={[
              {
                value: 'dark',
                label: t('settings.appearance.theme.dark'),
                icon: <Moon size={14} />
              },
              {
                value: 'light',
                label: t('settings.appearance.theme.light'),
                icon: <Sun size={14} />
              },
              {
                value: 'system',
                label: t('settings.appearance.theme.system'),
                icon: <Monitor size={14} />
              }
            ]}
            value={theme}
            onChange={setTheme}
          />
        </Field>
        <Field label={t('settings.appearance.density')}>
          <SegmentedRadio
            options={[
              {
                value: 'comfortable',
                label: t('settings.appearance.density.comfortable'),
                icon: <Rows3 size={14} />
              },
              {
                value: 'compact',
                label: t('settings.appearance.density.compact'),
                icon: <Rows4 size={14} />
              }
            ]}
            value={density}
            onChange={setDensity}
          />
        </Field>
        <Field
          label={t('settings.appearance.autoRefresh')}
          hint={t('settings.appearance.autoRefresh.hint')}
        >
          <SegmentedRadio
            options={[
              { value: 0, label: t('settings.appearance.autoRefresh.off') },
              {
                value: 60_000,
                label: t('settings.appearance.autoRefresh.1m')
              },
              {
                value: 300_000,
                label: t('settings.appearance.autoRefresh.5m')
              },
              {
                value: 600_000,
                label: t('settings.appearance.autoRefresh.10m')
              }
            ]}
            value={autoRefreshMs}
            onChange={setAutoRefreshMs}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={searchHighlight}
            onChange={(e) => setSearchHighlight(e.target.checked)}
            className="rounded border-input"
          />
          {t('settings.appearance.searchHighlight')}
        </label>
      </CardContent>
    </Card>
  )
}

function SegmentedRadio({ options, value, onChange }) {
  return (
    <div className="inline-flex rounded-md border border-input p-0.5 bg-background">
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={String(opt.value)}
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 text-xs rounded-sm transition-colors',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Шапка страницы-секции (живёт ВНЕ Card, не как SectionCardHeader
 * который рендерит CardHeader). Используется когда страница состоит
 * из нескольких Card'ов и общему заголовку нет смысла оборачиваться
 * в свою Card.
 */
function SectionPageHeader({ title, description, onOpenGuide }) {
  const t = useT()
  return (
    <div className="flex items-start justify-between gap-3 pb-2">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {onOpenGuide && (
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenGuide}
          title={t('settings.openSetupGuide')}
        >
          <BookOpen size={13} />
          {t('settings.setupGuide')}
        </Button>
      )}
    </div>
  )
}

/**
 * Управление VCS-источниками: страница-секция, разложенная гридом
 * 1/2 колонки, каждая карточка — отдельный source (Bitbucket / GitHub).
 *
 *   - Каждая карточка автономна: header с title + per-card actions
 *     ([Setup guide] / [Test] / [Apply] / [Remove] для сохранённых;
 *     [Save] / [Cancel] для черновиков), body — форма полей.
 *   - Кнопки «+ Add Bitbucket / + Add GitHub» рендерятся не здесь, а в
 *     шапке страницы рядом с глобальным Save: parent зовёт imperative
 *     `ref.current.startAdd(type)`.
 *
 * Stateful-логика (load/save/remove/test/setSecret/clearSecret) живёт
 * в SourcesSection; SourceCard ниже — чистая презентация + колбэки.
 */
const SourcesSection = forwardRef(function SourcesSection(
  { onOpenGuide },
  ref
) {
  const t = useT()
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState({})
  const [tokens, setTokens] = useState({})
  const [busy, setBusy] = useState({})
  const [testResults, setTestResults] = useState({})
  const [errors, setErrors] = useState({})
  // Per-id timestamp последнего успешного Apply. Используется чтобы
  // ненадолго показать «Saved ✓» в самой Apply-кнопке (см. SourceCard).
  const [savedStamps, setSavedStamps] = useState({})
  // id источника, который пользователь хочет удалить — рендерим
  // в AlertDialog ниже. Native window.confirm выглядит чужеродно,
  // поэтому используем нашу alert-dialog компоненту (Radix).
  const [pendingRemoveId, setPendingRemoveId] = useState(null)

  const markSaved = useCallback((id) => {
    setSavedStamps((prev) => ({ ...prev, [id]: Date.now() }))
    // Авто-сброс через 2.5с — после этого кнопка возвращается в
    // обычное «Apply».
    setTimeout(() => {
      setSavedStamps((prev) => {
        if (!prev[id]) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
    }, 2500)
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.sources.list()
      setSources(list)
      const initialDrafts = {}
      for (const s of list) initialDrafts[s.id] = { ...s }
      setDrafts(initialDrafts)
      setTokens({})
      setErrors({})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const updateDraft = (id, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value }
    }))
    setTestResults((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    // Если до этого «Saved ✓» висел на этой карточке — снимаем,
    // иначе зелёная подсветка вводит в заблуждение пока пользователь
    // редактирует только что сохранённую запись.
    setSavedStamps((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const setToken = (id, value) => {
    setTokens((prev) => ({ ...prev, [id]: value }))
  }

  const startAdd = useCallback((type) => {
    const tempId = `__new_${Date.now()}`
    // Fallback на первый зарегистрированный провайдер если type не
    // передали (page-header всегда передаёт; защищаемся от программных
    // ошибок).
    const resolvedType = type || listVcsProviders()[0]?.type
    setDrafts((prev) => ({
      ...prev,
      [tempId]: {
        id: tempId,
        type: resolvedType,
        name: '',
        workspace: '',
        username: '',
        gitUsername: '',
        providerOptions: {},
        hasToken: false,
        unsaved: true
      }
    }))
  }, [])

  // Imperative API for the parent: page-header «+ Add Bitbucket / GitHub»
  // buttons reach into this section via ref.
  useImperativeHandle(ref, () => ({ startAdd }), [startAdd])

  const cancelDraft = (tempId) => {
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[tempId]
      return next
    })
    setTokens((prev) => {
      const next = { ...prev }
      delete next[tempId]
      return next
    })
  }

  const applyExisting = async (id) => {
    const draft = drafts[id]
    if (!draft) return
    setBusy((prev) => ({ ...prev, [id]: true }))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    let didFail = false
    try {
      // Гарантируем минимум 400мс loader'а — без этого локальный IPC
      // отрабатывает за 30мс и кнопка моргает; пользователь не успевает
      // понять что что-то произошло.
      const work = (async () => {
        // Провайдеры с одним логином (GitHub: gitUsernameMirrorsUsername=true)
        // биндят "username"-поле в draft.username, но backend читает
        // gitUsername при clone(). Зеркалим — как делает saveNew(). Без
        // этого Apply сохранял пустой gitUsername и git clone падал с
        // "Git username not configured for source ...".
        const provider = getVcsProvider(draft.type)
        const gitUsernameToSave = provider?.form.gitUsernameMirrorsUsername
          ? draft.username || ''
          : draft.gitUsername
        await api.sources.update(id, {
          name: draft.name,
          workspace: draft.workspace,
          username: draft.username,
          gitUsername: gitUsernameToSave,
          providerOptions: draft.providerOptions || {}
        })
        const newToken = tokens[id]
        if (newToken && newToken.trim()) {
          await api.sources.setSecret(id, newToken)
        }
      })()
      await Promise.all([
        work,
        new Promise((resolve) => setTimeout(resolve, 400))
      ])
      await reload()
    } catch (e) {
      didFail = true
      setErrors((prev) => ({
        ...prev,
        [id]: e?.message || String(e)
      }))
    } finally {
      setBusy((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
    if (!didFail) markSaved(id)
  }

  const saveNew = async (tempId) => {
    const draft = drafts[tempId]
    if (!draft) return
    setBusy((prev) => ({ ...prev, [tempId]: true }))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[tempId]
      return next
    })
    try {
      // Провайдеры с одним логином (gitUsernameMirrorsUsername=true:
      // GitHub, GitLab) держат username и gitUsername в одном UI-поле
      // (биндится в draft.username). Зеркалим в gitUsername здесь — на
      // месте API-вызова. Раньше mirror висел в onClick кнопки Save через
      // onUpdate(), но это async setState; saveNew затем синхронно
      // читал старый draft.gitUsername=''. Из-за этого свежесозданный
      // GitHub/GitLab source сохранялся с пустым gitUsername, и git clone
      // потом ругался "Git username not configured".
      const provider = getVcsProvider(draft.type)
      const gitUsernameToSave = provider?.form.gitUsernameMirrorsUsername
        ? draft.username || ''
        : draft.gitUsername
      await api.sources.add({
        type: draft.type,
        name: draft.name || draft.workspace,
        workspace: draft.workspace,
        username: draft.username,
        gitUsername: gitUsernameToSave,
        providerOptions: draft.providerOptions || {},
        token: tokens[tempId] || undefined
      })
      await reload()
    } catch (e) {
      setErrors((prev) => ({
        ...prev,
        [tempId]: e?.message || String(e)
      }))
      setBusy((prev) => {
        const next = { ...prev }
        delete next[tempId]
        return next
      })
    }
  }

  // Кнопка Remove на карточке только открывает confirm-диалог.
  // Реальное удаление — в confirmRemove ниже.
  const remove = (id) => setPendingRemoveId(id)

  const confirmRemove = async () => {
    const id = pendingRemoveId
    if (!id) return
    setPendingRemoveId(null)
    setBusy((prev) => ({ ...prev, [id]: true }))
    try {
      await api.sources.remove(id)
      await reload()
    } catch (e) {
      setErrors((prev) => ({
        ...prev,
        [id]: e?.message || String(e)
      }))
      setBusy((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  const test = async (id) => {
    setBusy((prev) => ({ ...prev, [`test:${id}`]: true }))
    try {
      const result = await api.sources.test(id)
      setTestResults((prev) => ({ ...prev, [id]: result }))
    } catch (e) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: false, stage: 'error', message: e?.message || String(e) }
      }))
    } finally {
      setBusy((prev) => {
        const next = { ...prev }
        delete next[`test:${id}`]
        return next
      })
    }
  }

  const clearToken = async (id) => {
    setBusy((prev) => ({ ...prev, [id]: true }))
    try {
      await api.sources.clearSecret(id)
      await reload()
    } finally {
      setBusy((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  const draftIds = Object.keys(drafts)

  return (
    <div className="space-y-4">
      <SectionPageHeader
        title={t('settings.sources.title')}
        description={t('settings.sources.description')}
      />

      {loading && (
        <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" />
          {t('common.loading')}
        </div>
      )}
      {!loading && draftIds.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t('settings.sources.empty')}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {draftIds.map((id) => (
          <SourceCard
            key={id}
            draft={drafts[id]}
            token={tokens[id] || ''}
            isBusy={!!busy[id]}
            isTesting={!!busy[`test:${id}`]}
            error={errors[id]}
            testResult={testResults[id]}
            savedAt={savedStamps[id] || null}
            onUpdate={(field, value) => updateDraft(id, field, value)}
            onSetToken={(v) => setToken(id, v)}
            onApply={() => applyExisting(id)}
            onSave={() => saveNew(id)}
            onTest={() => test(id)}
            onRemove={() => remove(id)}
            onCancel={() => cancelDraft(id)}
            onClearToken={() => clearToken(id)}
            onOpenGuide={onOpenGuide}
          />
        ))}
      </div>

      <AlertDialog
        open={pendingRemoveId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoveId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settings.sources.confirmRemove.title', {
                name:
                  drafts[pendingRemoveId]?.name ||
                  drafts[pendingRemoveId]?.workspace ||
                  ''
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.sources.confirmRemove')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('settings.sources.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
})

/**
 * Одна карточка источника. Header содержит title + per-card actions
 * (зона действий справа), body — форму с полями.
 *
 * Saved источник: [Test] [Apply] [Remove]
 * Draft (unsaved): [Save] [Cancel]
 */
function SourceCard({
  draft,
  token,
  isBusy,
  isTesting,
  error,
  testResult,
  savedAt,
  onUpdate,
  onSetToken,
  onApply,
  onSave,
  onTest,
  onRemove,
  onCancel,
  onClearToken,
  onOpenGuide
}) {
  const t = useT()
  const isNew = !!draft.unsaved
  const provider = getVcsProvider(draft.type)
  // Fallback на bitbucket-форму чтобы карточка не падала, если в конфиге
  // оказался unknown type (например downgrade с новой версии). Это
  // лучше, чем render-краш — пользователь видит карточку и может удалить.
  const form = (provider || VCS_PROVIDERS.bitbucket).form
  const typeLabel = (provider || VCS_PROVIDERS.bitbucket).label

  const titleText = isNew
    ? t(
        (provider || VCS_PROVIDERS.bitbucket).newSourceTitleKey
      )
    : draft.name || draft.workspace || typeLabel
  const subtitleText = isNew
    ? null
    : `${typeLabel}${draft.workspace ? ' · ' + draft.workspace : ''}`

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <CardTitle className="truncate">{titleText}</CardTitle>
            {subtitleText && (
              <CardDescription>{subtitleText}</CardDescription>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onOpenGuide && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenGuide(draft.type)}
                title={t('settings.openSetupGuide')}
              >
                <BookOpen size={13} />
              </Button>
            )}
            {isNew ? (
              <>
                <Button
                  size="sm"
                  onClick={onSave}
                  disabled={isBusy || !draft.workspace}
                >
                  {isBusy && <Loader2 className="animate-spin" />}
                  {t('settings.sources.add.save')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCancel}
                  disabled={isBusy}
                >
                  {t('common.cancel')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onTest}
                  disabled={isTesting}
                >
                  {isTesting && <Loader2 className="animate-spin" />}
                  {t('common.testConnection')}
                </Button>
                <Button
                  size="sm"
                  onClick={onApply}
                  disabled={isBusy}
                  className={cn(
                    !!savedAt &&
                      'bg-emerald-600 text-white hover:bg-emerald-600 focus-visible:ring-emerald-500'
                  )}
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="animate-spin" />
                      {t('common.saving')}
                    </>
                  ) : savedAt ? (
                    <>
                      <Check />
                      {t('common.saved')}
                    </>
                  ) : (
                    t('settings.sources.apply')
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRemove}
                  disabled={isBusy}
                  title={t('settings.sources.remove')}
                >
                  <Trash2 size={12} />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field
          label={t('settings.sources.name')}
          hint={t('settings.sources.name.hint')}
        >
          <Input
            value={draft.name}
            onChange={(e) => onUpdate('name', e.target.value)}
            placeholder={form.namePlaceholder}
          />
        </Field>

        {form.showEmailField && (
          <Field
            label={t(form.emailLabelKey)}
            hint={t(form.emailHintKey)}
          >
            <Input
              type="email"
              value={draft.username}
              onChange={(e) => onUpdate('username', e.target.value)}
              placeholder={form.emailPlaceholder}
            />
          </Field>
        )}
        <Field
          label={t(form.workspaceLabelKey)}
          hint={t(form.workspaceHintKey)}
        >
          <Input
            value={draft.workspace}
            onChange={(e) => onUpdate('workspace', e.target.value)}
            placeholder={form.workspacePlaceholder}
          />
        </Field>
        <Field
          label={t(form.gitUsernameLabelKey)}
          hint={t(form.gitUsernameHintKey)}
        >
          <Input
            value={
              form.gitUsernameMirrorsUsername
                ? draft.username
                : draft.gitUsername
            }
            onChange={(e) =>
              onUpdate(
                form.gitUsernameMirrorsUsername ? 'username' : 'gitUsername',
                e.target.value
              )
            }
            placeholder={form.gitUsernamePlaceholder}
          />
        </Field>
        <SecretField
          label={t(form.tokenLabelKey)}
          hint={t(form.tokenHintKey)}
          status={!isNew && draft.hasToken}
          value={token}
          onChange={onSetToken}
          onClear={
            !isNew && draft.hasToken ? onClearToken : undefined
          }
        />

        {/* providerOptions-поля провайдера (например GitLab baseUrl
            для self-hosted). Generic-механизм: каждый провайдер сам
            декларирует список своих опций в lib/vcs-providers.jsx,
            здесь просто рендерим. Сохранение идёт через
            applyExisting() / saveNew() которые читают draft.providerOptions. */}
        {(provider?.providerOptionsFields || []).map((opt) => (
          <Field
            key={opt.key}
            label={t(opt.labelKey)}
            hint={t(opt.hintKey)}
          >
            <Input
              value={draft.providerOptions?.[opt.key] ?? ''}
              onChange={(e) =>
                onUpdate('providerOptions', {
                  ...(draft.providerOptions || {}),
                  [opt.key]: e.target.value
                })
              }
              placeholder={opt.placeholder}
            />
          </Field>
        ))}

        {error && (
          <div className="text-xs text-destructive flex items-start gap-2">
            <XCircle size={12} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!isNew && <SourceTestResult result={testResult} />}
      </CardContent>
    </Card>
  )
}

/**
 * Управление DB-подключениями: симметрично SourcesSection. Грид
 * 1/2 колонки, отдельная Card на каждое подключение, кнопки Add
 * рендерятся в шапке страницы рядом с Save через ref.
 */
const DatabasesSection = forwardRef(function DatabasesSection(
  { onOpenGuide, detected },
  ref
) {
  const t = useT()
  const [databases, setDatabases] = useState([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState({})
  const [passwords, setPasswords] = useState({})
  const [busy, setBusy] = useState({})
  const [testResults, setTestResults] = useState({})
  const [errors, setErrors] = useState({})
  const [savedStamps, setSavedStamps] = useState({})
  const [pendingRemoveId, setPendingRemoveId] = useState(null)

  const markSaved = useCallback((id) => {
    setSavedStamps((prev) => ({ ...prev, [id]: Date.now() }))
    setTimeout(() => {
      setSavedStamps((prev) => {
        if (!prev[id]) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
    }, 2500)
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const list = await api.databases.list()
      setDatabases(list)
      const initialDrafts = {}
      for (const d of list) initialDrafts[d.id] = { ...d }
      setDrafts(initialDrafts)
      setPasswords({})
      setErrors({})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const updateDraft = (id, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value }
    }))
    setTestResults((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    setSavedStamps((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const setPassword = (id, value) => {
    setPasswords((prev) => ({ ...prev, [id]: value }))
  }

  const startAdd = useCallback((type) => {
    const tempId = `__new_${Date.now()}`
    const engine = getDbEngine(type) || DB_ENGINES.mysql
    setDrafts((prev) => ({
      ...prev,
      [tempId]: {
        id: tempId,
        type: engine.type,
        name: '',
        host: 'localhost',
        port: engine.defaultPort,
        user: engine.defaultUser,
        executable: '',
        hasPassword: false,
        unsaved: true
      }
    }))
  }, [])

  // Imperative API for the parent: page-header «+ Add MySQL / Postgres»
  // buttons reach into this section via ref.
  useImperativeHandle(ref, () => ({ startAdd }), [startAdd])

  const cancelDraft = (tempId) => {
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[tempId]
      return next
    })
    setPasswords((prev) => {
      const next = { ...prev }
      delete next[tempId]
      return next
    })
  }

  const applyExisting = async (id) => {
    const draft = drafts[id]
    if (!draft) return
    setBusy((prev) => ({ ...prev, [id]: true }))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    let didFail = false
    try {
      const work = (async () => {
        await api.databases.update(id, {
          name: draft.name,
          host: draft.host,
          port: draft.port,
          user: draft.user,
          executable: draft.executable
        })
        const newPwd = passwords[id]
        if (newPwd && newPwd.trim()) {
          await api.databases.setSecret(id, newPwd)
        }
      })()
      await Promise.all([
        work,
        new Promise((resolve) => setTimeout(resolve, 400))
      ])
      await reload()
    } catch (e) {
      didFail = true
      setErrors((prev) => ({
        ...prev,
        [id]: e?.message || String(e)
      }))
    } finally {
      setBusy((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
    if (!didFail) markSaved(id)
  }

  const saveNew = async (tempId) => {
    const draft = drafts[tempId]
    if (!draft) return
    setBusy((prev) => ({ ...prev, [tempId]: true }))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[tempId]
      return next
    })
    try {
      await api.databases.add({
        type: draft.type,
        name: draft.name,
        host: draft.host,
        port: draft.port,
        user: draft.user,
        executable: draft.executable,
        password: passwords[tempId] || undefined
      })
      await reload()
    } catch (e) {
      setErrors((prev) => ({
        ...prev,
        [tempId]: e?.message || String(e)
      }))
      setBusy((prev) => {
        const next = { ...prev }
        delete next[tempId]
        return next
      })
    }
  }

  const remove = (id) => setPendingRemoveId(id)

  const confirmRemove = async () => {
    const id = pendingRemoveId
    if (!id) return
    setPendingRemoveId(null)
    setBusy((prev) => ({ ...prev, [id]: true }))
    try {
      await api.databases.remove(id)
      await reload()
    } catch (e) {
      setErrors((prev) => ({
        ...prev,
        [id]: e?.message || String(e)
      }))
      setBusy((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  const test = async (id) => {
    setBusy((prev) => ({ ...prev, [`test:${id}`]: true }))
    try {
      const result = await api.databases.test(id)
      setTestResults((prev) => ({ ...prev, [id]: result }))
    } catch (e) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: false, message: e?.message || String(e) }
      }))
    } finally {
      setBusy((prev) => {
        const next = { ...prev }
        delete next[`test:${id}`]
        return next
      })
    }
  }

  const clearPwd = async (id) => {
    setBusy((prev) => ({ ...prev, [id]: true }))
    try {
      await api.databases.clearSecret(id)
      await reload()
    } finally {
      setBusy((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  const ids = Object.keys(drafts)

  return (
    <div className="space-y-4">
      <SectionPageHeader
        title={t('settings.databases.title')}
        description={t('settings.databases.description')}
      />

      {loading && (
        <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" />
          {t('common.loading')}
        </div>
      )}
      {!loading && ids.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t('settings.databases.empty')}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {ids.map((id) => (
          <DatabaseCard
            key={id}
            draft={drafts[id]}
            password={passwords[id] || ''}
            isBusy={!!busy[id]}
            isTesting={!!busy[`test:${id}`]}
            error={errors[id]}
            testResult={testResults[id]}
            savedAt={savedStamps[id] || null}
            detected={detected}
            onUpdate={(field, value) => updateDraft(id, field, value)}
            onSetPassword={(v) => setPassword(id, v)}
            onApply={() => applyExisting(id)}
            onSave={() => saveNew(id)}
            onTest={() => test(id)}
            onRemove={() => remove(id)}
            onCancel={() => cancelDraft(id)}
            onClearPassword={() => clearPwd(id)}
            onOpenGuide={onOpenGuide}
          />
        ))}
      </div>

      <AlertDialog
        open={pendingRemoveId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoveId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settings.databases.confirmRemove.title', {
                name:
                  drafts[pendingRemoveId]?.name ||
                  drafts[pendingRemoveId]?.host ||
                  ''
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.databases.confirmRemove')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('settings.databases.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
})

/**
 * Одна карточка DB-подключения. Header — title + per-card actions
 * справа, body — host/port/user/password/executable. Симметрично
 * SourceCard.
 */
function DatabaseCard({
  draft,
  password,
  isBusy,
  isTesting,
  error,
  testResult,
  savedAt,
  detected,
  onUpdate,
  onSetPassword,
  onApply,
  onSave,
  onTest,
  onRemove,
  onCancel,
  onClearPassword,
  onOpenGuide
}) {
  const t = useT()
  const isNew = !!draft.unsaved
  // Fallback на mysql-форму если в конфиге unknown type (downgrade-сценарий).
  const engine = getDbEngine(draft.type) || DB_ENGINES.mysql
  const form = engine.form
  const typeLabel = engine.label

  // detected — карта по type'у движка из родителя ({ mysql, postgres, ... }).
  // Для bin-директории Postgres лежит в C:\Program Files\PostgreSQL\<v>\bin\,
  // detect возвращает абсолютный путь к psql.exe — kept as-is. У нас
  // engine.resolveCli умеет принимать как path/psql.exe, так и
  // path/pg_restore.exe — он сам разрулит соседний бинарь.
  const detectedForType = detected?.[draft.type] ?? null

  const titleText = isNew
    ? t(engine.newDatabaseTitleKey)
    : draft.name || `${draft.user || typeLabel}@${draft.host || ''}`
  const subtitleText = isNew
    ? null
    : `${typeLabel}${draft.host ? ' · ' + draft.host : ''}`

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <CardTitle className="truncate">{titleText}</CardTitle>
            {subtitleText && (
              <CardDescription>{subtitleText}</CardDescription>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onOpenGuide && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenGuide(draft.type)}
                title={t('settings.openSetupGuide')}
              >
                <BookOpen size={13} />
              </Button>
            )}
            {isNew ? (
              <>
                <Button
                  size="sm"
                  onClick={onSave}
                  disabled={isBusy || !draft.host || !draft.user}
                >
                  {isBusy && <Loader2 className="animate-spin" />}
                  {t('settings.databases.add.save')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onCancel}
                  disabled={isBusy}
                >
                  {t('common.cancel')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onTest}
                  disabled={isTesting}
                >
                  {isTesting && <Loader2 className="animate-spin" />}
                  {t('common.testConnection')}
                </Button>
                <Button
                  size="sm"
                  onClick={onApply}
                  disabled={isBusy}
                  className={cn(
                    !!savedAt &&
                      'bg-emerald-600 text-white hover:bg-emerald-600 focus-visible:ring-emerald-500'
                  )}
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="animate-spin" />
                      {t('common.saving')}
                    </>
                  ) : savedAt ? (
                    <>
                      <Check />
                      {t('common.saved')}
                    </>
                  ) : (
                    t('settings.sources.apply')
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRemove}
                  disabled={isBusy}
                  title={t('settings.databases.remove')}
                >
                  <Trash2 size={12} />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field
          label={t('settings.databases.name')}
          hint={t('settings.databases.name.hint')}
        >
          <Input
            value={draft.name}
            onChange={(e) => onUpdate('name', e.target.value)}
            placeholder={`${form.userPlaceholder}@localhost`}
          />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field
            label={t('settings.database.host')}
            className="col-span-2"
          >
            <Input
              value={draft.host}
              onChange={(e) => onUpdate('host', e.target.value)}
              placeholder={form.hostPlaceholder}
            />
          </Field>
          <Field label={t('settings.database.port')}>
            <Input
              type="number"
              value={draft.port}
              onChange={(e) =>
                onUpdate('port', Number(e.target.value) || 0)
              }
              placeholder={form.portPlaceholder}
            />
          </Field>
        </div>
        <Field label={t('settings.database.user')}>
          <Input
            value={draft.user}
            onChange={(e) => onUpdate('user', e.target.value)}
            placeholder={form.userPlaceholder}
          />
        </Field>
        <SecretField
          label={t('settings.database.password')}
          status={!isNew && draft.hasPassword}
          value={password}
          onChange={onSetPassword}
          onClear={
            !isNew && draft.hasPassword ? onClearPassword : undefined
          }
        />
        <BinaryPathField
          label={t(form.executableLabelKey)}
          value={draft.executable}
          detected={detectedForType}
          placeholder={form.executablePathPlaceholder}
          notFoundHint={
            draft.executable
              ? t(form.executableNotFoundKey)
              : t(form.executableOptionalKey)
          }
          onChange={(v) => onUpdate('executable', v)}
        />

        {error && (
          <div className="text-xs text-destructive flex items-start gap-2">
            <XCircle size={12} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!isNew && <DbTestResult result={testResult} />}
      </CardContent>
    </Card>
  )
}

function SourceTestResult({ result }) {
  if (!result) return null
  if (result.ok) {
    const sameWsName = result.workspace.name === result.workspace.slug
    return (
      <div className="flex items-start gap-2 text-xs text-emerald-500">
        <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
        <div>
          <div>
            Authenticated as <strong>{result.user.displayName}</strong>
          </div>
          <div className="text-muted-foreground mt-0.5">
            Workspace <strong>{result.workspace.slug}</strong>
            {!sameWsName && <> (<span>{result.workspace.name}</span>)</>}
            {' '}— repositories readable.
          </div>
        </div>
      </div>
    )
  }
  const stageColor =
    result.stage === 'config' ? 'text-amber-500' : 'text-destructive'
  return (
    <div className={`flex items-start gap-2 text-xs ${stageColor}`}>
      <XCircle size={14} className="mt-0.5 shrink-0" />
      <div>
        <div>{result.message}</div>
        {result.detail && (
          <div className="text-muted-foreground mt-0.5">{result.detail}</div>
        )}
      </div>
    </div>
  )
}

function DbTestResult({ result }) {
  if (!result) return null
  if (result.ok) {
    return (
      <div className="flex items-start gap-2 text-xs text-emerald-500">
        <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
        <div>
          Connected — <span className="font-mono">{result.version}</span>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2 text-xs text-destructive">
      <XCircle size={14} className="mt-0.5 shrink-0" />
      <div>
        <div>{result.message}</div>
        {result.code && (
          <div className="text-muted-foreground mt-0.5">code: {result.code}</div>
        )}
      </div>
    </div>
  )
}

function JiraTestResult({ result }) {
  if (!result) return null
  if (result.ok) {
    return (
      <div className="flex items-start gap-2 text-xs text-emerald-500">
        <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
        <div>
          <div>
            Authenticated as{' '}
            <strong>{result.user.displayName}</strong>
          </div>
          <div className="text-muted-foreground mt-0.5">
            Host: <span className="font-mono">{result.host}</span>{' '}
            — projects readable.
          </div>
        </div>
      </div>
    )
  }
  const stageColor =
    result.stage === 'config' || result.stage === 'host'
      ? 'text-amber-500'
      : 'text-destructive'
  return (
    <div className={`flex items-start gap-2 text-xs ${stageColor}`}>
      <XCircle size={14} className="mt-0.5 shrink-0" />
      <div>
        <div>{result.message}</div>
        {result.detail && (
          <div className="text-muted-foreground mt-0.5">
            {result.detail}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Поле с путём к бинарю + кнопка «Use detected» когда runtime-резолв
 * находит абсолютный путь, а в поле сейчас другое (например дефолтное
 * имя 'code'). В packaged-сборке наша внутренняя whichBinary иногда
 * возвращает другой путь, чем встроенный спавн умеет открыть, —
 * абсолютный путь надёжнее, и эта кнопка позволяет зафиксировать
 * его одним кликом.
 */
function BinaryPathField({
  label,
  value,
  detected,
  placeholder,
  notFoundHint,
  onChange
}) {
  const t = useT()
  // Кнопка показывается всегда когда есть detected — даже если поле
  // уже равно detected. Это позволяет «вернуть к авто» одним кликом
  // в любой момент, не ломая голову над тем, что в поле сейчас.
  const canUseDetected = !!detected
  const hint = detected
    ? t('settings.detected', { path: detected })
    : notFoundHint
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        {canUseDetected && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onChange(detected)}
            title={`Set to ${detected}`}
          >
            {t('settings.useDetected')}
          </Button>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Field({ label, hint, className, children }) {
  return (
    <div className={'space-y-2 ' + (className || '')}>
      <Label>{label}</Label>
      {children}
      {hint && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

function SecretField({ label, hint, status, value, onChange, onClear }) {
  const t = useT()
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={
            status ? '•••••• stored — leave blank to keep' : ''
          }
        />
        {status && (
          <Button variant="outline" size="sm" onClick={onClear}>
            {t('common.clear')}
          </Button>
        )}
      </div>
      {status && !value ? (
        <p className="text-xs text-muted-foreground">
          {t('settings.encryptedAlreadySaved')}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

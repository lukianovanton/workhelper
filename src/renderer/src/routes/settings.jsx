import { useEffect, useState, useCallback } from 'react'
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
  Trash2
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
import { BitbucketSetupGuide } from '@/components/setup-guides/bitbucket'
import { JiraSetupGuide } from '@/components/setup-guides/jira'
import { PathsSetupGuide } from '@/components/setup-guides/paths'
import { DatabaseSetupGuide } from '@/components/setup-guides/database'
import { DotnetSetupGuide } from '@/components/setup-guides/dotnet'
import { PresenceSetupGuide } from '@/components/setup-guides/presence'
import { AppearanceSetupGuide } from '@/components/setup-guides/appearance'
import { useT, SUPPORTED_LANGUAGES } from '@/i18n'
import { api } from '@/api'

// Реестр всех setup-гайдов: вместо отдельного Dialog на секцию у
// нас один централизованный, переключающий контент по id. Так
// проще добавить ещё гайдов и не размножать boilerplate. Заголовки
// и описания берутся из i18n внутри Dialog'а; здесь только фиксы
// по компоненту и translation-ключам.
const SETUP_GUIDES = {
  bitbucket: {
    titleKey: 'settings.bitbucket.title',
    descriptionKey: 'settings.guide.bitbucket.dialogDescription',
    Component: BitbucketSetupGuide
  },
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
  database: {
    titleKey: 'settings.database.title',
    descriptionKey: 'settings.guide.database.dialogDescription',
    Component: DatabaseSetupGuide
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

// Persistent: при возврате в Settings показывается тот же раздел,
// который был открыт. localStorage, не часть config.json.
const SECTION_STORAGE_KEY = 'settings-active-section'

const SECTIONS = /** @type {const} */ ([
  { id: 'atlassian', labelKey: 'settings.section.atlassian', icon: Cloud },
  { id: 'paths', labelKey: 'settings.section.paths', icon: Folder },
  { id: 'database', labelKey: 'settings.section.database', icon: Database },
  { id: 'defaults', labelKey: 'settings.section.defaults', icon: Code2 },
  { id: 'presence', labelKey: 'settings.section.presence', icon: Users },
  { id: 'appearance', labelKey: 'settings.section.appearance', icon: Palette }
])

// Legacy id маппинги: пользователи с сохранённой активной секцией от
// до-A.6 версии увидят соответствующую новую секцию вместо «404».
const LEGACY_SECTION_MAP = {
  bitbucket: 'atlassian',
  jira: 'atlassian',
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
  return 'atlassian'
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
  const [mysqlDetected, setMysqlDetected] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState(null)
  const [testingJira, setTestingJira] = useState(false)
  const [jiraTestResult, setJiraTestResult] = useState(null)
  const [activeSection, setActiveSection] = useState(loadActiveSection)
  // Открыт ли setup-guide modal. Один state на все секции (одновременно
  // открыт максимум один guide), значение — id секции / null.
  const [guideOpen, setGuideOpen] = useState(null)
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
    api.config.whichBinary('mysql').then(setMysqlDetected)
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
          <Button onClick={onSave} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {t('common.save')}
          </Button>
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
              activeSection === 'atlassian'
                ? 'max-w-6xl'
                : 'max-w-2xl'
            )}
          >
            {activeSection === 'atlassian' && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                <SourcesCard
                  onOpenGuide={() => setGuideOpen('bitbucket')}
                />

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
              </div>
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
              <DatabasesCard
                onOpenGuide={() => setGuideOpen('database')}
                detected={mysqlDetected}
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
          {guideOpen && SETUP_GUIDES[guideOpen] && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t(SETUP_GUIDES[guideOpen].titleKey)}
                </DialogTitle>
                <DialogDescription>
                  {t(SETUP_GUIDES[guideOpen].descriptionKey)}
                </DialogDescription>
              </DialogHeader>
              {(() => {
                const G = SETUP_GUIDES[guideOpen].Component
                return <G />
              })()}
            </>
          )}
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
 * Управление VCS-источниками. Заменяет старую Bitbucket-карточку: одна
 * карточка-секция с заголовком "Sources", внутри — список добавленных
 * источников (каждый — свой блок с inline-формой), и кнопка
 * "+ Add Source" в конце.
 *
 * UX:
 *   - Source-блок имеет [Apply] для существующих (PATCH через
 *     api.sources.update + setSecret если введён токен) и [Save] для
 *     несохранённых (POST через api.sources.add).
 *   - [Test] и [Remove] видны только у сохранённых.
 *   - У несохранённых [Cancel] стирает черновик из локального state.
 *   - Тип нового источника пока всегда 'bitbucket'. GitHub попадёт в
 *     Phase B: пикер типа сейчас не нужен, добавим когда будет два
 *     варианта.
 */
function SourcesCard({ onOpenGuide }) {
  const t = useT()
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState({})
  const [tokens, setTokens] = useState({})
  const [busy, setBusy] = useState({})
  const [testResults, setTestResults] = useState({})
  const [errors, setErrors] = useState({})

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
  }

  const setToken = (id, value) => {
    setTokens((prev) => ({ ...prev, [id]: value }))
  }

  const startAdd = (type) => {
    const tempId = `__new_${Date.now()}`
    setDrafts((prev) => ({
      ...prev,
      [tempId]: {
        id: tempId,
        type: type || 'bitbucket',
        name: '',
        workspace: '',
        username: '',
        gitUsername: '',
        hasToken: false,
        unsaved: true
      }
    }))
  }

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
    try {
      await api.sources.update(id, {
        name: draft.name,
        workspace: draft.workspace,
        username: draft.username,
        gitUsername: draft.gitUsername
      })
      const newToken = tokens[id]
      if (newToken && newToken.trim()) {
        await api.sources.setSecret(id, newToken)
      }
      await reload()
    } catch (e) {
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
      await api.sources.add({
        type: draft.type,
        name: draft.name || draft.workspace,
        workspace: draft.workspace,
        username: draft.username,
        gitUsername: draft.gitUsername,
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

  const remove = async (id) => {
    if (!window.confirm(t('settings.sources.confirmRemove'))) return
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
    <Card>
      <SectionCardHeader
        title={t('settings.sources.title')}
        description={t('settings.sources.description')}
        onOpenGuide={onOpenGuide}
      />
      <CardContent className="space-y-4">
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
        {draftIds.map((id) => {
          const draft = drafts[id]
          const isNew = !!draft.unsaved
          const isBusy = !!busy[id]
          const isTesting = !!busy[`test:${id}`]
          const isGithub = draft.type === 'github'
          // Лейблы в зависимости от типа: BB использует «Email» +
          // «Workspace», GitHub — только «Owner» (PAT-аутентификация
          // без email). gitUsername полезен в обоих случаях для
          // подсказки credential-helper'у системного git.
          const workspaceLabelKey = isGithub
            ? 'settings.github.owner'
            : 'settings.bitbucket.workspace'
          const workspaceHintKey = isGithub
            ? 'settings.github.owner.hint'
            : 'settings.bitbucket.workspace.hint'
          const workspacePlaceholder = isGithub ? 'octocat' : 'techgurusit'
          const gitUsernameLabelKey = isGithub
            ? 'settings.github.gitUsername'
            : 'settings.bitbucket.gitUsername'
          const gitUsernameHintKey = isGithub
            ? 'settings.github.gitUsername.hint'
            : 'settings.bitbucket.gitUsername.hint'
          const tokenLabelKey = isGithub
            ? 'settings.github.token'
            : 'settings.bitbucket.token'
          const tokenHintKey = isGithub
            ? 'settings.github.token.hint'
            : 'settings.bitbucket.token.hint'
          return (
            <div
              key={id}
              className="rounded-md border border-border/70 p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {isNew
                    ? t(
                        isGithub
                          ? 'settings.sources.newSource.github'
                          : 'settings.sources.newSource.bitbucket'
                      )
                    : draft.type}
                </div>
                {!isNew && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(id)}
                    disabled={isBusy}
                    title={t('settings.sources.remove')}
                  >
                    <Trash2 size={12} />
                  </Button>
                )}
              </div>

              <Field
                label={t('settings.sources.name')}
                hint={t('settings.sources.name.hint')}
              >
                <Input
                  value={draft.name}
                  onChange={(e) => updateDraft(id, 'name', e.target.value)}
                  placeholder={isGithub ? 'GitHub' : 'techgurusit'}
                />
              </Field>

              {!isGithub && (
                <Field
                  label={t('settings.bitbucket.email')}
                  hint={t('settings.bitbucket.email.hint')}
                >
                  <Input
                    type="email"
                    value={draft.username}
                    onChange={(e) =>
                      updateDraft(id, 'username', e.target.value)
                    }
                    placeholder="you@example.com"
                  />
                </Field>
              )}
              <Field
                label={t(workspaceLabelKey)}
                hint={t(workspaceHintKey)}
              >
                <Input
                  value={draft.workspace}
                  onChange={(e) =>
                    updateDraft(id, 'workspace', e.target.value)
                  }
                  placeholder={workspacePlaceholder}
                />
              </Field>
              <Field
                label={t(gitUsernameLabelKey)}
                hint={t(gitUsernameHintKey)}
              >
                <Input
                  value={isGithub ? draft.username : draft.gitUsername}
                  onChange={(e) =>
                    updateDraft(
                      id,
                      isGithub ? 'username' : 'gitUsername',
                      e.target.value
                    )
                  }
                  placeholder={isGithub ? 'octocat' : 'antonreact1'}
                />
              </Field>
              <SecretField
                label={t(tokenLabelKey)}
                hint={t(tokenHintKey)}
                status={!isNew && draft.hasToken}
                value={tokens[id] || ''}
                onChange={(v) => setToken(id, v)}
                onClear={!isNew && draft.hasToken ? () => clearToken(id) : undefined}
              />

              {errors[id] && (
                <div className="text-xs text-destructive flex items-start gap-2">
                  <XCircle size={12} className="mt-0.5 shrink-0" />
                  <span>{errors[id]}</span>
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap pt-1">
                {isNew ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() => {
                        // Для GitHub username = git-username (один логин).
                        if (isGithub) {
                          updateDraft(id, 'gitUsername', draft.username || '')
                        }
                        saveNew(id)
                      }}
                      disabled={isBusy || !draft.workspace}
                    >
                      {isBusy && <Loader2 className="animate-spin" />}
                      {t('settings.sources.add.save')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => cancelDraft(id)}
                      disabled={isBusy}
                    >
                      {t('common.cancel')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => applyExisting(id)}
                      disabled={isBusy}
                    >
                      {isBusy && <Loader2 className="animate-spin" />}
                      {t('settings.sources.apply')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => test(id)}
                      disabled={isTesting}
                    >
                      {isTesting && <Loader2 className="animate-spin" />}
                      {t('common.testConnection')}
                    </Button>
                  </>
                )}
              </div>
              {!isNew && (
                <BitbucketTestResult result={testResults[id]} />
              )}
            </div>
          )
        })}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => startAdd('bitbucket')}
          >
            <Plus />
            {t('settings.sources.add.bitbucket')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => startAdd('github')}
          >
            <Plus />
            {t('settings.sources.add.github')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Управление DB-подключениями. Симметрично SourcesCard. Внутри
 * `DatabaseEditor` — sub-компонент, чтобы вызывать `useState` для
 * detected-binary без нарушения rules-of-hooks (нельзя вызывать
 * hook внутри map'а).
 */
function DatabasesCard({ onOpenGuide, detected }) {
  const t = useT()
  const [databases, setDatabases] = useState([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState({})
  const [passwords, setPasswords] = useState({})
  const [busy, setBusy] = useState({})
  const [testResults, setTestResults] = useState({})
  const [errors, setErrors] = useState({})

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
  }

  const setPassword = (id, value) => {
    setPasswords((prev) => ({ ...prev, [id]: value }))
  }

  const startAdd = () => {
    const tempId = `__new_${Date.now()}`
    setDrafts((prev) => ({
      ...prev,
      [tempId]: {
        id: tempId,
        type: 'mysql',
        name: '',
        host: 'localhost',
        port: 3306,
        user: 'root',
        executable: '',
        hasPassword: false,
        unsaved: true
      }
    }))
  }

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
    try {
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
      await reload()
    } catch (e) {
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

  const remove = async (id) => {
    if (!window.confirm(t('settings.databases.confirmRemove'))) return
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
    <Card>
      <SectionCardHeader
        title={t('settings.databases.title')}
        description={t('settings.databases.description')}
        onOpenGuide={onOpenGuide}
      />
      <CardContent className="space-y-4">
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
        {ids.map((id) => {
          const draft = drafts[id]
          const isNew = !!draft.unsaved
          const isBusy = !!busy[id]
          const isTesting = !!busy[`test:${id}`]
          return (
            <div
              key={id}
              className="rounded-md border border-border/70 p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {isNew
                    ? t('settings.databases.newDatabase')
                    : draft.type}
                </div>
                {!isNew && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(id)}
                    disabled={isBusy}
                    title={t('settings.databases.remove')}
                  >
                    <Trash2 size={12} />
                  </Button>
                )}
              </div>
              <Field
                label={t('settings.databases.name')}
                hint={t('settings.databases.name.hint')}
              >
                <Input
                  value={draft.name}
                  onChange={(e) => updateDraft(id, 'name', e.target.value)}
                  placeholder="root@localhost"
                />
              </Field>
              <div className="grid grid-cols-3 gap-4">
                <Field label={t('settings.database.host')} className="col-span-2">
                  <Input
                    value={draft.host}
                    onChange={(e) =>
                      updateDraft(id, 'host', e.target.value)
                    }
                    placeholder="localhost"
                  />
                </Field>
                <Field label={t('settings.database.port')}>
                  <Input
                    type="number"
                    value={draft.port}
                    onChange={(e) =>
                      updateDraft(
                        id,
                        'port',
                        Number(e.target.value) || 0
                      )
                    }
                    placeholder="3306"
                  />
                </Field>
              </div>
              <Field label={t('settings.database.user')}>
                <Input
                  value={draft.user}
                  onChange={(e) =>
                    updateDraft(id, 'user', e.target.value)
                  }
                  placeholder="root"
                />
              </Field>
              <SecretField
                label={t('settings.database.password')}
                status={!isNew && draft.hasPassword}
                value={passwords[id] || ''}
                onChange={(v) => setPassword(id, v)}
                onClear={
                  !isNew && draft.hasPassword
                    ? () => clearPwd(id)
                    : undefined
                }
              />
              <BinaryPathField
                label={t('settings.database.mysqlExecutable')}
                value={draft.executable}
                detected={detected}
                placeholder="C:\\path\\to\\mysql.exe"
                notFoundHint={
                  draft.executable
                    ? t('settings.database.mysqlExecutable.notFound')
                    : t('settings.database.mysqlExecutable.optional')
                }
                onChange={(v) => updateDraft(id, 'executable', v)}
              />

              {errors[id] && (
                <div className="text-xs text-destructive flex items-start gap-2">
                  <XCircle size={12} className="mt-0.5 shrink-0" />
                  <span>{errors[id]}</span>
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap pt-1">
                {isNew ? (
                  <>
                    <Button
                      size="sm"
                      onClick={() => saveNew(id)}
                      disabled={isBusy || !draft.host || !draft.user}
                    >
                      {isBusy && <Loader2 className="animate-spin" />}
                      {t('settings.databases.add.save')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => cancelDraft(id)}
                      disabled={isBusy}
                    >
                      {t('common.cancel')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => applyExisting(id)}
                      disabled={isBusy}
                    >
                      {isBusy && <Loader2 className="animate-spin" />}
                      {t('settings.sources.apply')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => test(id)}
                      disabled={isTesting}
                    >
                      {isTesting && <Loader2 className="animate-spin" />}
                      {t('common.testConnection')}
                    </Button>
                  </>
                )}
              </div>
              {!isNew && <DbTestResult result={testResults[id]} />}
            </div>
          )
        })}

        <Button variant="outline" size="sm" onClick={startAdd}>
          <Plus />
          {t('settings.databases.add')}
        </Button>
      </CardContent>
    </Card>
  )
}

function BitbucketTestResult({ result }) {
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

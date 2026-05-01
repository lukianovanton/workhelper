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
  BookOpen
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
  dotnet: {
    titleKey: 'settings.dotnet.title',
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
  { id: 'dotnet', labelKey: 'settings.section.dotnet', icon: Code2 },
  { id: 'presence', labelKey: 'settings.section.presence', icon: Users },
  { id: 'appearance', labelKey: 'settings.section.appearance', icon: Palette }
])

// Старые id 'bitbucket' / 'jira' маппим на новый объединённый
// 'atlassian' — пользователи которые держали settings открытыми
// на Bitbucket или Jira увидят то же содержимое, не «404».
const LEGACY_SECTION_MAP = { bitbucket: 'atlassian', jira: 'atlassian' }

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
  const [bitbucketApiToken, setBitbucketApiToken] = useState('')
  const [dbPassword, setDbPassword] = useState('')
  const [jiraApiToken, setJiraApiToken] = useState('')
  const [vscodeDetected, setVscodeDetected] = useState(null)
  const [mysqlDetected, setMysqlDetected] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState(null)
  const [testingBitbucket, setTestingBitbucket] = useState(false)
  const [bitbucketTestResult, setBitbucketTestResult] = useState(null)
  const [testingDb, setTestingDb] = useState(false)
  const [dbTestResult, setDbTestResult] = useState(null)
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
    setBitbucketApiToken('')
    setDbPassword('')
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
    if (section === 'bitbucket') setBitbucketTestResult(null)
    if (section === 'database') setDbTestResult(null)
    if (section === 'jira') setJiraTestResult(null)
  }

  const onTestBitbucket = async () => {
    setTestingBitbucket(true)
    setBitbucketTestResult(null)
    try {
      const result = await api.bitbucket.testConnection()
      setBitbucketTestResult(result)
    } catch (e) {
      setBitbucketTestResult({
        ok: false,
        stage: 'error',
        message: e?.message || String(e)
      })
    } finally {
      setTestingBitbucket(false)
    }
  }

  const onTestDb = async () => {
    setTestingDb(true)
    setDbTestResult(null)
    try {
      const result = await api.db.testConnection()
      setDbTestResult(result)
    } catch (e) {
      setDbTestResult({ ok: false, message: e?.message || String(e) })
    } finally {
      setTestingDb(false)
    }
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
      if (bitbucketApiToken) {
        await api.config.setSecret('bitbucketApiToken', bitbucketApiToken)
      }
      if (dbPassword) {
        await api.config.setSecret('dbPassword', dbPassword)
      }
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
                <Card>
                  <SectionCardHeader
                    title={t('settings.bitbucket.title')}
                    description={t('settings.bitbucket.description')}
                    onOpenGuide={() => setGuideOpen('bitbucket')}
                  />
                  <CardContent className="space-y-4">
                    <Field
                      label={t('settings.bitbucket.email')}
                      hint={t('settings.bitbucket.email.hint')}
                    >
                      <Input
                        type="email"
                        value={config.bitbucket.username}
                        onChange={(e) =>
                          updatePath(
                            'bitbucket',
                            'username'
                          )(e.target.value)
                        }
                        placeholder="you@example.com"
                      />
                    </Field>
                    <Field
                      label={t('settings.bitbucket.workspace')}
                      hint={t('settings.bitbucket.workspace.hint')}
                    >
                      <Input
                        value={config.bitbucket.workspace}
                        onChange={(e) =>
                          updatePath(
                            'bitbucket',
                            'workspace'
                          )(e.target.value)
                        }
                        placeholder="techgurusit"
                      />
                    </Field>
                    <Field
                      label={t('settings.bitbucket.gitUsername')}
                      hint={t('settings.bitbucket.gitUsername.hint')}
                    >
                      <Input
                        value={config.bitbucket.gitUsername}
                        onChange={(e) =>
                          updatePath(
                            'bitbucket',
                            'gitUsername'
                          )(e.target.value)
                        }
                        placeholder="antonreact1"
                      />
                    </Field>
                    <SecretField
                      label={t('settings.bitbucket.token')}
                      hint={t('settings.bitbucket.token.hint')}
                      status={secretsStatus.bitbucketApiToken}
                      value={bitbucketApiToken}
                      onChange={setBitbucketApiToken}
                      onClear={() => {
                        onClearSecret('bitbucketApiToken')
                        setBitbucketTestResult(null)
                      }}
                    />
                    <div className="pt-1 space-y-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={onTestBitbucket}
                        disabled={testingBitbucket}
                      >
                        {testingBitbucket && (
                          <Loader2 className="animate-spin" />
                        )}
                        {t('common.testConnection')}
                      </Button>
                      <BitbucketTestResult result={bitbucketTestResult} />
                    </div>
                  </CardContent>
                </Card>

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
              <Card>
                <SectionCardHeader
                  title={t('settings.database.title')}
                  description={t('settings.database.description')}
                  onOpenGuide={() => setGuideOpen('database')}
                />
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <Field label={t('settings.database.host')} className="col-span-2">
                      <Input
                        value={config.database.host}
                        onChange={(e) =>
                          updatePath('database', 'host')(e.target.value)
                        }
                        placeholder="localhost"
                      />
                    </Field>
                    <Field label={t('settings.database.port')}>
                      <Input
                        type="number"
                        value={config.database.port}
                        onChange={(e) =>
                          updatePath(
                            'database',
                            'port'
                          )(Number(e.target.value) || 0)
                        }
                        placeholder="3306"
                      />
                    </Field>
                  </div>
                  <Field label={t('settings.database.user')}>
                    <Input
                      value={config.database.user}
                      onChange={(e) =>
                        updatePath('database', 'user')(e.target.value)
                      }
                      placeholder="root"
                    />
                  </Field>
                  <SecretField
                    label={t('settings.database.password')}
                    status={secretsStatus.dbPassword}
                    value={dbPassword}
                    onChange={setDbPassword}
                    onClear={() => onClearSecret('dbPassword')}
                  />
                  <BinaryPathField
                    label={t('settings.database.mysqlExecutable')}
                    value={config.database.mysqlExecutable}
                    detected={mysqlDetected}
                    placeholder="C:\\path\\to\\mysql.exe"
                    notFoundHint={
                      config.database.mysqlExecutable
                        ? t('settings.database.mysqlExecutable.notFound')
                        : t('settings.database.mysqlExecutable.optional')
                    }
                    onChange={(v) =>
                      updatePath('database', 'mysqlExecutable')(v)
                    }
                  />
                  <div className="pt-1 space-y-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onTestDb}
                      disabled={testingDb}
                    >
                      {testingDb && <Loader2 className="animate-spin" />}
                      {t('common.testConnection')}
                    </Button>
                    <DbTestResult result={dbTestResult} />
                  </div>
                </CardContent>
              </Card>
            )}

            {activeSection === 'dotnet' && (
              <Card>
                <SectionCardHeader
                  title={t('settings.dotnet.title')}
                  description={t('settings.dotnet.description')}
                  onOpenGuide={() => setGuideOpen('dotnet')}
                />
                <CardContent className="space-y-4">
                  <Field
                    label={t('settings.dotnet.runArgs')}
                    hint={t('settings.dotnet.runArgs.hint')}
                  >
                    <Input
                      value={(config.dotnet.runArgs || []).join(' ')}
                      onChange={(e) =>
                        updatePath(
                          'dotnet',
                          'runArgs'
                        )(
                          e.target.value
                            .split(/\s+/)
                            .map((s) => s.trim())
                            .filter(Boolean)
                        )
                      }
                      placeholder="--no-build --launch-profile Development"
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

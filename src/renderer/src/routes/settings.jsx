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
import { api } from '@/api'

// Реестр всех setup-гайдов: вместо отдельного Dialog на секцию у
// нас один централизованный, переключающий контент по id. Так
// проще добавить ещё гайдов и не размножать boilerplate.
const SETUP_GUIDES = {
  bitbucket: {
    title: 'Bitbucket setup guide',
    description: '4 steps to authenticate against Bitbucket Cloud. ~2 minutes.',
    Component: BitbucketSetupGuide
  },
  jira: {
    title: 'Jira setup guide',
    description: '3 steps; reuses your Atlassian email from the Bitbucket section.',
    Component: JiraSetupGuide
  },
  paths: {
    title: 'Paths setup guide',
    description: 'Where projects clone, where dumps live, how VS Code is launched.',
    Component: PathsSetupGuide
  },
  database: {
    title: 'Database setup guide',
    description: 'Local MySQL connection used for size, restore, drop/create.',
    Component: DatabaseSetupGuide
  },
  dotnet: {
    title: '.NET setup guide',
    description: 'Optional run arguments for dotnet run. Most users leave empty.',
    Component: DotnetSetupGuide
  },
  presence: {
    title: 'Presence setup guide',
    description: 'How to see colleagues running WorkHelper on your network.',
    Component: PresenceSetupGuide
  },
  appearance: {
    title: 'Appearance setup guide',
    description: 'Display preferences for this machine.',
    Component: AppearanceSetupGuide
  }
}

// Persistent: при возврате в Settings показывается тот же раздел,
// который был открыт. localStorage, не часть config.json.
const SECTION_STORAGE_KEY = 'settings-active-section'

const SECTIONS = /** @type {const} */ ([
  { id: 'atlassian', label: 'Atlassian', icon: Cloud },
  { id: 'paths', label: 'Paths', icon: Folder },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'dotnet', label: '.NET', icon: Code2 },
  { id: 'presence', label: 'Presence', icon: Users },
  { id: 'appearance', label: 'Appearance', icon: Palette }
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
            Back
          </Button>
          <h2 className="text-base font-medium">Settings</h2>
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
              <span className="break-words">{saveStatus.message}</span>
              {!saveStatus.ok && (
                <button
                  onClick={() => setSaveStatus(null)}
                  className="ml-1 shrink-0 opacity-60 hover:opacity-100"
                  title="Dismiss"
                >
                  <X size={11} />
                </button>
              )}
            </span>
          )}
          <Button onClick={onSave} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Save
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
                  <span>{s.label}</span>
                </button>
              )
            })}
          </nav>
          <div className="p-3 border-t border-border text-[11px] text-muted-foreground space-y-1 leading-snug">
            <p>
              Config in{' '}
              <code className="text-[10px]">%APPDATA%\\project-hub\\config.json</code>
            </p>
            <p>
              Secrets encrypted via safeStorage in{' '}
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
                    title="Bitbucket"
                    description="Email, workspace, username and API token for the Cloud REST API."
                    onOpenGuide={() => setGuideOpen('bitbucket')}
                  />
                  <CardContent className="space-y-4">
                    <Field
                      label="Email"
                      hint="Atlassian account email — same for Bitbucket and Jira."
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
                      label="Workspace"
                      hint="The short ID from your Bitbucket URL (bitbucket.org/<workspace>/…)."
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
                      label="Bitbucket username (for git)"
                      hint="Different from email. Used in clone URLs."
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
                      label="API token"
                      hint="Created at id.atlassian.com → Security → API tokens."
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
                        Test connection
                      </Button>
                      <BitbucketTestResult result={bitbucketTestResult} />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <SectionCardHeader
                    title="Jira"
                    description="Reuses your Atlassian email; needs its own API token."
                    onOpenGuide={() => setGuideOpen('jira')}
                  />
                  <CardContent className="space-y-4">
                    <Field
                      label="Host"
                      hint="Your Jira Cloud URL (https://<company>.atlassian.net)."
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
                      label="API token"
                      hint="Use a classic token (no scopes). See guide for why."
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
                        Test connection
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
                  title="Paths"
                  description="Where projects clone, where SQL dumps live, how VS Code is launched."
                  onOpenGuide={() => setGuideOpen('paths')}
                />
                <CardContent className="space-y-4">
                  <Field
                    label="Projects folder"
                    hint="Each repo clones to <root>/<slug>."
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
                    label="Dumps folder"
                    hint="Where SQL dumps live; auto-detected by name pattern."
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
                    label="VS Code executable"
                    value={config.paths.vscodeExecutable}
                    detected={vscodeDetected}
                    placeholder="code"
                    notFoundHint="not found in PATH"
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
                  title="Database"
                  description="Local MySQL connection — size detection, restore, drop/create."
                  onOpenGuide={() => setGuideOpen('database')}
                />
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <Field label="Host" className="col-span-2">
                      <Input
                        value={config.database.host}
                        onChange={(e) =>
                          updatePath('database', 'host')(e.target.value)
                        }
                        placeholder="localhost"
                      />
                    </Field>
                    <Field label="Port">
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
                  <Field label="User">
                    <Input
                      value={config.database.user}
                      onChange={(e) =>
                        updatePath('database', 'user')(e.target.value)
                      }
                      placeholder="root"
                    />
                  </Field>
                  <SecretField
                    label="Password"
                    status={secretsStatus.dbPassword}
                    value={dbPassword}
                    onChange={setDbPassword}
                    onClear={() => onClearSecret('dbPassword')}
                  />
                  <BinaryPathField
                    label="mysql executable"
                    value={config.database.mysqlExecutable}
                    detected={mysqlDetected}
                    placeholder="C:\\path\\to\\mysql.exe"
                    notFoundHint={
                      config.database.mysqlExecutable
                        ? 'not found — restore will be blocked'
                        : 'optional — only needed for restoring dumps'
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
                      Test connection
                    </Button>
                    <DbTestResult result={dbTestResult} />
                  </div>
                </CardContent>
              </Card>
            )}

            {activeSection === 'dotnet' && (
              <Card>
                <SectionCardHeader
                  title=".NET"
                  description="Optional dotnet run arguments. Most users leave this empty."
                  onOpenGuide={() => setGuideOpen('dotnet')}
                />
                <CardContent className="space-y-4">
                  <Field
                    label="Run arguments"
                    hint="Space-separated, passed to dotnet run after --"
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
                  {SETUP_GUIDES[guideOpen].title}
                </DialogTitle>
                <DialogDescription>
                  {SETUP_GUIDES[guideOpen].description}
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
  return (
    <CardHeader>
      <div className="flex items-start justify-between gap-3">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {onOpenGuide && (
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenGuide}
            title="Open the full setup walkthrough"
          >
            <BookOpen size={13} />
            Setup guide
          </Button>
        )}
      </div>
    </CardHeader>
  )
}

function PresenceCard({ config, updatePath, onOpenGuide }) {
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
        title="Presence"
        description="See which colleagues have WorkHelper open on the same network."
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
          Enable presence
        </label>
        <p className="text-xs text-muted-foreground">
          Off by default. Shares hostname, username, local IP and
          version with others on your network or Tailnet.
        </p>
      </CardContent>
    </Card>
  )
}

function AppearanceCard({ onOpenGuide }) {
  const theme = usePrefsStore((s) => s.theme)
  const setTheme = usePrefsStore((s) => s.setTheme)
  const density = usePrefsStore((s) => s.density)
  const setDensity = usePrefsStore((s) => s.setDensity)
  const autoRefreshMs = usePrefsStore((s) => s.autoRefreshMs)
  const setAutoRefreshMs = usePrefsStore((s) => s.setAutoRefreshMs)
  const searchHighlight = usePrefsStore((s) => s.searchHighlight)
  const setSearchHighlight = usePrefsStore((s) => s.setSearchHighlight)

  return (
    <Card>
      <SectionCardHeader
        title="Appearance"
        description="Display preferences for this machine. Stored locally."
        onOpenGuide={onOpenGuide}
      />
      <CardContent className="space-y-4">
        <Field label="Theme">
          <SegmentedRadio
            options={[
              { value: 'dark', label: 'Dark', icon: <Moon size={14} /> },
              { value: 'light', label: 'Light', icon: <Sun size={14} /> },
              { value: 'system', label: 'System', icon: <Monitor size={14} /> }
            ]}
            value={theme}
            onChange={setTheme}
          />
        </Field>
        <Field label="Density">
          <SegmentedRadio
            options={[
              {
                value: 'comfortable',
                label: 'Comfortable',
                icon: <Rows3 size={14} />
              },
              { value: 'compact', label: 'Compact', icon: <Rows4 size={14} /> }
            ]}
            value={density}
            onChange={setDensity}
          />
        </Field>
        <Field
          label="Auto-refresh projects"
          hint="Periodically fetches the Bitbucket list in the background"
        >
          <SegmentedRadio
            options={[
              { value: 0, label: 'Off' },
              { value: 60_000, label: '1 min' },
              { value: 300_000, label: '5 min' },
              { value: 600_000, label: '10 min' }
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
          Highlight search matches in the projects table
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
  // Кнопка показывается всегда когда есть detected — даже если поле
  // уже равно detected. Это позволяет «вернуть к авто» одним кликом
  // в любой момент, не ломая голову над тем, что в поле сейчас.
  const canUseDetected = !!detected
  const hint = detected ? `detected: ${detected}` : notFoundHint
  return (
    <div className="space-y-1.5">
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
            Use detected
          </Button>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Field({ label, hint, className, children }) {
  return (
    <div className={'space-y-1.5 ' + (className || '')}>
      <Label>{label}</Label>
      {children}
      {hint && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

function SecretField({ label, hint, status, value, onChange, onClear }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={status ? '•••••• stored — leave blank to keep' : ''}
        />
        {status && (
          <Button variant="outline" size="sm" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
      {status && !value ? (
        <p className="text-xs text-muted-foreground">
          Encrypted value already saved.
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

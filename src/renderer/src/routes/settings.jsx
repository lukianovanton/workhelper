import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, X, Loader2, CheckCircle2, XCircle } from 'lucide-react'
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
import { Separator } from '@/components/ui/separator'
import { api } from '@/api'

export default function Settings() {
  const navigate = useNavigate()
  const [config, setConfig] = useState(null)
  const [secretsStatus, setSecretsStatus] = useState({
    bitbucketApiToken: false,
    dbPassword: false
  })
  const [bitbucketApiToken, setBitbucketApiToken] = useState('')
  const [dbPassword, setDbPassword] = useState('')
  const [vscodeDetected, setVscodeDetected] = useState(null)
  const [mysqlDetected, setMysqlDetected] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState(null)
  const [testingBitbucket, setTestingBitbucket] = useState(false)
  const [bitbucketTestResult, setBitbucketTestResult] = useState(null)
  const [testingDb, setTestingDb] = useState(false)
  const [dbTestResult, setDbTestResult] = useState(null)

  const loadAll = useCallback(async () => {
    const [c, s] = await Promise.all([
      api.config.get(),
      api.config.secretsStatus()
    ])
    setConfig(c)
    setSecretsStatus(s)
    setBitbucketApiToken('')
    setDbPassword('')
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    if (!config) return
    api.config.whichBinary(config.paths.vscodeExecutable).then(setVscodeDetected)
    if (config.database.mysqlExecutable) {
      api.config.whichBinary(config.database.mysqlExecutable).then(setMysqlDetected)
    } else {
      setMysqlDetected(null)
    }
  }, [config?.paths?.vscodeExecutable, config?.database?.mysqlExecutable])

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
      await loadAll()
      setSaveStatus({ ok: true, message: 'Saved' })
    } catch (e) {
      setSaveStatus({ ok: false, message: e?.message || String(e) })
    } finally {
      setSaving(false)
      setTimeout(() => setSaveStatus(null), 3000)
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
              className={
                saveStatus.ok
                  ? 'text-xs text-emerald-500 flex items-center gap-1'
                  : 'text-xs text-destructive flex items-center gap-1'
              }
            >
              {saveStatus.ok ? <Check size={14} /> : <X size={14} />}
              {saveStatus.message}
            </span>
          )}
          <Button onClick={onSave} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6 space-y-6 max-w-3xl mx-auto w-full">
        <Card>
          <CardHeader>
            <CardTitle>Bitbucket</CardTitle>
            <CardDescription>
              Workspace and credentials for the Cloud API. API token
              created at <code>id.atlassian.com → Security → Create API
              token with scopes</code> → Bitbucket →{' '}
              <code>read:repository:bitbucket</code>. App passwords are
              deprecated since Sep 2025.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Workspace">
              <Input
                value={config.bitbucket.workspace}
                onChange={(e) =>
                  updatePath('bitbucket', 'workspace')(e.target.value)
                }
                placeholder="techgurusit"
              />
            </Field>
            <Field label="Username (email)">
              <Input
                type="email"
                value={config.bitbucket.username}
                onChange={(e) =>
                  updatePath('bitbucket', 'username')(e.target.value)
                }
                placeholder="you@example.com"
              />
            </Field>
            <Field
              label="Bitbucket username (for git)"
              hint="Your Bitbucket username, not email. Find at Bitbucket → Personal settings → Account."
            >
              <Input
                value={config.bitbucket.gitUsername}
                onChange={(e) =>
                  updatePath('bitbucket', 'gitUsername')(e.target.value)
                }
                placeholder="antonreact1"
              />
            </Field>
            <SecretField
              label="API token"
              status={secretsStatus.bitbucketApiToken}
              value={bitbucketApiToken}
              onChange={setBitbucketApiToken}
              onClear={() => {
                onClearSecret('bitbucketApiToken')
                setBitbucketTestResult(null)
              }}
            />
            <div className="pt-2 space-y-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onTestBitbucket}
                disabled={testingBitbucket}
              >
                {testingBitbucket && <Loader2 className="animate-spin" />}
                Test connection
              </Button>
              <BitbucketTestResult result={bitbucketTestResult} />
              <p className="text-xs text-muted-foreground">
                Test reads stored credentials — Save first if you've changed
                fields above.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Paths</CardTitle>
            <CardDescription>
              Where projects live, where SQL dumps are kept, and how to call
              VS Code.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="Projects folder"
              hint="Each repo lives at projectsRoot/slug.toLowerCase()"
            >
              <Input
                value={config.paths.projectsRoot}
                onChange={(e) =>
                  updatePath('paths', 'projectsRoot')(e.target.value)
                }
                placeholder="C:\\Projects"
              />
            </Field>
            <Field label="Dumps folder">
              <Input
                value={config.paths.dumpsRoot}
                onChange={(e) =>
                  updatePath('paths', 'dumpsRoot')(e.target.value)
                }
                placeholder="C:\\Dumps"
              />
            </Field>
            <Field
              label="VS Code executable"
              hint={
                vscodeDetected
                  ? `detected: ${vscodeDetected}`
                  : 'not found in PATH'
              }
            >
              <Input
                value={config.paths.vscodeExecutable}
                onChange={(e) =>
                  updatePath('paths', 'vscodeExecutable')(e.target.value)
                }
                placeholder="code"
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Database</CardTitle>
            <CardDescription>
              Local MySQL — used in MVP-1 for read-only enrich (db.exists,
              db.size). <code>mysql</code> CLI is only needed for MVP-2 dump
              restore; leave path empty until then.
            </CardDescription>
          </CardHeader>
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
                    updatePath('database', 'port')(Number(e.target.value) || 0)
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
            <Field
              label="mysql executable"
              hint={
                config.database.mysqlExecutable
                  ? mysqlDetected
                    ? `detected: ${mysqlDetected}`
                    : 'not found — restore will be blocked in MVP-2'
                  : 'leave empty for MVP-1'
              }
            >
              <Input
                value={config.database.mysqlExecutable}
                onChange={(e) =>
                  updatePath('database', 'mysqlExecutable')(e.target.value)
                }
                placeholder="C:\\path\\to\\mysql.exe"
              />
            </Field>
            <div className="pt-2 space-y-2">
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
              <p className="text-xs text-muted-foreground">
                Test reads stored credentials — Save first if you've changed
                fields above.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>.NET</CardTitle>
            <CardDescription>
              Extra arguments for <code>dotnet run</code>. The runnable
              subpath is auto-detected per project (see spec 9.5);
              per-project overrides are an advanced feature.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              label="Run arguments"
              hint="Space-separated, passed to dotnet run after `--`"
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

        <Separator />
        <p className="text-xs text-muted-foreground">
          Config stored in <code>%APPDATA%\\project-hub\\config.json</code>.
          Secrets encrypted via Electron safeStorage in{' '}
          <code>secrets.json</code>.
        </p>
      </div>
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

function SecretField({ label, status, value, onChange, onClear }) {
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
      {status && !value && (
        <p className="text-xs text-muted-foreground">
          Encrypted value already saved.
        </p>
      )}
    </div>
  )
}

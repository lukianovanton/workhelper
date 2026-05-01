import { ExternalLink } from 'lucide-react'

/**
 * Полный setup-гайд для Bitbucket-секции в Settings. Маленькая
 * inline-подсказка под полями оставлена короткой ради сканируемости;
 * этот компонент — большой walkthrough в модалке для новичка,
 * которому нужно за 5 минут собрать все 4 значения с нуля.
 *
 * Структура — нумерованные шаги с прямыми клик-ссылками на нужные
 * страницы Atlassian (open в системном браузере). Скриншотов пока
 * нет — добавим позже файлами в /assets и подключим через <img>.
 */
export function BitbucketSetupGuide() {
  return (
    <div className="space-y-6 text-sm leading-relaxed">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">
          What you'll need
        </h3>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>
            <strong className="text-foreground">Atlassian email</strong>{' '}
            — the one you sign in with at bitbucket.org
          </li>
          <li>
            <strong className="text-foreground">Workspace</strong> — the
            short ID from the URL (e.g. <code>techgurusit</code>)
          </li>
          <li>
            <strong className="text-foreground">Bitbucket username</strong>{' '}
            — <em>not</em> the email. Used in git clone URLs.
          </li>
          <li>
            <strong className="text-foreground">API token</strong> —
            created on id.atlassian.com (one minute of work)
          </li>
        </ul>
      </section>

      <Step number={1} title="Create the API token">
        <p>
          Open{' '}
          <ExtLink href="https://id.atlassian.com/manage-profile/security/api-tokens">
            id.atlassian.com → Security → API tokens
          </ExtLink>
          .
        </p>
        <p>
          On that page you'll see <em>two</em> create-buttons.{' '}
          <strong className="text-foreground">
            Click "Create API token"
          </strong>{' '}
          — the one <em>without</em> "with scopes". Classic tokens have
          full account access and just work; scoped tokens have a few
          Atlassian quirks (especially in Jira) we'd rather avoid.
        </p>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>Give the token a name like "WorkHelper"</li>
          <li>Click <strong className="text-foreground">Create</strong></li>
          <li>
            <strong className="text-foreground">
              Copy the token immediately
            </strong>{' '}
            — Atlassian only shows it once. Lose it = recreate it.
          </li>
        </ul>
      </Step>

      <Step number={2} title="Find your Workspace ID">
        <p>
          Open{' '}
          <ExtLink href="https://bitbucket.org/">bitbucket.org</ExtLink>
          {' '}and look at any repository URL. The format is{' '}
          <code className="text-foreground">
            bitbucket.org/&lt;workspace&gt;/&lt;repo&gt;
          </code>
          . The workspace part is what you want — it's a single short
          word, lowercase, no spaces. For our company it's{' '}
          <code className="text-foreground">techgurusit</code>.
        </p>
      </Step>

      <Step number={3} title="Find your Bitbucket username">
        <p>
          Open{' '}
          <ExtLink href="https://bitbucket.org/account/settings/">
            bitbucket.org/account/settings
          </ExtLink>
          . The "Username" field is what you need — typically a single
          short word, no spaces. <strong>This is different from your
          email.</strong> The email is for the REST API; the username is
          for git URLs.
        </p>
      </Step>

      <Step number={4} title="Plug everything into Settings">
        <p>Back in WorkHelper, fill in the Bitbucket card:</p>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
          <li>
            <strong className="text-foreground">Email</strong>: your
            Atlassian email (the same one you log in with)
          </li>
          <li>
            <strong className="text-foreground">Workspace</strong>: the
            ID from step 2
          </li>
          <li>
            <strong className="text-foreground">Bitbucket username</strong>:
            from step 3
          </li>
          <li>
            <strong className="text-foreground">API token</strong>:
            paste the value from step 1
          </li>
        </ul>
        <p>
          Click <strong className="text-foreground">Save</strong>, then{' '}
          <strong className="text-foreground">Test Bitbucket</strong>.
          If it shows{' '}
          <span className="text-emerald-400">
            "Authenticated as &lt;your name&gt;"
          </span>{' '}
          you're done.
        </p>
      </Step>

      <section className="space-y-2 pt-1 border-t border-border/40">
        <h3 className="text-sm font-semibold text-foreground">
          Troubleshooting
        </h3>
        <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
          <li>
            <strong className="text-foreground">
              "Authentication failed (401)"
            </strong>
            : token is wrong, was revoked, or the email doesn't match
            the Atlassian account that owns the token. Most often:
            extra space copied with the token, or a typo in the email.
            Easiest fix: revoke and create a new token.
          </li>
          <li>
            <strong className="text-foreground">
              "Cannot read repositories in workspace …"
            </strong>
            : the token works but the workspace name is wrong, or you
            don't have access. Re-check step 2.
          </li>
          <li>
            <strong className="text-foreground">
              You created an "API token with scopes" instead
            </strong>
            : it might still work for Bitbucket — required scopes are{' '}
            <code>read:account</code>,{' '}
            <code>read:workspace:bitbucket</code>,{' '}
            <code>read:repository:bitbucket</code>,{' '}
            <code>write:repository:bitbucket</code>,{' '}
            <code>read:pipeline:bitbucket</code>. But the cleanest path
            is the classic token.
          </li>
          <li>
            <strong className="text-foreground">
              Token leaks / shared device
            </strong>
            : revoke it on{' '}
            <ExtLink href="https://id.atlassian.com/manage-profile/security/api-tokens">
              id.atlassian.com
            </ExtLink>
            . Tokens are stored encrypted on this machine via Electron's
            safeStorage (DPAPI on Windows), but a lost token from a
            shared box should still be revoked.
          </li>
        </ul>
      </section>
    </div>
  )
}

function Step({ number, title, children }) {
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

function ExtLink({ href, children }) {
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

import { GuideShell, Section, Step, ExtLink } from './_shared'
import { useLang } from '@/i18n'

export function BitbucketSetupGuide() {
  const lang = useLang()
  return lang === 'ru' ? <BitbucketSetupGuideRu /> : <BitbucketSetupGuideEn />
}

function BitbucketSetupGuideEn() {
  return (
    <GuideShell>
      <Section title="What you'll need">
        <ul className="list-disc pl-5 space-y-1">
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
      </Section>

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
        <ul className="list-disc pl-5 space-y-1">
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
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Email</strong>: your
            Atlassian email
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

      <Section title="Troubleshooting" className="pt-1 border-t border-border/40">
        <ul className="list-disc pl-5 space-y-1.5">
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
              Token leaked / shared device
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
      </Section>
    </GuideShell>
  )
}

function BitbucketSetupGuideRu() {
  return (
    <GuideShell>
      <Section title="Что понадобится">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Email Atlassian</strong>{' '}
            — тот, с которым вы заходите на bitbucket.org
          </li>
          <li>
            <strong className="text-foreground">Workspace</strong> —
            короткий ID из URL (например <code>techgurusit</code>)
          </li>
          <li>
            <strong className="text-foreground">Bitbucket username</strong>{' '}
            — <em>не</em> email. Используется в git clone URL.
          </li>
          <li>
            <strong className="text-foreground">API-токен</strong> —
            создаётся на id.atlassian.com (минута работы)
          </li>
        </ul>
      </Section>

      <Step number={1} title="Создайте API-токен">
        <p>
          Откройте{' '}
          <ExtLink href="https://id.atlassian.com/manage-profile/security/api-tokens">
            id.atlassian.com → Security → API tokens
          </ExtLink>
          .
        </p>
        <p>
          На странице будут <em>две</em> кнопки создания.{' '}
          <strong className="text-foreground">
            Нажмите «Create API token»
          </strong>{' '}
          — ту, что <em>без</em> «with scopes». Классические токены имеют
          полный доступ к аккаунту и просто работают; у scoped-токенов
          есть пара особенностей Atlassian (особенно в Jira), которых
          лучше избегать.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Дайте токену имя, например «WorkHelper»</li>
          <li>Нажмите <strong className="text-foreground">Create</strong></li>
          <li>
            <strong className="text-foreground">
              Сразу скопируйте токен
            </strong>{' '}
            — Atlassian показывает его только один раз. Потеряли = создавайте заново.
          </li>
        </ul>
      </Step>

      <Step number={2} title="Найдите Workspace ID">
        <p>
          Откройте{' '}
          <ExtLink href="https://bitbucket.org/">bitbucket.org</ExtLink>
          {' '}и посмотрите URL любого репозитория. Формат:{' '}
          <code className="text-foreground">
            bitbucket.org/&lt;workspace&gt;/&lt;repo&gt;
          </code>
          . Часть workspace — это и есть нужное значение: одно короткое
          слово, lowercase, без пробелов. У нас в компании это{' '}
          <code className="text-foreground">techgurusit</code>.
        </p>
      </Step>

      <Step number={3} title="Найдите Bitbucket username">
        <p>
          Откройте{' '}
          <ExtLink href="https://bitbucket.org/account/settings/">
            bitbucket.org/account/settings
          </ExtLink>
          . Поле «Username» — это то, что нужно. Обычно одно короткое
          слово, без пробелов. <strong>Это не email.</strong> Email
          используется для REST API; username — для git URL.
        </p>
      </Step>

      <Step number={4} title="Подставьте всё в Settings">
        <p>В WorkHelper заполните карточку Bitbucket:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Email</strong>: ваш
            email Atlassian
          </li>
          <li>
            <strong className="text-foreground">Workspace</strong>: ID
            из шага 2
          </li>
          <li>
            <strong className="text-foreground">Bitbucket username</strong>:
            из шага 3
          </li>
          <li>
            <strong className="text-foreground">API-токен</strong>:
            вставьте значение из шага 1
          </li>
        </ul>
        <p>
          Нажмите <strong className="text-foreground">Save</strong>, затем{' '}
          <strong className="text-foreground">Test Bitbucket</strong>.
          Если показано{' '}
          <span className="text-emerald-400">
            «Authenticated as &lt;ваше имя&gt;»
          </span>{' '}
          — готово.
        </p>
      </Step>

      <Section title="Что делать если" className="pt-1 border-t border-border/40">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">
              «Authentication failed (401)»
            </strong>
            : токен неверный, отозван, либо email не совпадает с
            аккаунтом Atlassian, которому принадлежит токен. Чаще всего:
            лишний пробел в скопированном токене или опечатка в email.
            Самый простой фикс: отозвать и создать новый токен.
          </li>
          <li>
            <strong className="text-foreground">
              «Cannot read repositories in workspace …»
            </strong>
            : токен работает, но имя workspace неверное, либо у вас нет
            доступа. Перепроверьте шаг 2.
          </li>
          <li>
            <strong className="text-foreground">
              Создали «API token with scopes» вместо классического
            </strong>
            : для Bitbucket может сработать — нужны scope'ы{' '}
            <code>read:account</code>,{' '}
            <code>read:workspace:bitbucket</code>,{' '}
            <code>read:repository:bitbucket</code>,{' '}
            <code>write:repository:bitbucket</code>,{' '}
            <code>read:pipeline:bitbucket</code>. Но самый чистый путь —
            классический токен.
          </li>
          <li>
            <strong className="text-foreground">
              Токен утёк / общая машина
            </strong>
            : отзовите его на{' '}
            <ExtLink href="https://id.atlassian.com/manage-profile/security/api-tokens">
              id.atlassian.com
            </ExtLink>
            . Токены хранятся зашифрованно через Electron safeStorage
            (DPAPI на Windows), но утерянный с общей машины токен всё
            равно стоит отозвать.
          </li>
        </ul>
      </Section>
    </GuideShell>
  )
}

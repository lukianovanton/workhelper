import { GuideShell, Section, Step, ExtLink } from './_shared'
import { useLang } from '@/i18n'

export function GitHubSetupGuide() {
  const lang = useLang()
  return lang === 'ru' ? <GitHubSetupGuideRu /> : <GitHubSetupGuideEn />
}

function GitHubSetupGuideEn() {
  return (
    <GuideShell>
      <Section title="What you'll need">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Owner</strong> — your
            GitHub user login (e.g. <code>octocat</code>) or an
            organization slug (the part after <code>github.com/</code>).
          </li>
          <li>
            <strong className="text-foreground">Personal Access Token</strong>{' '}
            — created at{' '}
            <ExtLink href="https://github.com/settings/tokens">
              github.com → Settings → Developer settings → Personal
              access tokens
            </ExtLink>
            . Classic or fine-grained both work.
          </li>
        </ul>
      </Section>

      <Step number={1} title="Create the token">
        <p>
          Open{' '}
          <ExtLink href="https://github.com/settings/tokens">
            github.com/settings/tokens
          </ExtLink>
          {' '}— either tab works:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Tokens (classic)</strong>{' '}
            → <em>Generate new token (classic)</em>. In the «Select
            scopes» list tick the very first checkbox —{' '}
            <code>repo</code> («Full control of private repositories»).
            Ticking the parent auto-selects all five sub-scopes
            (<code>repo:status</code>, <code>repo_deployment</code>,{' '}
            <code>public_repo</code>, <code>repo:invite</code>,{' '}
            <code>security_events</code>) — that's everything we need
            to list and read repos, see commits, and view Actions
            runs. Don't tick anything else.
            <p className="text-[12px] text-muted-foreground mt-1">
              If you only need access to public repos, you can tick
              just <code>public_repo</code> instead — but org-private
              and personal-private repos won't show up.
            </p>
          </li>
          <li>
            <strong className="text-foreground">Fine-grained tokens</strong>{' '}
            → choose the org / user (resource owner), pick the
            repositories you want WorkHelper to see, then under
            «Repository permissions» grant{' '}
            <em>Contents: Read</em>, <em>Metadata: Read</em>, and{' '}
            <em>Actions: Read</em>.
          </li>
        </ul>
        <p>
          <strong className="text-foreground">Copy the token now</strong>{' '}
          — GitHub shows it once.
        </p>
      </Step>

      <Step number={2} title="Find your owner slug">
        <p>
          Open any repo's URL in a browser. The format is{' '}
          <code className="text-foreground">
            github.com/&lt;owner&gt;/&lt;repo&gt;
          </code>
          . The owner is what you want — your username for personal
          repos, the organization slug for org repos.
        </p>
      </Step>

      <Step number={3} title="Plug values into Settings">
        <p>In the GitHub source card:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Display name</strong>:
            free-form label (visible in the projects list)
          </li>
          <li>
            <strong className="text-foreground">Owner</strong>: from
            step 2
          </li>
          <li>
            <strong className="text-foreground">GitHub username</strong>:
            your login (used in clone URLs as a hint to the system Git
            credential manager)
          </li>
          <li>
            <strong className="text-foreground">Personal Access Token</strong>:
            paste from step 1
          </li>
        </ul>
        <p>
          Save the source, then click <strong>Test connection</strong>.
          You should see «Authenticated as &lt;your login&gt;».
        </p>
      </Step>

      <Section title="Troubleshooting" className="pt-1 border-t border-border/40">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">
              «Authentication failed (401)»
            </strong>
            : token is wrong, expired, or scope is missing. For
            classic tokens — re-tick the <code>repo</code> scope.
            For fine-grained — make sure the repos / orgs are listed
            in «Repository access».
          </li>
          <li>
            <strong className="text-foreground">
              Empty repository list under an organization
            </strong>
            : the token might lack access to that org. For fine-grained
            tokens, the org must enable «Personal access tokens
            (fine-grained)» under <em>Settings → Third-party
            access</em>. Otherwise classic token + SSO authorization
            on the org is the fast path.
          </li>
          <li>
            <strong className="text-foreground">
              «GitHub rate limit exceeded»
            </strong>
            : authenticated requests get 5,000/hour per token. If
            you're hitting that with one workspace, you have a lot
            of repos — use the cache (the projects list TTL is 10
            min) and avoid hammering Refresh.
          </li>
        </ul>
      </Section>
    </GuideShell>
  )
}

function GitHubSetupGuideRu() {
  return (
    <GuideShell>
      <Section title="Что понадобится">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Owner</strong> — твой
            логин на GitHub (например <code>octocat</code>) или slug
            организации (то, что после <code>github.com/</code>).
          </li>
          <li>
            <strong className="text-foreground">Personal Access Token</strong>{' '}
            — создаётся на{' '}
            <ExtLink href="https://github.com/settings/tokens">
              github.com → Settings → Developer settings → Personal
              access tokens
            </ExtLink>
            . Classic или fine-grained — оба работают.
          </li>
        </ul>
      </Section>

      <Step number={1} title="Создай токен">
        <p>
          Открой{' '}
          <ExtLink href="https://github.com/settings/tokens">
            github.com/settings/tokens
          </ExtLink>
          {' '}— любая из вкладок подойдёт:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Tokens (classic)</strong>{' '}
            → <em>Generate new token (classic)</em>. В списке «Select
            scopes» отметь самый первый чекбокс —{' '}
            <code>repo</code> («Full control of private repositories»).
            Галочка на родителе сама включит пять под-скоупов
            (<code>repo:status</code>, <code>repo_deployment</code>,{' '}
            <code>public_repo</code>, <code>repo:invite</code>,{' '}
            <code>security_events</code>) — этого хватает чтобы
            листать и читать репо, видеть коммиты и Actions runs.
            Больше ничего отмечать не надо.
            <p className="text-[12px] text-muted-foreground mt-1">
              Если у тебя только публичные репо — можно поставить
              только <code>public_repo</code>. Но приватные репо
              (личные и в org) тогда не появятся.
            </p>
          </li>
          <li>
            <strong className="text-foreground">Fine-grained tokens</strong>{' '}
            → выбери org / user (resource owner), отметь репозитории к
            которым WorkHelper будет иметь доступ, в «Repository
            permissions» выдай <em>Contents: Read</em>,{' '}
            <em>Metadata: Read</em>, <em>Actions: Read</em>.
          </li>
        </ul>
        <p>
          <strong className="text-foreground">Скопируй токен сразу</strong>{' '}
          — GitHub покажет его только один раз.
        </p>
      </Step>

      <Step number={2} title="Найди owner-slug">
        <p>
          Открой URL любого репо в браузере. Формат:{' '}
          <code className="text-foreground">
            github.com/&lt;owner&gt;/&lt;repo&gt;
          </code>
          . Owner — это твой логин для личных репо или slug
          организации для командных.
        </p>
      </Step>

      <Step number={3} title="Подставь в Settings">
        <p>В карточке GitHub-источника:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Название</strong>:
            свободная подпись (видна в списке проектов)
          </li>
          <li>
            <strong className="text-foreground">Owner</strong>: из
            шага 2
          </li>
          <li>
            <strong className="text-foreground">GitHub username</strong>:
            твой логин (используется в clone URL как подсказка системному
            git credential manager'у)
          </li>
          <li>
            <strong className="text-foreground">Personal Access Token</strong>:
            из шага 1
          </li>
        </ul>
        <p>
          Сохрани источник, нажми <strong>Test connection</strong>.
          Должно показать «Authenticated as &lt;твой логин&gt;».
        </p>
      </Step>

      <Section title="Что делать если" className="pt-1 border-t border-border/40">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">
              «Authentication failed (401)»
            </strong>
            : токен неверный, истёк, или не хватает scope. Для classic
            — пересоздай со scope <code>repo</code>. Для fine-grained —
            проверь, что репо / org указаны в «Repository access».
          </li>
          <li>
            <strong className="text-foreground">
              Пустой список репо у организации
            </strong>
            : токен может не иметь доступа к этой org. Для fine-grained
            org должна разрешить «Personal access tokens (fine-grained)»
            в <em>Settings → Third-party access</em>. Альтернатива —
            classic токен + SSO-авторизация на org.
          </li>
          <li>
            <strong className="text-foreground">
              «GitHub rate limit exceeded»
            </strong>
            : 5000 запросов/час на токен. Если упёрся в лимит при одном
            workspace — у тебя много репо; кэш списка проектов 10 мин,
            не дёргай Refresh без необходимости.
          </li>
        </ul>
      </Section>
    </GuideShell>
  )
}

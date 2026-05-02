import { GuideShell, Section, Step, ExtLink } from './_shared'
import { useLang } from '@/i18n'

export function GitLabSetupGuide() {
  const lang = useLang()
  return lang === 'ru' ? <GitLabSetupGuideRu /> : <GitLabSetupGuideEn />
}

function GitLabSetupGuideEn() {
  return (
    <GuideShell>
      <Section title="What you'll need">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Namespace</strong> — your
            GitLab group full-path (e.g. <code>my-team</code> or{' '}
            <code>my-team/sub-team</code>) or your username for personal
            projects. It's everything between the host and the repo name
            in the URL.
          </li>
          <li>
            <strong className="text-foreground">Personal Access Token</strong>{' '}
            — created at{' '}
            <ExtLink href="https://gitlab.com/-/user_settings/personal_access_tokens">
              gitlab.com → User settings → Access tokens
            </ExtLink>
            . On self-hosted: same path, replace the host.
          </li>
          <li>
            <strong className="text-foreground">Base URL</strong> — only
            needed for self-hosted GitLab (e.g.{' '}
            <code>https://gitlab.mycorp.com</code>). For gitlab.com leave
            blank.
          </li>
        </ul>
      </Section>

      <Step number={1} title="Create the token">
        <p>
          Open{' '}
          <ExtLink href="https://gitlab.com/-/user_settings/personal_access_tokens">
            gitlab.com/-/user_settings/personal_access_tokens
          </ExtLink>
          {' '}→ click <em>Add new token</em>. Required scopes:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <code>read_api</code> — list projects, read commits,
            branches, pipelines, jobs.
          </li>
          <li>
            <code>read_repository</code> — fetch raw file contents and
            tree listings (used by the project stack auto-detection).
          </li>
        </ul>
        <p className="text-[12px] text-muted-foreground mt-1">
          Tip: pick an expiration date you can remember to renew. GitLab
          requires expiration; for a personal dev tool 1 year is a
          reasonable default.
        </p>
        <p>
          <strong className="text-foreground">Copy the token now</strong>{' '}
          — GitLab shows it once.
        </p>
      </Step>

      <Step number={2} title="Find your namespace">
        <p>
          Open any project URL in a browser. The format is{' '}
          <code className="text-foreground">
            gitlab.com/&lt;namespace&gt;/&lt;repo&gt;
          </code>
          . The namespace is everything before the last slash — it can
          be a single group (<code>acme</code>), a subgroup chain
          (<code>acme/backend/api</code>), or your personal username.
        </p>
        <p className="text-[12px] text-muted-foreground mt-1">
          One source = one namespace. If you have multiple groups, add
          a separate GitLab source per group; subgroups under one parent
          aren't auto-included.
        </p>
      </Step>

      <Step number={3} title="Plug values into Settings">
        <p>In the GitLab source card:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Display name</strong>:
            free-form label (visible in the projects list)
          </li>
          <li>
            <strong className="text-foreground">Namespace</strong>: from
            step 2
          </li>
          <li>
            <strong className="text-foreground">GitLab username</strong>:
            your login (used in clone URLs as a hint to the system Git
            credential manager)
          </li>
          <li>
            <strong className="text-foreground">Personal Access Token</strong>:
            paste from step 1
          </li>
          <li>
            <strong className="text-foreground">Base URL</strong>{' '}
            (self-hosted only): full URL of your GitLab instance,
            e.g. <code>https://gitlab.mycorp.com</code>
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
            : token is wrong, expired, or revoked. Check the expiration
            date in the token list, regenerate if needed.
          </li>
          <li>
            <strong className="text-foreground">
              «Forbidden (403) … lacks required scope»
            </strong>
            : token is missing <code>read_api</code> or{' '}
            <code>read_repository</code>. Either edit the token's
            scopes or create a new one with both ticked.
          </li>
          <li>
            <strong className="text-foreground">
              Empty repository list
            </strong>
            : double-check the namespace path. For groups,{' '}
            <code>acme</code> only lists projects directly under{' '}
            <em>acme/</em>, not under <em>acme/sub/</em>. Add another
            source for the subgroup, or set the namespace to the deeper
            path.
          </li>
          <li>
            <strong className="text-foreground">
              Self-hosted instance returns 404
            </strong>
            : verify the Base URL. WorkHelper appends{' '}
            <code>/api/v4</code> automatically — paste only the root
            (e.g. <code>https://gitlab.mycorp.com</code>), no trailing
            slash, no path.
          </li>
        </ul>
      </Section>
    </GuideShell>
  )
}

function GitLabSetupGuideRu() {
  return (
    <GuideShell>
      <Section title="Что понадобится">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Namespace</strong> —
            full-path твоей группы на GitLab (например <code>my-team</code>{' '}
            или <code>my-team/sub-team</code>) или твой username для
            личных проектов. Это всё, что между хостом и именем репо в
            URL.
          </li>
          <li>
            <strong className="text-foreground">Personal Access Token</strong>{' '}
            — создаётся на{' '}
            <ExtLink href="https://gitlab.com/-/user_settings/personal_access_tokens">
              gitlab.com → User settings → Access tokens
            </ExtLink>
            . Для self-hosted — тот же путь, замени хост.
          </li>
          <li>
            <strong className="text-foreground">Base URL</strong> —
            нужен только для self-hosted GitLab (например{' '}
            <code>https://gitlab.mycorp.com</code>). Для gitlab.com
            оставь пустым.
          </li>
        </ul>
      </Section>

      <Step number={1} title="Создай токен">
        <p>
          Открой{' '}
          <ExtLink href="https://gitlab.com/-/user_settings/personal_access_tokens">
            gitlab.com/-/user_settings/personal_access_tokens
          </ExtLink>
          {' '}→ нажми <em>Add new token</em>. Нужные scope:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <code>read_api</code> — листать проекты, читать коммиты,
            ветки, pipelines, jobs.
          </li>
          <li>
            <code>read_repository</code> — читать содержимое файлов и
            tree-listing (нужно для автодетекта стека проекта).
          </li>
        </ul>
        <p className="text-[12px] text-muted-foreground mt-1">
          Совет: поставь срок, который сможешь продлить. GitLab требует
          expiration; для личного dev-tool'а 1 год — разумный дефолт.
        </p>
        <p>
          <strong className="text-foreground">Скопируй токен сразу</strong>{' '}
          — GitLab покажет его только один раз.
        </p>
      </Step>

      <Step number={2} title="Найди namespace">
        <p>
          Открой URL любого проекта в браузере. Формат:{' '}
          <code className="text-foreground">
            gitlab.com/&lt;namespace&gt;/&lt;repo&gt;
          </code>
          . Namespace — всё, что до последнего слэша: одна группа
          (<code>acme</code>), цепочка subgroup'ов
          (<code>acme/backend/api</code>) или твой личный username.
        </p>
        <p className="text-[12px] text-muted-foreground mt-1">
          Один source = один namespace. Если у тебя несколько групп —
          добавь отдельный GitLab-source на каждую; subgroup'ы
          автоматически НЕ включаются.
        </p>
      </Step>

      <Step number={3} title="Подставь в Settings">
        <p>В карточке GitLab-источника:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Название</strong>:
            свободная подпись (видна в списке проектов)
          </li>
          <li>
            <strong className="text-foreground">Namespace</strong>: из
            шага 2
          </li>
          <li>
            <strong className="text-foreground">GitLab username</strong>:
            твой логин (используется в clone URL как подсказка системному
            git credential manager'у)
          </li>
          <li>
            <strong className="text-foreground">Personal Access Token</strong>:
            из шага 1
          </li>
          <li>
            <strong className="text-foreground">Base URL</strong>{' '}
            (только для self-hosted): полный URL твоего GitLab-инстанса,
            например <code>https://gitlab.mycorp.com</code>
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
            : токен неверный, истёк или revoked. Проверь дату истечения,
            пересоздай при необходимости.
          </li>
          <li>
            <strong className="text-foreground">
              «Forbidden (403) … lacks required scope»
            </strong>
            : у токена нет <code>read_api</code> или{' '}
            <code>read_repository</code>. Поправь scope'ы или создай
            новый токен с обоими.
          </li>
          <li>
            <strong className="text-foreground">
              Пустой список репо
            </strong>
            : проверь namespace path. Группа <code>acme</code> листает
            только проекты прямо под <em>acme/</em>, не под{' '}
            <em>acme/sub/</em>. Добавь ещё один source на subgroup или
            укажи более глубокий путь.
          </li>
          <li>
            <strong className="text-foreground">
              Self-hosted инстанс выдаёт 404
            </strong>
            : проверь Base URL. WorkHelper сам добавляет{' '}
            <code>/api/v4</code> — указывай только корень (например{' '}
            <code>https://gitlab.mycorp.com</code>), без trailing slash
            и без path'а.
          </li>
        </ul>
      </Section>
    </GuideShell>
  )
}

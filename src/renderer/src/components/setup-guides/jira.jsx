import { GuideShell, Section, Step, ExtLink } from './_shared'
import { useLang } from '@/i18n'

export function JiraSetupGuide() {
  const lang = useLang()
  return lang === 'ru' ? <JiraSetupGuideRu /> : <JiraSetupGuideEn />
}

function JiraSetupGuideEn() {
  return (
    <GuideShell>
      <Section title="What you'll need">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Atlassian email</strong>{' '}
            — same as the Bitbucket section above; it's reused.
          </li>
          <li>
            <strong className="text-foreground">Jira host URL</strong>{' '}
            — typically <code>https://&lt;company&gt;.atlassian.net</code>
          </li>
          <li>
            <strong className="text-foreground">Jira API token</strong>{' '}
            — <em>separate</em> from the Bitbucket one. Atlassian
            issues one token per product.
          </li>
        </ul>
        <p className="text-[12px]">
          Two tokens may sound annoying, but it's how Atlassian
          works. Total time setup ~2 minutes once you've done
          Bitbucket.
        </p>
      </Section>

      <Step number={1} title="Create the Jira API token">
        <p>
          Open{' '}
          <ExtLink href="https://id.atlassian.com/manage-profile/security/api-tokens">
            id.atlassian.com → Security → API tokens
          </ExtLink>
          .
        </p>
        <p>
          As with Bitbucket,{' '}
          <strong className="text-foreground">
            click "Create API token"
          </strong>
          {' '}— the one <em>without</em> "with scopes". Scoped Jira
          tokens have a known Atlassian bug where{' '}
          <code>currentUser()</code> in JQL doesn't resolve under
          Bearer auth, which makes "My Tasks" look empty. Classic
          tokens use Basic auth, JQL works, everything works.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Name it "WorkHelper Jira" or similar</li>
          <li>
            <strong className="text-foreground">Copy the token now</strong>{' '}
            — only shown once.
          </li>
        </ul>
      </Step>

      <Step number={2} title="Find your Jira host URL">
        <p>
          Open Jira in a browser and look at the URL. The format is{' '}
          <code className="text-foreground">
            https://&lt;company&gt;.atlassian.net/jira/...
          </code>
          . Copy just the protocol + domain part — paste{' '}
          <code className="text-foreground">
            https://&lt;company&gt;.atlassian.net
          </code>
          {' '}without trailing slash and without any path.
        </p>
        <p className="text-[12px]">
          Pasting the full URL with{' '}
          <code>/jira/for-you</code> on the end is fine — the app
          strips the path automatically.
        </p>
      </Step>

      <Step number={3} title="Plug values into Settings">
        <p>In the Jira card:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Host</strong>: the URL
            from step 2
          </li>
          <li>
            <strong className="text-foreground">API token</strong>:
            from step 1
          </li>
          <li>
            (Email is reused from the Bitbucket card — same Atlassian
            account.)
          </li>
        </ul>
        <p>
          Click <strong className="text-foreground">Save</strong>, then{' '}
          <strong className="text-foreground">Test Jira</strong>. Should
          show <span className="text-emerald-400">Authenticated as
          &lt;your name&gt;</span>.
        </p>
      </Step>

      <Section title="What you get">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">My Tasks</strong> in
            sidebar — every open issue assigned to you across every
            Jira project, grouped by status.
          </li>
          <li>
            <strong className="text-foreground">Tasks tab</strong> in
            each Bitbucket project drawer — open tasks for the matching
            Jira project, split into "Assigned to you" / "Other open" /
            "Recently done".
          </li>
          <li>
            <strong className="text-foreground">Counts on the project list</strong>
            {' '}— projects with assigned tasks pin to the top with a{' '}
            <span className="font-mono">📋 N</span> chip.
          </li>
          <li>
            <strong className="text-foreground">In-app actions</strong>:
            comment, reassign, change status without leaving WorkHelper.
          </li>
        </ul>
      </Section>

      <Section title="How project ↔ task linking works">
        <p>
          The app maps a Jira project to a Bitbucket repo by name.
          A Jira project name like{' '}
          <code className="text-foreground">
            p0066- Zeiad Jewellery (Amjad)
          </code>{' '}
          is matched to the Bitbucket repo whose slug is the leading
          part —{' '}
          <code className="text-foreground">p0066</code> in this case.
          Anything before the first non-alnum character.
        </p>
        <p>
          If a task's title mentions a different slug than the project
          it lives in (e.g. issue PZJA-5 in project for{' '}
          <code>p0066</code> but the title says{' '}
          <em>"p0067 fix login"</em>), the row gets an amber{' '}
          <strong className="text-foreground">mismatch</strong> badge
          with a tooltip — to flag the common "created in the wrong
          project" mistake.
        </p>
      </Section>

      <Section title="Troubleshooting" className="pt-1 border-t border-border/40">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">
              "Authentication failed (401)"
            </strong>
            : same playbook as Bitbucket — token wrong, email
            mismatch, or extra whitespace. Recreate the token.
          </li>
          <li>
            <strong className="text-foreground">"My Tasks" shows empty
            but you have assigned issues</strong>: you almost certainly
            created a scoped token. JQL <code>currentUser()</code>
            {' '}returns nothing under Bearer auth. Switch to a classic
            token (step 1).
          </li>
          <li>
            <strong className="text-foreground">"No Jira project matches
            this slug"</strong> in a project Tasks tab: Jira project
            name doesn't start with the Bitbucket slug. Either rename
            the Jira project to match, or this just means there's no
            corresponding Jira side for this repo.
          </li>
          <li>
            <strong className="text-foreground">410 / "API has been
            removed"</strong>: Atlassian retired the legacy{' '}
            <code>/rest/api/3/search</code> endpoint in 2026. Update
            the app — newer versions use the new{' '}
            <code>/rest/api/3/search/jql</code> endpoint.
          </li>
        </ul>
      </Section>
    </GuideShell>
  )
}

function JiraSetupGuideRu() {
  return (
    <GuideShell>
      <Section title="Что понадобится">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Email Atlassian</strong>{' '}
            — тот же, что в карточке Bitbucket выше; переиспользуется.
          </li>
          <li>
            <strong className="text-foreground">Jira host URL</strong>{' '}
            — обычно <code>https://&lt;company&gt;.atlassian.net</code>
          </li>
          <li>
            <strong className="text-foreground">API-токен Jira</strong>{' '}
            — <em>отдельный</em> от Bitbucket. Atlassian выпускает по
            одному токену на продукт.
          </li>
        </ul>
        <p className="text-[12px]">
          Два токена звучат как лишняя возня, но так устроен Atlassian.
          Когда Bitbucket уже настроен, сюда уйдёт ~2 минуты.
        </p>
      </Section>

      <Step number={1} title="Создайте Jira API-токен">
        <p>
          Откройте{' '}
          <ExtLink href="https://id.atlassian.com/manage-profile/security/api-tokens">
            id.atlassian.com → Security → API tokens
          </ExtLink>
          .
        </p>
        <p>
          Как и для Bitbucket,{' '}
          <strong className="text-foreground">
            нажмите «Create API token»
          </strong>
          {' '}— ту, что <em>без</em> «with scopes». У scoped-токенов Jira
          есть известный баг Atlassian: <code>currentUser()</code> в JQL
          не резолвится при Bearer-авторизации, и «My Tasks» оказывается
          пустым. Классические токены работают через Basic auth, JQL
          работает, всё работает.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Назовите токен «WorkHelper Jira» или похоже</li>
          <li>
            <strong className="text-foreground">Скопируйте токен сразу</strong>{' '}
            — показывается только один раз.
          </li>
        </ul>
      </Step>

      <Step number={2} title="Найдите Jira host URL">
        <p>
          Откройте Jira в браузере и посмотрите URL. Формат:{' '}
          <code className="text-foreground">
            https://&lt;company&gt;.atlassian.net/jira/...
          </code>
          . Скопируйте только протокол + домен — вставьте{' '}
          <code className="text-foreground">
            https://&lt;company&gt;.atlassian.net
          </code>
          {' '}без слэша на конце и без пути.
        </p>
        <p className="text-[12px]">
          Можно вставить и полный URL с{' '}
          <code>/jira/for-you</code> на конце — приложение само обрежет
          путь.
        </p>
      </Step>

      <Step number={3} title="Подставьте значения в Settings">
        <p>В карточке Jira:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Host</strong>: URL из
            шага 2
          </li>
          <li>
            <strong className="text-foreground">API-токен</strong>:
            из шага 1
          </li>
          <li>
            (Email берётся из карточки Bitbucket — это тот же аккаунт
            Atlassian.)
          </li>
        </ul>
        <p>
          Нажмите <strong className="text-foreground">Save</strong>, затем{' '}
          <strong className="text-foreground">Test Jira</strong>. Должно
          показать <span className="text-emerald-400">Authenticated as
          &lt;ваше имя&gt;</span>.
        </p>
      </Step>

      <Section title="Что вы получаете">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">My Tasks</strong> в
            сайдбаре — все открытые задачи, назначенные на вас, по всем
            Jira-проектам, сгруппированные по статусу.
          </li>
          <li>
            <strong className="text-foreground">Вкладка Tasks</strong> в
            drawer'е каждого проекта Bitbucket — открытые задачи
            соответствующего Jira-проекта, разбитые на «Assigned to
            you» / «Other open» / «Recently done».
          </li>
          <li>
            <strong className="text-foreground">Счётчики в списке проектов</strong>
            {' '}— проекты с назначенными задачами поднимаются вверх с
            чипом <span className="font-mono">📋 N</span>.
          </li>
          <li>
            <strong className="text-foreground">Действия в приложении</strong>:
            комментарии, переназначение, смена статуса — не выходя из
            WorkHelper.
          </li>
        </ul>
      </Section>

      <Section title="Как связываются проект ↔ задача">
        <p>
          Приложение сопоставляет Jira-проект с Bitbucket-репозиторием
          по имени. Например, имя Jira-проекта{' '}
          <code className="text-foreground">
            p0066- Zeiad Jewellery (Amjad)
          </code>{' '}
          сматчится с Bitbucket-репо, у которого slug совпадает с
          ведущей частью —{' '}
          <code className="text-foreground">p0066</code>. Берётся всё
          до первого не-alnum символа.
        </p>
        <p>
          Если в заголовке задачи упомянут slug, отличающийся от
          проекта, в котором она находится (например задача PZJA-5 в
          проекте под <code>p0066</code>, а в заголовке —{' '}
          <em>«p0067 fix login»</em>), на строку добавляется янтарный
          бейдж <strong className="text-foreground">mismatch</strong> с
          тултипом — это защита от типичной ошибки «создал задачу не в
          том проекте».
        </p>
      </Section>

      <Section title="Что делать если" className="pt-1 border-t border-border/40">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">
              «Authentication failed (401)»
            </strong>
            : тот же сценарий, что для Bitbucket — токен неверный,
            email не совпадает или лишний пробел. Создайте токен заново.
          </li>
          <li>
            <strong className="text-foreground">«My Tasks» пуст, хотя
            на вас есть задачи</strong>: почти наверняка вы создали
            scoped-токен. JQL <code>currentUser()</code> возвращает
            ничего при Bearer-авторизации. Перейдите на классический
            токен (шаг 1).
          </li>
          <li>
            <strong className="text-foreground">«No Jira project matches
            this slug»</strong> во вкладке Tasks проекта: имя
            Jira-проекта не начинается со slug Bitbucket. Либо
            переименуйте Jira-проект, либо это значит, что у репо
            просто нет соответствующего Jira.
          </li>
          <li>
            <strong className="text-foreground">410 / «API has been
            removed»</strong>: Atlassian отключил старый эндпоинт{' '}
            <code>/rest/api/3/search</code> в 2026. Обновите приложение
            — новые версии используют новый{' '}
            <code>/rest/api/3/search/jql</code>.
          </li>
        </ul>
      </Section>
    </GuideShell>
  )
}

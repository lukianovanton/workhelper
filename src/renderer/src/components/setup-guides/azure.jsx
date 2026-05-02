import { GuideShell, Section, Step, ExtLink } from './_shared'
import { useLang } from '@/i18n'

export function AzureDevOpsSetupGuide() {
  const lang = useLang()
  return lang === 'ru' ? <AzureSetupGuideRu /> : <AzureSetupGuideEn />
}

function AzureSetupGuideEn() {
  return (
    <GuideShell>
      <Section title="What you'll need">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Organization</strong> —
            your Azure DevOps org slug (the part after{' '}
            <code>dev.azure.com/</code>). E.g. for{' '}
            <code>https://dev.azure.com/mycompany/MyProject</code> the
            org is <code>mycompany</code>.
          </li>
          <li>
            <strong className="text-foreground">Personal Access Token</strong>{' '}
            — created at{' '}
            <ExtLink href="https://dev.azure.com">
              dev.azure.com → User settings → Personal access tokens
            </ExtLink>
            . Self-hosted Azure DevOps Server: same path on your
            instance.
          </li>
          <li>
            <strong className="text-foreground">Base URL</strong> — only
            for self-hosted Azure DevOps Server (e.g.{' '}
            <code>https://devops.mycorp.com/tfs/DefaultCollection</code>).
            For dev.azure.com leave blank.
          </li>
        </ul>
        <p className="text-[12px] text-muted-foreground mt-2">
          One source = one organization. All repositories across all
          projects in that org are listed in a flat namespace —
          WorkHelper handles the org → project → repo hierarchy under
          the hood.
        </p>
      </Section>

      <Step number={1} title="Create the token">
        <p>
          Click your avatar (top right at{' '}
          <ExtLink href="https://dev.azure.com">dev.azure.com</ExtLink>)
          → <em>Personal access tokens</em> → <em>+ New Token</em>.
        </p>
        <p>Required scopes (tick these):</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Code: Read</strong> —
            list repos, read commits, branches, tree, raw file content.
          </li>
          <li>
            <strong className="text-foreground">Build: Read</strong> —
            list pipeline runs and timeline (jobs / tasks). Skip this
            only if you don't care about the Pipelines tab.
          </li>
        </ul>
        <p className="text-[12px] text-muted-foreground mt-1">
          Tip: scope your token to the specific organization (Organization
          dropdown at the top of the form). «All accessible
          organizations» works too but is less secure if you have
          access to many orgs.
        </p>
        <p>
          <strong className="text-foreground">Copy the token now</strong>{' '}
          — Azure DevOps shows it only once.
        </p>
      </Step>

      <Step number={2} title="Find your organization slug">
        <p>
          Open any repo URL in a browser. Format:{' '}
          <code className="text-foreground">
            dev.azure.com/&lt;org&gt;/&lt;project&gt;/_git/&lt;repo&gt;
          </code>
          . First segment after the host is your organization.
        </p>
        <p className="text-[12px] text-muted-foreground mt-1">
          Old-style URLs <code>&lt;org&gt;.visualstudio.com</code> still
          work — Microsoft auto-redirects to dev.azure.com. The org
          slug is the same.
        </p>
      </Step>

      <Step number={3} title="Plug values into Settings">
        <p>In the Azure DevOps source card:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Display name</strong>:
            free-form label
          </li>
          <li>
            <strong className="text-foreground">Organization</strong>:
            from step 2
          </li>
          <li>
            <strong className="text-foreground">Username</strong>: your
            email or login (used in clone URLs as a hint to the system
            Git Credential Manager)
          </li>
          <li>
            <strong className="text-foreground">Personal Access Token</strong>:
            paste from step 1
          </li>
          <li>
            <strong className="text-foreground">Base URL</strong>{' '}
            (self-hosted only): full URL of your Azure DevOps Server,
            e.g. <code>https://devops.mycorp.com/tfs/DefaultCollection</code>
          </li>
        </ul>
        <p>
          Save the source, then click <strong>Test connection</strong>.
          You should see «Authenticated as &lt;your name&gt;».
        </p>
      </Step>

      <Section title="Troubleshooting" className="pt-1 border-t border-border/40">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">
              «Authentication failed (401)» or «Authorization rejected (203)»
            </strong>
            : token is wrong, expired, or doesn't have the required
            scope. PATs in Azure DevOps expire — check the date in the
            token list.
          </li>
          <li>
            <strong className="text-foreground">
              Empty repository list
            </strong>
            : either the organization slug is wrong, or the token was
            scoped to a different org. Re-create the token with «All
            accessible organizations» or the specific org you need.
          </li>
          <li>
            <strong className="text-foreground">
              Pipelines tab is empty
            </strong>
            : the token might lack <em>Build: Read</em> scope, or the
            repo simply has no pipeline runs yet. Try running a
            pipeline once in the Azure UI to see if the list populates.
          </li>
          <li>
            <strong className="text-foreground">
              Clone authentication fails
            </strong>
            : after Setup, run <code>git clone</code> once manually to
            cache credentials in the system credential helper. Use any
            value as username and the PAT as password — Azure DevOps
            accepts that combination.
          </li>
        </ul>
      </Section>
    </GuideShell>
  )
}

function AzureSetupGuideRu() {
  return (
    <GuideShell>
      <Section title="Что понадобится">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Organization</strong> —
            slug твоей Azure DevOps org (то, что после{' '}
            <code>dev.azure.com/</code>). Например для{' '}
            <code>https://dev.azure.com/mycompany/MyProject</code> org
            это <code>mycompany</code>.
          </li>
          <li>
            <strong className="text-foreground">Personal Access Token</strong>{' '}
            — создаётся на{' '}
            <ExtLink href="https://dev.azure.com">
              dev.azure.com → User settings → Personal access tokens
            </ExtLink>
            . Для self-hosted Azure DevOps Server — тот же путь на твоём
            инстансе.
          </li>
          <li>
            <strong className="text-foreground">Base URL</strong> —
            только для self-hosted Azure DevOps Server (например{' '}
            <code>https://devops.mycorp.com/tfs/DefaultCollection</code>).
            Для dev.azure.com оставь пустым.
          </li>
        </ul>
        <p className="text-[12px] text-muted-foreground mt-2">
          Один source = одна organization. Все репозитории всех
          проектов в этой org листаются плоским списком — WorkHelper сам
          разруливает иерархию org → project → repo под капотом.
        </p>
      </Section>

      <Step number={1} title="Создай токен">
        <p>
          Кликни по аватарке (вверху справа на{' '}
          <ExtLink href="https://dev.azure.com">dev.azure.com</ExtLink>)
          → <em>Personal access tokens</em> → <em>+ New Token</em>.
        </p>
        <p>Нужные scopes (отметь):</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Code: Read</strong> —
            листать репо, читать коммиты, ветки, дерево файлов, raw
            content.
          </li>
          <li>
            <strong className="text-foreground">Build: Read</strong> —
            видеть pipeline runs и timeline (jobs / tasks). Можно
            пропустить, если таб Pipelines не нужен.
          </li>
        </ul>
        <p className="text-[12px] text-muted-foreground mt-1">
          Совет: ограничь токен конкретной организацией (Organization
          dropdown сверху формы). «All accessible organizations» работает,
          но менее безопасно если у тебя есть доступ к нескольким org.
        </p>
        <p>
          <strong className="text-foreground">Скопируй токен сразу</strong>{' '}
          — Azure DevOps покажет его только один раз.
        </p>
      </Step>

      <Step number={2} title="Найди organization slug">
        <p>
          Открой URL любого репо. Формат:{' '}
          <code className="text-foreground">
            dev.azure.com/&lt;org&gt;/&lt;project&gt;/_git/&lt;repo&gt;
          </code>
          . Первый сегмент после хоста — это organization.
        </p>
        <p className="text-[12px] text-muted-foreground mt-1">
          Старые URL вида <code>&lt;org&gt;.visualstudio.com</code> до
          сих пор работают — Microsoft автоматически редиректит на
          dev.azure.com. Slug org такой же.
        </p>
      </Step>

      <Step number={3} title="Подставь в Settings">
        <p>В карточке Azure DevOps source'а:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong className="text-foreground">Название</strong>:
            свободная подпись
          </li>
          <li>
            <strong className="text-foreground">Organization</strong>:
            из шага 2
          </li>
          <li>
            <strong className="text-foreground">Username</strong>: твой
            email или логин (используется в clone URL как подсказка
            системному Git Credential Manager)
          </li>
          <li>
            <strong className="text-foreground">Personal Access Token</strong>:
            из шага 1
          </li>
          <li>
            <strong className="text-foreground">Base URL</strong>{' '}
            (только для self-hosted): полный URL твоего Azure DevOps
            Server'а, например{' '}
            <code>https://devops.mycorp.com/tfs/DefaultCollection</code>
          </li>
        </ul>
        <p>
          Сохрани источник, нажми <strong>Test connection</strong>.
          Должно показать «Authenticated as &lt;твоё имя&gt;».
        </p>
      </Step>

      <Section title="Что делать если" className="pt-1 border-t border-border/40">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">
              «Authentication failed (401)» или «Authorization rejected (203)»
            </strong>
            : токен неверный, истёк или без нужного scope. PAT'ы у Azure
            DevOps по умолчанию имеют срок — проверь в списке токенов.
          </li>
          <li>
            <strong className="text-foreground">
              Пустой список репо
            </strong>
            : либо неверный organization slug, либо токен ограничен
            другой org. Пересоздай токен с «All accessible organizations»
            или выбери нужную org явно.
          </li>
          <li>
            <strong className="text-foreground">
              Таб Pipelines пустой
            </strong>
            : у токена может не быть scope <em>Build: Read</em>, или у
            репо просто нет ни одного запуска pipeline. Запусти pipeline
            один раз в UI Azure'а чтобы проверить.
          </li>
          <li>
            <strong className="text-foreground">
              Clone-аутентификация падает
            </strong>
            : после Setup один раз сделай <code>git clone</code>{' '}
            вручную чтобы закэшировать креды в credential helper'е. В
            качестве username можно ввести любое значение, а как password
            — PAT. Azure DevOps принимает такую комбинацию.
          </li>
        </ul>
      </Section>
    </GuideShell>
  )
}

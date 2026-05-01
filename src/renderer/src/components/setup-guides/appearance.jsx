import { GuideShell, Section } from './_shared'
import { useLang } from '@/i18n'

export function AppearanceSetupGuide() {
  const lang = useLang()
  return lang === 'ru' ? <AppearanceSetupGuideRu /> : <AppearanceSetupGuideEn />
}

function AppearanceSetupGuideEn() {
  return (
    <GuideShell>
      <Section title="What this is for">
        <p>
          Display preferences for this machine. All four settings are
          stored locally — they don't sync between your devices and
          they aren't part of <code>config.json</code>.
        </p>
      </Section>

      <Section title="Theme">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">Dark</strong> — fixed
            dark UI. Good if you live in a dark editor anyway.
          </li>
          <li>
            <strong className="text-foreground">Light</strong> — fixed
            light UI. Best on bright displays / bright rooms.
          </li>
          <li>
            <strong className="text-foreground">System</strong> — follows
            Windows' theme. Auto-flips when you toggle Windows light
            / dark mode.
          </li>
        </ul>
      </Section>

      <Section title="Density">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">Comfortable</strong> —
            default. Larger rows, descriptions visible under each
            project name. ~24 rows per laptop screen.
          </li>
          <li>
            <strong className="text-foreground">Compact</strong> —
            shorter rows, descriptions hidden, smaller font. ~50 rows
            per screen. Good for scanning a long list of repos.
          </li>
        </ul>
      </Section>

      <Section title="Auto-refresh projects">
        <p>
          How often the projects list refetches Bitbucket data in the
          background — Off / 1 min / 5 min / 10 min. Independent of
          the manual <strong>Refresh</strong> button which you can
          always press.
        </p>
        <p>
          Leave at <strong className="text-foreground">Off</strong> if
          you only check Bitbucket occasionally — the cached list is
          still fast. <strong className="text-foreground">5 min</strong>{' '}
          is a reasonable middle ground; under that you'll burn the
          1000-req/hour Bitbucket rate limit if you have many projects.
        </p>
      </Section>

      <Section title="Highlight search matches">
        <p>
          When typing in the search box, matched substrings in slug /
          name / description are wrapped in a soft amber highlight to
          make them stand out. Pure cosmetics — turn off if you find
          it distracting.
        </p>
      </Section>
    </GuideShell>
  )
}

function AppearanceSetupGuideRu() {
  return (
    <GuideShell>
      <Section title="Зачем это">
        <p>
          Настройки отображения для этой машины. Все четыре опции
          хранятся локально — они не синхронизируются между
          устройствами и не входят в <code>config.json</code>.
        </p>
      </Section>

      <Section title="Тема">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">Dark</strong> —
            фиксированная тёмная тема. Подходит, если вы и так живёте
            в тёмном редакторе.
          </li>
          <li>
            <strong className="text-foreground">Light</strong> —
            фиксированная светлая. Лучше на ярких экранах / в ярком
            помещении.
          </li>
          <li>
            <strong className="text-foreground">System</strong> —
            следует системной теме Windows. Автоматически
            переключается при смене light/dark в системе.
          </li>
        </ul>
      </Section>

      <Section title="Плотность (Density)">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">Comfortable</strong> —
            по умолчанию. Более крупные строки, под названием проекта
            видно описание. ~24 строки на экран ноутбука.
          </li>
          <li>
            <strong className="text-foreground">Compact</strong> —
            более короткие строки, описание скрыто, шрифт меньше. ~50
            строк на экран. Удобно для пробегания длинного списка
            репо глазами.
          </li>
        </ul>
      </Section>

      <Section title="Автообновление проектов">
        <p>
          Как часто список проектов перезапрашивает данные Bitbucket в
          фоне — Off / 1 мин / 5 мин / 10 мин. Не зависит от ручной
          кнопки <strong>Refresh</strong>, её можно жать в любой момент.
        </p>
        <p>
          Оставьте <strong className="text-foreground">Off</strong>, если
          лезете в Bitbucket лишь изредка — кешированный список и так
          быстрый. <strong className="text-foreground">5 мин</strong> —
          разумная середина; ниже этого вы упрётесь в лимит Bitbucket
          1000 запросов/час, если проектов много.
        </p>
      </Section>

      <Section title="Подсветка совпадений в поиске">
        <p>
          При вводе в строку поиска совпадающие подстроки в slug / имени /
          описании оборачиваются в мягкую янтарную подсветку, чтобы
          их было видно. Чистая косметика — выключите, если мешает.
        </p>
      </Section>
    </GuideShell>
  )
}

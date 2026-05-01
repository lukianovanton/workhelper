import { GuideShell, Section } from './_shared'

export function AppearanceSetupGuide() {
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

import { GuideShell, Section, Step } from './_shared'

export function PathsSetupGuide() {
  return (
    <GuideShell>
      <Section title="What this is for">
        <p>
          Three filesystem paths the app needs to know about: where to
          clone repositories, where to look for SQL dumps, and how to
          launch VS Code. All three have sensible defaults — you only
          touch them if your layout differs.
        </p>
      </Section>

      <Step number={1} title="Projects folder">
        <p>
          Where repositories get cloned to. Each repo lives at{' '}
          <code className="text-foreground">
            &lt;projects-root&gt;/&lt;slug&gt;
          </code>
          {' '}— for slug <code>p0066</code> with default root{' '}
          <code>C:\Projects</code>, that's{' '}
          <code>C:\Projects\p0066</code>.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Default <code>C:\Projects</code> is fine for most setups
          </li>
          <li>
            Pick a path with{' '}
            <strong className="text-foreground">
              short top-level segments
            </strong>{' '}
            — Windows has a 260-char path limit and deeply nested .NET
            artifacts blow through it fast
          </li>
          <li>
            Don't pick a OneDrive / Dropbox / iCloud-synced folder —
            file locks during git operations confuse the sync agent
          </li>
        </ul>
      </Step>

      <Step number={2} title="Dumps folder">
        <p>
          Where SQL dumps live. The app auto-detects a dump for each
          slug by name pattern — files like{' '}
          <code className="text-foreground">
            dump-&lt;slug&gt;-&lt;timestamp&gt;
          </code>
          {' '}are matched and shown in the project drawer with a "Restore"
          shortcut.
        </p>
        <p>
          Empty value = dump auto-detect off; you'd then manually pick a
          file every time you restore.
        </p>
      </Step>

      <Step number={3} title="VS Code executable">
        <p>
          What the "Open in VS Code" button calls. By default the app
          tries <code>code</code> in PATH (which is what most VS Code
          installers add).
        </p>
        <p>
          If <code>code</code> isn't in PATH, the app looks for a
          binary in known install locations (
          <code className="text-foreground">
            %LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe
          </code>
          ) and shows a "Use detected" button next to the field.
          Click it.
        </p>
        <p>
          Otherwise paste a full absolute path to{' '}
          <code>Code.exe</code> manually.
        </p>
      </Step>

      <Section title="Troubleshooting" className="pt-1 border-t border-border/40">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">
              "Open in VS Code" does nothing / opens an error
            </strong>
            : the value points at something that doesn't exist or
            isn't VS Code. Click "Use detected" or paste an absolute
            path.
          </li>
          <li>
            <strong className="text-foreground">
              Dumps not auto-detected
            </strong>
            : check the file name format. The app matches{' '}
            <code>dump-&lt;slug&gt;</code> with optional date suffix —
            renaming or different prefix won't be picked up. You can
            still pick a dump file manually from the drawer's "Restore"
            menu.
          </li>
          <li>
            <strong className="text-foreground">
              "Path too long" errors during clone
            </strong>
            : pick a shorter projects-root (e.g.{' '}
            <code>C:\W</code>). Some .NET projects produce build
            outputs deep enough to push individual files past 260
            chars.
          </li>
        </ul>
      </Section>
    </GuideShell>
  )
}

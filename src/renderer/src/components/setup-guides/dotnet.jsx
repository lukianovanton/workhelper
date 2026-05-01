import { GuideShell, Section } from './_shared'

export function DotnetSetupGuide() {
  return (
    <GuideShell>
      <Section title="What this is for">
        <p>
          Extra arguments passed to{' '}
          <code className="text-foreground">dotnet run</code> when you
          click the Run button on a project. Optional — most users
          leave this empty.
        </p>
      </Section>

      <Section title="When you'd set arguments">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">
              <code>--no-build</code>
            </strong>{' '}
            — start the app without rebuilding. Faster iteration if
            you've already built once and only edited Razor pages or
            similar runtime-loaded assets.
          </li>
          <li>
            <strong className="text-foreground">
              <code>--launch-profile Development</code>
            </strong>{' '}
            — pick a specific launchSettings.json profile. Useful if
            the project ships multiple profiles (Development, Staging)
            and you want a non-default.
          </li>
          <li>
            <strong className="text-foreground">
              <code>--urls https://localhost:5005</code>
            </strong>{' '}
            — force a specific binding. The app auto-detects the port
            from process output anyway, so this is rarely needed.
          </li>
        </ul>
      </Section>

      <Section title="Format">
        <p>
          Space-separated. The app passes each token to{' '}
          <code>dotnet run</code> after a <code>--</code> separator,
          so they reach the running app, not the dotnet CLI itself.
          Quoting isn't supported in the field — if you need
          arguments with spaces, set them via launch profile or
          environment variable instead.
        </p>
        <p className="text-[12px]">
          Per-project overrides for the runnable subpath aren't
          exposed here yet. The auto-detector is usually right; if
          it isn't, edit{' '}
          <code className="text-foreground">
            %APPDATA%\project-hub\config.json
          </code>
          {' '}directly under <code>dotnet.workingDirSubpathOverride</code>.
        </p>
      </Section>
    </GuideShell>
  )
}

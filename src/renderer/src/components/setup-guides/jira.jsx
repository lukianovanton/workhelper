import { GuideShell, Section, Step, ExtLink } from './_shared'

export function JiraSetupGuide() {
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

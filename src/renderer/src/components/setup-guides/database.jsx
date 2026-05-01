import { GuideShell, Section, Step } from './_shared'

export function DatabaseSetupGuide() {
  return (
    <GuideShell>
      <Section title="What this is for">
        <p>
          Local MySQL connection. The app uses it to:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Show whether each project's database exists, and its size
            (the green/grey dots and DB-size column on the projects
            list)
          </li>
          <li>Restore SQL dumps with one click from the drawer</li>
          <li>Drop / recreate databases (drawer actions)</li>
        </ul>
        <p>
          Read-only enrichment uses just the connection. Restore
          additionally needs the <code>mysql</code> CLI on disk.
        </p>
      </Section>

      <Step number={1} title="Connection (Host / Port / User)">
        <p>
          Defaults — <code className="text-foreground">localhost</code>{' '}
          : <code className="text-foreground">3306</code> with user{' '}
          <code className="text-foreground">root</code> — match a
          standard local MySQL install. Change them only if you've
          customized your MySQL setup or are connecting to a remote
          server.
        </p>
      </Step>

      <Step number={2} title="Password">
        <p>
          Your MySQL password for the user above. Stored encrypted on
          disk via Electron safeStorage (DPAPI on Windows). The app
          never logs it and never sends it anywhere except localhost.
        </p>
        <p>
          If you forgot it, the simplest reset on a local dev machine
          is reinstalling MySQL or using{' '}
          <code>ALTER USER 'root'@'localhost' IDENTIFIED BY '…'</code>
          {' '}from a session that's already connected.
        </p>
      </Step>

      <Step number={3} title="mysql executable (optional in MVP-1)">
        <p>
          Absolute path to the <code>mysql.exe</code> command-line
          client. Only used by the dump-restore feature — read-only DB
          enrichment works without it.
        </p>
        <p>
          The app tries to detect it from PATH. If it can't, click
          "Use detected" if available, or paste an absolute path. On a
          stock MySQL install the path is typically{' '}
          <code className="text-foreground">
            C:\Program Files\MySQL\MySQL Server 8.x\bin\mysql.exe
          </code>
          .
        </p>
      </Step>

      <Step number={4} title="Test the connection">
        <p>
          Click <strong className="text-foreground">Save</strong>, then{' '}
          <strong className="text-foreground">Test connection</strong>.
          On success you'll see the MySQL version banner.
        </p>
      </Step>

      <Section title="Troubleshooting" className="pt-1 border-t border-border/40">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">
              "ECONNREFUSED" / "connection refused"
            </strong>
            : MySQL isn't running, or it's not listening on the host /
            port you configured. Start MySQL (
            <code>net start MySQL80</code> on Windows) or fix the
            host/port.
          </li>
          <li>
            <strong className="text-foreground">
              "ER_ACCESS_DENIED_ERROR"
            </strong>
            : wrong user or password. Double-check by connecting via{' '}
            <code>mysql -u root -p</code> in a terminal — if that
            fails, the app will too.
          </li>
          <li>
            <strong className="text-foreground">
              "mysql executable not found"
            </strong>{' '}
            (during a restore): the path to <code>mysql.exe</code> is
            missing or wrong. Read-only operations still work; only
            restore needs it.
          </li>
          <li>
            <strong className="text-foreground">
              Dumps restore but app doesn't see the database
            </strong>
            : the connect-as user might not have permission to see the
            new schema (rare). Restart by doing a fresh{' '}
            <strong>Refresh</strong> in the projects list.
          </li>
        </ul>
      </Section>
    </GuideShell>
  )
}

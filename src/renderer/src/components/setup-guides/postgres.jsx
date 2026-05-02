import { GuideShell, Section, Step } from './_shared'

/**
 * Setup guide для PostgreSQL-подключения. RU-вариант появится в
 * следующем релизе вместе с переводами других секций; пока возвращаем
 * EN всегда — useT() / useLang() вернут английские строки fallback'ом.
 */
export function PostgresSetupGuide() {
  return (
    <GuideShell>
      <Section title="What this is for">
        <p>
          Local or remote PostgreSQL connection. The app uses it to:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Show whether each project's database exists, and its size,
            on the projects list
          </li>
          <li>Restore plain SQL or custom-format dumps from the drawer</li>
          <li>Drop / recreate databases (drawer actions)</li>
        </ul>
        <p>
          Read-only enrichment uses just the connection. Restore
          additionally needs <code>psql</code> or <code>pg_restore</code>{' '}
          on disk.
        </p>
      </Section>

      <Step number={1} title="Connection (Host / Port / User)">
        <p>
          Defaults — <code className="text-foreground">localhost</code>{' '}
          : <code className="text-foreground">5432</code> with user{' '}
          <code className="text-foreground">postgres</code> — match a
          standard local Postgres install. Change them only if you've
          customized your setup or are connecting to a remote server.
        </p>
      </Step>

      <Step number={2} title="Password">
        <p>
          Your Postgres password for the user above. Stored encrypted on
          disk via Electron safeStorage (DPAPI on Windows). The app
          never logs it and never sends it anywhere except the host
          you configured.
        </p>
        <p>
          On a stock Postgres install that uses peer / md5 auth via{' '}
          <code>pg_hba.conf</code>, password may not be required for
          local connections — leave the field empty in that case.
        </p>
      </Step>

      <Step number={3} title="psql / pg_restore executable (optional)">
        <p>
          Path to the Postgres CLI tools. Only used by the dump-restore
          feature — read-only DB enrichment works without it.
        </p>
        <p>
          You can point at:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            the absolute path to <code>psql.exe</code> or{' '}
            <code>pg_restore.exe</code> (the other binary is assumed to
            sit alongside);
          </li>
          <li>
            the <code>bin/</code> directory of your Postgres install
            (e.g.{' '}
            <code className="text-foreground">
              C:\Program Files\PostgreSQL\16\bin
            </code>
            );
          </li>
          <li>
            empty — and <code>psql</code> / <code>pg_restore</code>{' '}
            from <code>PATH</code> will be used.
          </li>
        </ul>
      </Step>

      <Step number={4} title="Test the connection">
        <p>
          Click <strong className="text-foreground">Test connection</strong>.
          On success you'll see the Postgres version banner.
        </p>
      </Step>

      <Section title="Dump formats" className="pt-1 border-t border-border/40">
        <p>The app auto-detects format by the file's first bytes:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">Custom format</strong>{' '}
            (header starts with <code>PGDMP</code> — produced by{' '}
            <code>pg_dump -Fc</code>): restored with{' '}
            <code>pg_restore --no-owner --no-privileges</code>.
          </li>
          <li>
            <strong className="text-foreground">Plain SQL</strong>{' '}
            (anything else, including SQL dumps from{' '}
            <code>pg_dump -Fp</code>): piped into{' '}
            <code>psql --single-transaction --set ON_ERROR_STOP=1</code>{' '}
            so the restore is atomic.
          </li>
          <li>
            <strong className="text-foreground">.gz dumps</strong>{' '}
            are decompressed on the fly (only meaningful for plain
            SQL — custom format is already compressed internally).
          </li>
        </ul>
      </Section>

      <Section title="Troubleshooting">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">
              «password authentication failed»
            </strong>
            : wrong user or password. Check via{' '}
            <code>psql -U &lt;user&gt; -h &lt;host&gt;</code> in a
            terminal — if that fails, the app will too.
          </li>
          <li>
            <strong className="text-foreground">
              «connection refused»
            </strong>
            : Postgres isn't running, or it's not listening on the
            host / port configured. On Windows: check «pgsql-16»
            service in services.msc. Also check{' '}
            <code>postgresql.conf</code> →{' '}
            <code>listen_addresses</code> for remote setups.
          </li>
          <li>
            <strong className="text-foreground">
              «pg_restore / psql executable not found»
            </strong>{' '}
            during a restore: set the path in the Settings field above.
            Read-only operations still work; only restore needs it.
          </li>
          <li>
            <strong className="text-foreground">
              Restore fails on a custom-format dump that's also gzipped
            </strong>
            : pg_restore's input must not be gzip-wrapped. Re-run{' '}
            <code>pg_dump</code> without external gzip (the custom
            format already compresses), or unzip the dump first.
          </li>
        </ul>
      </Section>
    </GuideShell>
  )
}

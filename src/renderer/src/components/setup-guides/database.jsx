import { GuideShell, Section, Step } from './_shared'
import { useLang } from '@/i18n'

export function DatabaseSetupGuide() {
  const lang = useLang()
  return lang === 'ru' ? <DatabaseSetupGuideRu /> : <DatabaseSetupGuideEn />
}

function DatabaseSetupGuideEn() {
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

function DatabaseSetupGuideRu() {
  return (
    <GuideShell>
      <Section title="Зачем это">
        <p>
          Локальное подключение к MySQL. Приложение использует его чтобы:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Показывать, существует ли БД для каждого проекта, и её
            размер (зелёные/серые точки и колонка DB-size в списке
            проектов)
          </li>
          <li>В один клик восстанавливать SQL-дампы из drawer'а</li>
          <li>Удалять / пересоздавать БД (действия в drawer'е)</li>
        </ul>
        <p>
          Для read-only обогащения хватает самого подключения. Для
          restore дополнительно нужен <code>mysql</code> CLI на диске.
        </p>
      </Section>

      <Step number={1} title="Подключение (Host / Port / User)">
        <p>
          Значения по умолчанию —{' '}
          <code className="text-foreground">localhost</code>{' '}
          : <code className="text-foreground">3306</code> с пользователем{' '}
          <code className="text-foreground">root</code> — соответствуют
          стандартной локальной установке MySQL. Меняйте только если
          у вас кастомная конфигурация или подключение к удалённому
          серверу.
        </p>
      </Step>

      <Step number={2} title="Пароль">
        <p>
          Ваш пароль MySQL для указанного пользователя. Хранится на
          диске зашифрованно через Electron safeStorage (DPAPI на
          Windows). Приложение его не логирует и не шлёт никуда, кроме
          localhost.
        </p>
        <p>
          Если забыли — на локальной dev-машине проще всего
          переустановить MySQL или выполнить{' '}
          <code>ALTER USER 'root'@'localhost' IDENTIFIED BY '…'</code>
          {' '}из уже подключённой сессии.
        </p>
      </Step>

      <Step number={3} title="Исполняемый файл mysql (опционально в MVP-1)">
        <p>
          Абсолютный путь к CLI-клиенту <code>mysql.exe</code>.
          Используется только для восстановления дампов — read-only
          обогащение БД работает без него.
        </p>
        <p>
          Приложение пытается найти его в PATH. Если не удалось,
          жмите «Use detected», если доступно, или вставьте
          абсолютный путь. При стандартной установке MySQL путь
          обычно такой:{' '}
          <code className="text-foreground">
            C:\Program Files\MySQL\MySQL Server 8.x\bin\mysql.exe
          </code>
          .
        </p>
      </Step>

      <Step number={4} title="Проверьте подключение">
        <p>
          Нажмите <strong className="text-foreground">Save</strong>, затем{' '}
          <strong className="text-foreground">Test connection</strong>.
          При успехе увидите баннер с версией MySQL.
        </p>
      </Step>

      <Section title="Что делать если" className="pt-1 border-t border-border/40">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">
              «ECONNREFUSED» / «connection refused»
            </strong>
            : MySQL не запущен, или не слушает указанный host / port.
            Запустите MySQL (<code>net start MySQL80</code> на
            Windows) или поправьте host/port.
          </li>
          <li>
            <strong className="text-foreground">
              «ER_ACCESS_DENIED_ERROR»
            </strong>
            : неверный user или пароль. Проверьте через{' '}
            <code>mysql -u root -p</code> в терминале — если там
            ошибка, в приложении тоже будет.
          </li>
          <li>
            <strong className="text-foreground">
              «mysql executable not found»
            </strong>{' '}
            (во время restore): путь до <code>mysql.exe</code> не
            указан или неверный. Read-only операции продолжают
            работать; путь нужен только для restore.
          </li>
          <li>
            <strong className="text-foreground">
              Дампы восстанавливаются, но приложение не видит БД
            </strong>
            : у connect-as пользователя может не быть прав видеть новую
            схему (редко). Сделайте{' '}
            <strong>Refresh</strong> в списке проектов.
          </li>
        </ul>
      </Section>
    </GuideShell>
  )
}

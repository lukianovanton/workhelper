import { GuideShell, Section, ExtLink } from './_shared'
import { useLang } from '@/i18n'

export function PresenceSetupGuide() {
  const lang = useLang()
  return lang === 'ru' ? <PresenceSetupGuideRu /> : <PresenceSetupGuideEn />
}

function PresenceSetupGuideEn() {
  return (
    <GuideShell>
      <Section title="What it does">
        <p>
          Shows you which colleagues currently have WorkHelper open.
          Each running instance broadcasts a small UDP heartbeat
          packet over your local network; other instances pick it up
          and the count appears in the top-right corner of the
          projects list.
        </p>
        <p>
          Click the count to see the list of online users and what
          they're each running.
        </p>
      </Section>

      <Section title="Network requirements">
        <p>
          Presence works as long as you're on the same network as
          your colleagues. Two common setups:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">
              <ExtLink href="https://tailscale.com/">
                Tailscale
              </ExtLink>
            </strong>{' '}
            — recommended for distributed teams. Everyone joins the
            same tailnet, presence packets traverse it automatically.
            Free for personal use, no router config.
          </li>
          <li>
            <strong className="text-foreground">Same physical LAN</strong>{' '}
            — works in office. Presence broadcasts on UDP port 41789
            within the local broadcast domain.
          </li>
        </ul>
        <p>
          If you're on different networks with no VPN/Tailscale
          between you, you won't see each other. That's expected.
        </p>
      </Section>

      <Section title="What gets shared">
        <p>Each broadcast contains:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Your machine's hostname</li>
          <li>Your Windows username</li>
          <li>Your local IP address (the one bound to the network)</li>
          <li>The WorkHelper version you're running</li>
          <li>How long you've been running</li>
        </ul>
        <p>
          That's it — no project state, no credentials, no Bitbucket
          or Jira data is broadcast. Heartbeat is one packet every
          few seconds.
        </p>
      </Section>

      <Section title="Privacy">
        <p>
          <strong className="text-foreground">Off by default.</strong>{' '}
          Toggle it on only if you actually want colleagues to see
          you. You can flip it off any time — running instances stop
          sending packets immediately, and others' presence lists
          drop you from view within 60 seconds.
        </p>
      </Section>
    </GuideShell>
  )
}

function PresenceSetupGuideRu() {
  return (
    <GuideShell>
      <Section title="Что это делает">
        <p>
          Показывает, у кого из коллег сейчас открыт WorkHelper.
          Каждый запущенный инстанс шлёт маленький UDP-heartbeat по
          локальной сети; другие инстансы его принимают, и счётчик
          появляется в правом верхнем углу списка проектов.
        </p>
        <p>
          Кликните на счётчик чтобы увидеть список online-пользователей
          и что у каждого запущено.
        </p>
      </Section>

      <Section title="Требования к сети">
        <p>
          Presence работает, пока вы в одной сети с коллегами. Два
          типичных варианта:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <strong className="text-foreground">
              <ExtLink href="https://tailscale.com/">
                Tailscale
              </ExtLink>
            </strong>{' '}
            — рекомендуется для распределённых команд. Все
            подключаются в один tailnet, presence-пакеты ходят через
            него автоматически. Для личного использования бесплатно,
            настраивать роутер не надо.
          </li>
          <li>
            <strong className="text-foreground">Одна физическая LAN</strong>{' '}
            — работает в офисе. Presence шлёт broadcast по UDP-порту
            41789 в пределах локального broadcast-домена.
          </li>
        </ul>
        <p>
          Если вы в разных сетях, и между вами нет VPN/Tailscale, друг
          друга вы не увидите. Это ожидаемо.
        </p>
      </Section>

      <Section title="Что передаётся">
        <p>В каждом broadcast'е:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Hostname машины</li>
          <li>Windows-username</li>
          <li>Локальный IP (тот, что забинден на сеть)</li>
          <li>Версия WorkHelper</li>
          <li>Сколько времени запущено</li>
        </ul>
        <p>
          И всё — никакого состояния проектов, никаких учётных данных,
          никаких данных Bitbucket или Jira. Heartbeat — один пакет в
          несколько секунд.
        </p>
      </Section>

      <Section title="Приватность">
        <p>
          <strong className="text-foreground">По умолчанию выключено.</strong>{' '}
          Включайте только если действительно хотите, чтобы коллеги
          вас видели. Выключить можно в любой момент — запущенные
          инстансы сразу прекращают слать пакеты, и через ~60 секунд
          вы пропадаете из списков у других.
        </p>
      </Section>
    </GuideShell>
  )
}

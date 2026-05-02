/**
 * Renderer-side реестр VCS-провайдеров. Содержит UI-метаданные:
 * иконки/цвета бейджа, форму SourceCard (какие поля показывать,
 * как биндить gitUsername, плейсхолдеры/i18n-ключи), id setup-гайда,
 * fallback-name.
 *
 * Backend имеет свой реестр в src/main/services/vcs/providers.js
 * (фабрики, idPrefix). Эти два — одна правда о том, какие провайдеры
 * поддерживаются, но физически разделены: иконки = JSX-компоненты,
 * фабрики = Node imports, через IPC не передать.
 *
 * Добавление нового провайдера (GitLab, Azure DevOps, etc.):
 *   1. Добавить factory в src/main/services/vcs/providers.js
 *   2. Добавить descriptor сюда
 *   3. Готово — SourceCard / SourceBadge / Add-buttons / SETUP_GUIDES
 *      подхватят автоматически.
 */

import { Cloud, Github, Gitlab } from 'lucide-react'
import { BitbucketSetupGuide } from '@/components/setup-guides/bitbucket'
import { GitHubSetupGuide } from '@/components/setup-guides/github'
import { GitLabSetupGuide } from '@/components/setup-guides/gitlab'

/**
 * @typedef {Object} VcsProviderForm
 * @property {string} workspaceLabelKey
 * @property {string} workspaceHintKey
 * @property {string} workspacePlaceholder
 * @property {string} namePlaceholder
 * @property {boolean} showEmailField           отдельное поле email/username
 *                                                до workspace (BB Atlassian
 *                                                Basic Auth). У GitHub нет.
 * @property {string} [emailLabelKey]
 * @property {string} [emailHintKey]
 * @property {string} [emailPlaceholder]
 * @property {string} gitUsernameLabelKey
 * @property {string} gitUsernameHintKey
 * @property {string} gitUsernamePlaceholder
 * @property {boolean} gitUsernameMirrorsUsername  если true: gitUsername
 *                                                = username (один логин,
 *                                                как у GitHub). Если false:
 *                                                отдельные поля (BB).
 * @property {string} tokenLabelKey
 * @property {string} tokenHintKey
 *
 * @typedef {Object} ProviderOptionField
 * @property {string} key                      ключ в source.providerOptions
 * @property {string} labelKey                 i18n-ключ
 * @property {string} hintKey                  i18n-ключ для hint-текста
 * @property {string} placeholder
 *
 * @typedef {Object} VcsProviderDescriptor
 * @property {string} type                     id (= ключ в backend providers.js)
 * @property {string} label                    human-readable для UI dropdown'а
 *                                                и subtitle карточки
 * @property {React.ComponentType<{size?:number, className?:string}>} BadgeIcon
 * @property {string} badgeClassName           tailwind-класс цвета бейджа
 * @property {string} addButtonLabelKey        i18n-ключ для «+ Add ...»
 * @property {React.ComponentType} GuideComponent
 * @property {string} guideTitleKey
 * @property {string} guideDescriptionKey
 * @property {VcsProviderForm} form
 * @property {ProviderOptionField[]} [providerOptionsFields]
 *                                              опциональные поля под
 *                                              source.providerOptions —
 *                                              рендерятся после стандартных
 *                                              полей и сохраняются в
 *                                              source.providerOptions[key].
 *                                              Пример: GitLab baseUrl для
 *                                              self-hosted; BB templatePrefix.
 */

/** @type {Record<string, VcsProviderDescriptor>} */
export const VCS_PROVIDERS = {
  bitbucket: {
    type: 'bitbucket',
    label: 'Bitbucket',
    BadgeIcon: Cloud,
    badgeClassName: 'text-sky-500/70',
    addButtonLabelKey: 'settings.sources.add.bitbucket',
    newSourceTitleKey: 'settings.sources.newSource.bitbucket',
    GuideComponent: BitbucketSetupGuide,
    guideTitleKey: 'settings.bitbucket.title',
    guideDescriptionKey: 'settings.guide.bitbucket.dialogDescription',
    form: {
      workspaceLabelKey: 'settings.bitbucket.workspace',
      workspaceHintKey: 'settings.bitbucket.workspace.hint',
      workspacePlaceholder: 'techgurusit',
      namePlaceholder: 'techgurusit',
      showEmailField: true,
      emailLabelKey: 'settings.bitbucket.email',
      emailHintKey: 'settings.bitbucket.email.hint',
      emailPlaceholder: 'you@example.com',
      gitUsernameLabelKey: 'settings.bitbucket.gitUsername',
      gitUsernameHintKey: 'settings.bitbucket.gitUsername.hint',
      gitUsernamePlaceholder: 'antonreact1',
      gitUsernameMirrorsUsername: false,
      tokenLabelKey: 'settings.bitbucket.apiToken',
      tokenHintKey: 'settings.bitbucket.apiToken.hint'
    }
  },
  github: {
    type: 'github',
    label: 'GitHub',
    BadgeIcon: Github,
    badgeClassName: 'text-muted-foreground/60',
    addButtonLabelKey: 'settings.sources.add.github',
    newSourceTitleKey: 'settings.sources.newSource.github',
    GuideComponent: GitHubSetupGuide,
    guideTitleKey: 'settings.github.guide.title',
    guideDescriptionKey: 'settings.guide.github.dialogDescription',
    form: {
      workspaceLabelKey: 'settings.github.owner',
      workspaceHintKey: 'settings.github.owner.hint',
      workspacePlaceholder: 'octocat',
      namePlaceholder: 'GitHub',
      showEmailField: false,
      gitUsernameLabelKey: 'settings.github.gitUsername',
      gitUsernameHintKey: 'settings.github.gitUsername.hint',
      gitUsernamePlaceholder: 'octocat',
      gitUsernameMirrorsUsername: true,
      tokenLabelKey: 'settings.github.token',
      tokenHintKey: 'settings.github.token.hint'
    }
  },
  gitlab: {
    type: 'gitlab',
    label: 'GitLab',
    BadgeIcon: Gitlab,
    badgeClassName: 'text-orange-500/80',
    addButtonLabelKey: 'settings.sources.add.gitlab',
    newSourceTitleKey: 'settings.sources.newSource.gitlab',
    GuideComponent: GitLabSetupGuide,
    guideTitleKey: 'settings.gitlab.guide.title',
    guideDescriptionKey: 'settings.guide.gitlab.dialogDescription',
    form: {
      workspaceLabelKey: 'settings.gitlab.namespace',
      workspaceHintKey: 'settings.gitlab.namespace.hint',
      workspacePlaceholder: 'my-team',
      namePlaceholder: 'GitLab',
      // Как у GitHub: один логин, никакого отдельного email-поля.
      showEmailField: false,
      gitUsernameLabelKey: 'settings.gitlab.gitUsername',
      gitUsernameHintKey: 'settings.gitlab.gitUsername.hint',
      gitUsernamePlaceholder: 'octocat',
      gitUsernameMirrorsUsername: true,
      tokenLabelKey: 'settings.gitlab.token',
      tokenHintKey: 'settings.gitlab.token.hint'
    },
    // Self-hosted GitLab требует свой Base URL. Для gitlab.com поле
    // оставляется пустым — провайдер default'ит на 'https://gitlab.com'.
    providerOptionsFields: [
      {
        key: 'baseUrl',
        labelKey: 'settings.gitlab.baseUrl',
        hintKey: 'settings.gitlab.baseUrl.hint',
        placeholder: 'https://gitlab.com'
      }
    ]
  }
}

export function getVcsProvider(type) {
  return VCS_PROVIDERS[type] || null
}

export function listVcsProviders() {
  return Object.values(VCS_PROVIDERS)
}

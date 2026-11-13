// A route describes its preview as data. The same tags serve the site's
// files, drawn pages, sign-in cards and hosted apps.
import { h } from 'preact'
import { renderToString } from 'preact-render-to-string'
import { type Host, url } from '@yaks/platform/host'
import { managed, onZone, route } from '@yaks/platform/routes'

export type Preview = {
  title: string
  description?: string
  image?: string
  at?: string
}

export let DEFAULT: Preview = {
  title: 'yaks.app',
  description: 'Build, host and share web apps.',
}

export let fields = (env: Host, of: Preview) => {
  let title = of.title
  let description = of.description || DEFAULT.description!
  let image = of.image || url(env, '/og.png')
  return {
    description,
    'og:type': 'website',
    'og:site_name': 'yaks.app',
    ...(of.at ? { 'og:url': of.at } : {}),
    'og:title': title,
    'og:description': description,
    'og:image': image,
    'twitter:card': 'summary_large_image',
    'twitter:title': title,
    'twitter:description': description,
    'twitter:image': image,
  }
}

export let meta = (name: string, content: string) =>
  h('meta', { [name.startsWith('og:') ? 'property' : 'name']: name, content })

export let tag = (name: string, content: string) =>
  renderToString(meta(name, content)).replace(/\/>$/, '>')

export let tags = (env: Host, of: Preview) =>
  Object.entries(fields(env, of)).map(([k, v]) => tag(k, v))
    .join('\n')

let kind = (title: string, description: string): Preview => ({
  title: title.endsWith('yaks.app') ? title : `${title} · yaks.app`,
  description,
})

// No names, ids, query strings or directory reads: knowing an address does
// not grant access to anything kept there.
let VIEWS: Record<string, Preview> = {
  operator: kind(
    'A conversation with an Operator',
    'Talk with an Operator on yaks.app.',
  ),
  apps: kind('Apps', 'Apps in a space on yaks.app.'),
  new: kind('Make an app', 'Make an app with an Operator on yaks.app.'),
  updates: kind('Updates', 'Updates from an Operator on yaks.app.'),
  people: kind('People', 'Manage who can use a space on yaks.app.'),
  connections: kind('Connections', 'Connect services to a space on yaks.app.'),
  visits: kind('Visits', 'See visits to apps on yaks.app.'),
  selling: kind('Selling', 'Manage sales on yaks.app.'),
  billing: kind('Billing', 'Manage a plan and spending on yaks.app.'),
  settings: kind('Space settings', 'Manage a space on yaks.app.'),
  trash: kind('Trash', 'Manage deleted apps on yaks.app.'),
  profile: kind('Your profile', 'Manage your account on yaks.app.'),
  invite: kind('An invitation', 'An invitation to join yaks.app.'),
  agents: kind('Connect an assistant', 'Connect your assistant to yaks.app.'),
  shared: kind('Shared with you', 'Apps shared with you on yaks.app.'),
  space: kind('Make a space', 'Make a space on yaks.app.'),
}

export let APP: Preview = {
  title: 'An app on yaks.app',
  description: 'Open an app on yaks.app.',
}

let ROUTES: [RegExp, Preview, string?][] = [
  [/^\/connect(?:\/|$)|^\/oauth\//, VIEWS.agents],
  [/^\/invite(?:\/|$)/, VIEWS.invite],
  [
    /^\/install(?:\/|$)/,
    kind('Make your own copy', 'Install an app in your own space on yaks.app.'),
    'name',
  ],
  [
    /^\/admin(?:\/|$)/,
    kind('Platform administration', 'Manage the yaks.app platform.'),
  ],
  [
    /^\/tv(?:\/|$)/,
    kind('A screen on yaks.app', 'Open or pair a screen on yaks.app.'),
  ],
  [/^\/space\//, VIEWS.settings],
]

/** What a sign-in link points to, without learning anything about its owner. */
export let destination = (
  back: string | null | undefined,
  env: Host = {},
): (Preview & { publication?: string }) | undefined => {
  if (!back || !onZone(back, env)) return undefined
  let at = new URL(back, url(env, '/'))
  let r = route(at.hostname, at.pathname, env)
  if (r.space) return APP
  let view = managed(r.path)
  if (view) {
    let name = 'account' in view
      ? view.account
      : 'legacy' in view
      ? view.legacy
      : 'view' in view
      ? view.view
      : 'operator'
    return VIEWS[name]
  }
  let found = ROUTES.find(([path]) => path.test(r.path))
  return found && {
    ...found[1],
    publication: found[2]
      ? at.searchParams.get(found[2]) ?? undefined
      : undefined,
  }
}

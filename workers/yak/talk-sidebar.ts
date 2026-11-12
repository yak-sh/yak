// The Operator's menu: its spaces, Updates, apps and settings, behind the
// bar's menu button on every width (talk-beside.ts holds what is beside the
// conversation). Sidebar owns their drawing.
import { h } from 'preact'
import { type Item, Sidebar } from './sidebar.ts'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import type { Who } from './session.ts'
import type { Beside } from './operator-page.ts'
import { spaceHost, url } from './host.ts'
import { ADMIN, chatPath, logoPath, managePath } from './route.ts'

/** An app beside the conversation already open. */
export let aboutPath = (space: string, app: string, open = 'new') =>
  `${chatPath(space, open)}?app=${encodeURIComponent(app)}`

let APPS = 4

export let talkSide = (
  env: Env,
  space: Space,
  who: Who,
  beside: Beside,
  at: { current: string[]; waiting: number; app?: string },
) => {
  let owner = who.role == 'owner'
  let here = beside.spaces?.find((s) => s.slug == space.slug) ?? {
    slug: space.slug,
    title: space.title,
    owner,
    own: false,
    operator: space.operator,
    logo: logoPath(space),
  }
  let spaces = beside.spaces ?? []
  let apps = beside.apps ?? []
  let open = at.current.find((c) => c && c != 'updates') ?? 'new'
  let items: Item[] = apps.slice(0, APPS).map((a) => ({
    href: aboutPath(space.slug, a.slug, open),
    current: a.slug == at.app,
    icon: 'layout-grid',
    image: `https://${spaceHost(env, space.slug)}/${a.slug}/icon.png`,
    label: a.title || a.slug,
  }))
  if (owner && apps.length > APPS) {
    items.push({
      href: managePath('apps', space.slug),
      icon: 'layout-grid',
      label: `All ${apps.length} apps`,
      more: true,
    })
  }
  return h(Sidebar, {
    surface: 'textured',
    base: url(env),
    home: chatPath(space.slug),
    label: 'Menu',
    picker: [
      here,
      spaces.some((s) => s.slug == space.slug) ? spaces : [here, ...spaces],
      (s) => chatPath(s.slug),
      null,
      (s) => s.operator ?? '',
    ],
    sections: [
      {
        id: 'side-operator',
        label: space.operator,
        items: [
          {
            href: chatPath(space.slug),
            current: !at.app && !at.current.includes('updates'),
            icon: 'message-circle',
            label: space.operator,
          },
          {
            href: managePath('updates', space.slug),
            current: at.current.includes('updates'),
            icon: 'bell',
            label: `Updates from ${space.operator}`,
            count: at.waiting || undefined,
          },
        ],
      },
      {
        id: 'side-apps',
        label: 'Your apps',
        heading: true,
        items,
        empty: `None yet. Ask ${space.operator} to make one.`,
      },
    ],
    footer: [{
      id: 'side-settings',
      label: 'Settings',
      items: [
        {
          href: managePath('operator', space.slug),
          icon: 'sliders-horizontal',
          label: 'Manage',
        },
        ...(beside.admin
          ? [{ href: ADMIN, icon: 'shield', label: 'Admin' } satisfies Item]
          : []),
      ],
    }],
  })
}

// The Operator's side: its spaces, Updates, apps and settings, at the
// page's left as on the settings pages, and folded to its icons by the same
// press (talk-beside.ts holds what is beside the conversation). Sidebar owns
// their drawing.
import { h } from 'preact'
import { type Item, Sidebar } from './sidebar.ts'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import type { Who } from './session.ts'
import type { Beside } from './operator-page.ts'
import { spaceHost, url } from '@yaks/platform/host'
import {
  ADMIN,
  chatPath,
  enabling,
  logoPath,
  managePath,
} from '@yaks/platform/routes'
import { mailFrom } from '@yaks/platform/host'
import { shown } from '@yaks/phone'
import type { chatRows } from './connections.ts'
import { phoneAt } from './phones.ts'
import { caught } from './defects.ts'
import type { Place, Unset } from './chat.ts'

/** An app beside the conversation already open: every app shares the one
 * conversation, so the side keeps it lit and marks the app only Open. */
export let aboutPath = (space: string, app: string, open = 'new') =>
  `${chatPath(space, open)}?app=${encodeURIComponent(app)}`

let APPS = 4

/** Every way to reach a space's Operator, as its side lists them: its email
 * address, the number it is texted at and the one it answers calls on, and
 * where it is on each chat platform (chat.ts `reached`), with the platforms
 * the space has not added it to yet, offered to its owner alone. */
export type Ways = {
  email: string
  text?: string
  call?: string
  places: Place[]
  unset: Unset[]
}

/** How `space`'s Operator is reached, read for its side: each number from
 * configuration (phones.ts `phoneAt`), its chat platforms from its chat
 * connections `rows`, which its page read in its one directory trip
 * (manage.ts `beside`). A platform that cannot be read leaves the rest. */
export let waysOf = async (
  env: Env,
  space: Space,
  owner: boolean,
  rows: Awaited<ReturnType<typeof chatRows>>,
): Promise<Ways> => {
  let [texts, calls, chat] = await Promise.all([
    phoneAt(env, space.sender),
    phoneAt(env),
    import('./chat.ts').then((c) => c.reached(env, rows)).catch((e) => {
      caught(e, { request: 'operator reach chat' })
      return { places: [], unset: [] }
    }),
  ])
  let text = texts?.transport().number
  let call = calls?.caller ? calls.transport().number : undefined
  return {
    email: mailFrom(space.slug, null, env),
    ...text ? { text } : {},
    ...call ? { call } : {},
    places: chat.places,
    unset: owner ? chat.unset : [],
  }
}

// The side's links for each way to reach the Operator: each opens the
// person's mail app, phone or chat app there, and each platform not set up
// yet is the one button that adds it, which comes back to `here`.
let reaching = (space: Space, ways: Ways, here: string): Item[] => [
  { href: `mailto:${ways.email}`, icon: 'mail', label: ways.email },
  ...ways.call
    ? [
      {
        href: `tel:${ways.call}`,
        icon: 'phone',
        label: `Call ${shown(ways.call)}`,
      } satisfies Item,
    ]
    : [],
  ...ways.text
    ? [
      {
        href: `sms:${ways.text}`,
        icon: 'message-square',
        label: `Text ${shown(ways.text)}`,
      } satisfies Item,
    ]
    : [],
  ...ways.places.map((p): Item => ({
    href: p.href,
    icon: 'message-circle',
    label: [p.server ?? p.platform, p.room && `#${p.room}`].filter(Boolean)
      .join(' · '),
    external: true,
  })),
  ...ways.unset.map((u): Item => ({
    href: enabling(
      managePath('connections', space.slug),
      u.testing ? [u.integration] : [],
    ),
    icon: 'plus',
    label: `Add to ${u.platform}`,
    submit: true,
    fields: { do: 'add', integration: u.integration, back: here },
  })),
]

export let talkSide = (
  env: Env,
  space: Space,
  who: Who,
  beside: Beside,
  at: { current: string[]; waiting: number; app?: string; here: string },
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
    beside: a.slug == at.app,
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
    base: url(env),
    home: chatPath(space.slug),
    label: 'Menu',
    fold: { collapsed: !!beside.collapsed, back: at.here },
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
            // The conversation stays the page with an app open beside it.
            current: !at.current.includes('updates'),
            icon: 'message-circle',
            label: space.operator,
          },
          {
            href: managePath('updates', space.slug),
            current: at.current.includes('updates'),
            icon: 'bell',
            label: 'Updates',
            waiting: at.waiting,
          },
        ],
      },
      ...beside.ways
        ? [{
          id: 'side-reach',
          label: `Reach ${space.operator}`,
          heading: true,
          items: reaching(space, beside.ways, at.here),
        }]
        : [],
      {
        id: 'side-apps',
        label: 'Your apps',
        heading: true,
        note: `Each opens beside your one chat with ${space.operator}.`,
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

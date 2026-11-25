// The Operator's side: its spaces, Updates, apps and settings, at the
// page's left as on the settings pages, and folded to its icons by the same
// press (talk-beside.ts holds what is beside the conversation). Sidebar owns
// their drawing.
import { h } from 'preact'
import { Sidebar } from './sidebar.ts'
import { icons } from './icons.ts'
import { aboutPath, sideParts, type SideView } from '@yaks/platform/side-parts'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import type { Who } from './session.ts'
import type { Beside } from './operator-page.ts'
import { spaceHost, url } from '@yaks/platform/host'
import {
  ADMIN,
  chatPath,
  logoPath,
  managePath,
  talkPath,
} from '@yaks/platform/routes'

export { aboutPath }

export let talkSide = (
  env: Env,
  space: Space,
  who: Who,
  beside: Beside,
  at: { current: string[]; waiting: number; app?: string; here: string },
) => {
  let owner = who.role == 'owner'
  // `updates` is the space's Updates, `all` every space's.
  let reading = at.current.some((c) => c == 'updates' || c == 'all')
  let open = at.current.find((c) => c && c != 'updates' && c != 'all') ??
    'new'
  let view: SideView = {
    person: who.person ?? '',
    here: {
      slug: space.slug,
      title: space.title,
      owner,
      own: false,
      operator: space.operator,
      logo: logoPath(space),
    },
    talk: {
      space: space.eid,
      open,
      app: at.app,
      all: at.current.includes('all'),
      at: `https://${spaceHost(env, space.slug)}`,
    },
  }
  let parts = sideParts(view, beside.spaces ?? [], beside.apps ?? [])
  return h(Sidebar, {
    base: url(env),
    home: chatPath(space.slug),
    label: 'Menu',
    view: who.person ? view : undefined,
    fold: { collapsed: !!beside.panes?.collapsed, back: at.here },
    personal: parts.personal,
    space: {
      picker: parts.picker,
      sections: [
        {
          id: 'side-operator',
          label: space.operator,
          items: [
            {
              href: chatPath(space.slug),
              // The conversation stays the page with an app open beside it.
              current: !reading,
              hold: true,
              icon: icons['message-circle'],
              label: space.operator,
            },
            {
              href: talkPath('updates', space.slug),
              current: at.current.includes('updates'),
              icon: icons.bell,
              label: 'Updates',
              names: 'Updates',
              hold: true,
              waiting: at.waiting,
            },
          ],
        },
        parts.apps!,
        {
          id: 'side-settings',
          label: 'Settings',
          // Manage is the space's settings; a member who does not own it
          // has its Operator's alone.
          items: [{
            href: managePath(owner ? 'apps' : 'operator', space.slug),
            icon: icons['sliders-horizontal'],
            label: 'Manage',
            names: owner ? 'Apps' : 'Operator',
          }],
        },
      ],
    },
    footer: beside.admin
      ? [{
        id: 'side-admin',
        label: 'Platform',
        items: [{ href: ADMIN, icon: icons.shield, label: 'Admin' }],
      }]
      : undefined,
  })
}

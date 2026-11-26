// The dashboard's sidebar choices; Sidebar owns their drawing.
import { h } from 'preact'
import { type Item, Sidebar } from './sidebar.ts'
import { icons as glyphs } from './icons.ts'
import { sideParts, type SideView } from '@yaks/platform/side-parts'
import type { DeskPage } from './pages.ts'
import { type Host, spaceHost, url } from '@yaks/platform/host'
import {
  chatPath,
  dashboardPath,
  LOGOUT,
  managePath,
  type Setting,
} from '@yaks/platform/routes'

let icons = {
  profile: 'user',
  friends: 'users-round',
  invite: 'qr-code',
  agents: 'bot',
  shared: 'share-2',
  operator: 'bot',
  apps: 'layout-grid',
  people: 'users',
  connections: 'plug',
  visits: 'chart-no-axes-column-increasing',
  selling: 'credit-card',
  billing: 'receipt',
  domains: 'globe',
  settings: 'settings-2',
  trash: 'trash-2',
} as const

export let deskSide = (at: DeskPage, view: Setting, env: Host) => {
  let here = at.spaces?.find((s) => s.slug == at.space) ?? {
    slug: at.space,
    title: '',
    owner: !at.member,
    own: false,
  }
  let item = (key: keyof typeof icons, label: string): Item => ({
    href: managePath(key, at.space),
    label,
    names: label,
    icon: glyphs[icons[key]],
    current: view == key || (view == 'new' && key == 'apps'),
    count: key == 'trash' ? at.binned || undefined : undefined,
    // The Operator's settings wait on its store, which a cold Operator takes
    // a second to open: kept ready.
    ready: key == 'operator' || undefined,
  })
  let host = spaceHost(env, at.space)
  let side: SideView = { person: at.person ?? '', here, desk: { view } }
  return h(Sidebar, {
    base: url(env),
    home: dashboardPath(at.space),
    label: 'Manage',
    title: 'Manage',
    view: at.person ? side : undefined,
    back: { href: chatPath(at.space), name: here.operator || 'your Operator' },
    fold: {
      collapsed: !!at.panes?.collapsed,
      back: managePath(view, at.space),
    },
    space: {
      picker: sideParts(side, at.spaces ?? [], []).picker,
      sections: [{
        id: 'side-space',
        label: 'This space',
        heading: true,
        items: at.member
          ? [
            item('operator', 'Operator'),
            ...(at.supportAvailable ? [item('billing', 'Billing')] : []),
          ]
          : [
            item('apps', 'Apps'),
            item('people', 'People'),
            item('operator', 'Operator'),
            item('connections', 'Connections'),
            item('visits', 'Visits'),
            ...(at.shops ? [item('selling', 'Selling')] : []),
            item('billing', 'Billing'),
            item('settings', 'Space settings'),
            item('domains', 'Domains'),
            item('trash', 'Trash'),
          ],
      }],
    },
    sections: [{
      id: 'side-account',
      label: 'Your account',
      heading: true,
      items: [
        item('profile', 'Profile'),
        item('friends', 'Friends'),
        item('invite', 'Invite a friend'),
        item('agents', 'Agents'),
        item('shared', 'Shared with you'),
      ],
    }],
    footer: [{
      id: 'side-help',
      label: 'Help and account',
      items: [
        {
          href: `https://${host}/`,
          label: `Open ${host}`,
          icon: glyphs['external-link'],
          external: true,
        },
        {
          href: url(env, '/help'),
          label: 'Help',
          icon: glyphs['circle-question-mark'],
          external: true,
        },
        {
          href: url(env, LOGOUT),
          label: 'Sign out',
          icon: glyphs['log-out'],
          submit: true,
        },
      ],
    }],
  })
}

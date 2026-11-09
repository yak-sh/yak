// The dashboard's sidebar choices; Sidebar owns their drawing.
import { h } from 'preact'
import { type Item, Sidebar } from './sidebar.ts'
import type { DeskPage } from './pages.ts'
import { type Host, spaceHost, url } from './host.ts'
import {
  accountView,
  chatPath,
  LOGOUT,
  managePath,
  type ManageView,
} from './route.ts'

let icons = {
  profile: 'user',
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
  settings: 'settings-2',
  trash: 'trash-2',
} satisfies Record<string, Item['icon']>

export let deskSide = (at: DeskPage, view: ManageView, env: Host) => {
  let here = at.spaces?.find((s) => s.slug == at.space) ?? {
    slug: at.space,
    title: '',
    owner: !at.member,
    own: false,
  }
  let item = (key: keyof typeof icons, label: string): Item => ({
    href: managePath(key, at.space),
    label,
    icon: icons[key],
    current: view == key || (view == 'new' && key == 'apps'),
    count: key == 'trash' ? at.trash?.length || undefined : undefined,
  })
  let host = spaceHost(env, at.space)
  return h(Sidebar, {
    base: url(env),
    home: chatPath(at.space),
    label: 'Manage',
    title: 'Manage',
    back: { href: chatPath(at.space), name: here.operator || 'your Operator' },
    fold: {
      collapsed: !!at.collapsed,
      back: managePath(view, at.space),
      rail: 'Desk-rail',
    },
    picker: [
      here,
      at.spaces ?? [],
      (s) =>
        accountView(view)
          ? `${managePath(view)}?space=${encodeURIComponent(s.slug)}`
          : managePath(
            !s.owner ? 'operator' : view == 'new' ? 'apps' : view,
            s.slug,
          ),
      { href: managePath('space'), label: 'New space' },
    ],
    sections: [
      {
        id: 'side-space',
        label: 'This space',
        heading: true,
        items: at.member ? [item('operator', 'Operator')] : [
          item('apps', 'Apps'),
          item('people', 'People'),
          item('operator', 'Operator'),
          item('connections', 'Connections'),
          item('visits', 'Visits'),
          ...(at.sell ? [item('selling', 'Selling')] : []),
          item('billing', 'Billing'),
          item('settings', 'Space settings'),
          item('trash', 'Trash'),
        ],
      },
      {
        id: 'side-account',
        label: 'Your account',
        heading: true,
        items: [
          item('profile', 'Profile'),
          item('invite', 'Invite a friend'),
          item('agents', 'Agents'),
          item('shared', 'Shared with you'),
        ],
      },
    ],
    footer: [{
      id: 'side-help',
      label: 'Help and account',
      items: [
        {
          href: `https://${host}/`,
          label: `Open ${host}`,
          icon: 'external-link',
          external: true,
        },
        {
          href: url(env, '/help'),
          label: 'Help',
          icon: 'circle-question-mark',
          external: true,
        },
        {
          href: url(env, LOGOUT),
          label: 'Sign out',
          icon: 'log-out',
          submit: true,
        },
      ],
    }],
  })
}

// yaks.app's sidebar: one frame and navigation tree, specialized by data.
import { h } from 'preact'
import { Badge, Button, Icon, SideNav } from '@yaks/ui/parts'
import { type IconName, icons } from './icons.ts'
import { Idle } from './mascot.ts'
import { managePath } from '@yaks/platform/routes'
import { choice } from './space-picker.ts'

export type Item = {
  href: string
  label: string
  icon: IconName
  image?: string
  current?: boolean
  count?: number
  more?: boolean
  submit?: boolean
  external?: boolean
}

export type Section = {
  id: string
  label: string
  heading?: boolean
  items: Item[]
  empty?: string
}

export type Sidebar = {
  base: string
  home: string
  label: string
  title?: string
  surface?: 'textured'
  back?: { href: string; name: string }
  picker?: Parameters<typeof choice>
  sections: Section[]
  footer?: Section[]
  fold?: { collapsed: boolean; back: string }
}

let worded = (words: string) => h('span', { class: 'Sidebar_Label' }, words)
let glyph = (name: IconName) => h(Icon, { of: icons[name] })

let fold = (at: NonNullable<Sidebar['fold']>) => {
  let said = at.collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'
  return h(
    'form',
    {
      class: 'Sidebar_Fold Page_Form',
      method: 'post',
      action: managePath('profile'),
      'data-side': '',
    },
    h('input', {
      type: 'hidden',
      name: 'sidebar',
      value: at.collapsed ? 'open' : 'collapsed',
    }),
    h('input', { type: 'hidden', name: 'back', value: at.back }),
    h(
      Button,
      {
        type: 'submit',
        class: 'Sidebar_Folder',
        title: said,
        'aria-label': said,
        'aria-controls': 'menu',
        'aria-expanded': String(!at.collapsed),
      },
      h(Icon, { of: icons['panel-left-close'], class: 'Sidebar_Shut' }),
      h(Icon, { of: icons['panel-left-open'], class: 'Sidebar_Unshut' }),
    ),
  )
}

let link = (at: Item) => {
  let node = h(
    SideNav.Link,
    {
      href: at.submit ? undefined : at.href,
      as: at.submit ? 'button' : 'a',
      type: at.submit ? 'submit' : undefined,
      class: at.more ? 'Sidebar_More' : undefined,
      title: at.label,
      mod: at.current && 'on',
      'aria-current': at.current ? 'page' : undefined,
      target: at.external ? '_blank' : undefined,
      rel: at.external ? 'noopener' : undefined,
    },
    at.image
      ? h('img', {
        class: 'Sidebar_Icon',
        src: at.image,
        width: 24,
        height: 24,
        alt: '',
        loading: 'lazy',
      })
      : glyph(at.icon),
    h(SideNav.Label, null, at.label),
    at.count != null ? h(Badge, { class: 'Sidebar_Count' }, at.count) : null,
  )
  return at.submit
    ? h(
      'form',
      { class: 'Sidebar_Form', method: 'post', action: at.href },
      node,
    )
    : node
}

let section = (at: Section, collapsed: boolean) =>
  h(
    'div',
    { class: 'Sidebar_Section' },
    at.heading
      ? h('h3', { class: 'Sidebar_Group', id: at.id }, at.label)
      : null,
    at.items.length
      ? h(SideNav, {
        class: 'Sidebar_Nav',
        mod: collapsed && 'rail',
        'aria-labelledby': at.heading ? at.id : undefined,
        'aria-label': at.heading ? undefined : at.label,
      }, at.items.map(link))
      : h('p', { class: 'Sidebar_None' }, at.empty),
  )

export let Sidebar = (at: Sidebar) =>
  h(
    SideNav.Edge,
    {
      mod: at.surface,
      class: at.fold?.collapsed ? 'Sidebar Sidebar-rail' : 'Sidebar',
      id: 'menu',
      'aria-label': at.label,
    },
    h(
      'div',
      { class: 'Sidebar_Scroll' },
      h(
        'div',
        { class: 'Sidebar_Top' },
        h(
          'a',
          { class: 'Sidebar_Brand', href: at.home },
          h(Idle, { base: at.base, size: 36 }),
          worded('yaks.app'),
        ),
        at.fold ? fold(at.fold) : null,
        h(
          Button,
          { class: 'Sidebar_Close', href: '#', 'data-pane': '' },
          glyph('x'),
          'Close',
        ),
      ),
      at.back
        ? h(
          Button,
          {
            mod: 'go',
            class: 'Sidebar_Back',
            href: at.back.href,
            title: `Back to ${at.back.name}`,
            'aria-label': `Back to ${at.back.name}`,
          },
          glyph('chevron-left'),
          h(
            'span',
            { class: 'Sidebar_Label Sidebar_Way' },
            h('span', { class: 'Sidebar_To' }, at.back.name),
            h('span', { class: 'Sidebar_Before' }, 'Back to'),
          ),
        )
        : null,
      at.title ? h('h2', { class: 'Sidebar_Title' }, at.title) : null,
      at.picker
        ? h('div', { class: 'Sidebar_Whose' }, choice(...at.picker))
        : null,
      at.sections.map((s) => section(s, !!at.fold?.collapsed)),
      at.footer?.length
        ? h(
          'div',
          { class: 'Sidebar_Foot' },
          h(SideNav.Rule, { class: 'Sidebar_Rule' }),
          at.footer.map((s) => section(s, !!at.fold?.collapsed)),
        )
        : null,
    ),
  )

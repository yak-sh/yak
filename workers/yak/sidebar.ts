// yaks.app's sidebar: one frame and navigation tree, specialized by data.
import { type ComponentChildren, h } from 'preact'
import { Button, Form, Icon, layer, SideNav } from '@yaks/ui/parts'
import { type IconName, icons } from './icons.ts'
import { Idle } from './mascot.ts'
import { managePath } from '@yaks/platform/routes'
import {
  type Item,
  link,
  type Section,
  section,
  type SideView,
  waitingBadge,
} from '@yaks/platform/side-parts'

export { type Item, link, type Section, waitingBadge }

export type Sidebar = {
  base: string
  home: string
  label: string
  title?: string
  back?: { href: string; name: string }
  personal?: Section
  /** A side drawn again in the browser as the person's spaces and apps
   * change (@yaks/platform/side-browser), and what it needs to. */
  view?: SideView
  space?: { picker: ComponentChildren; sections: Section[] }
  sections?: Section[]
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
    h(Form.Hidden, {
      name: 'sidebar',
      value: at.collapsed ? 'open' : 'collapsed',
    }),
    h(Form.Hidden, { name: 'back', value: at.back }),
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

// At a phone's width the side is a layer over the page, from the left.
let Slides = layer('aside', 'left')

export let Sidebar = (at: Sidebar) => {
  let draw = (s: Section) => section(s, !!at.fold?.collapsed)
  return h(
    SideNav.Edge,
    {
      as: Slides,
      class: at.fold?.collapsed ? 'Sidebar Sidebar-rail' : 'Sidebar',
      id: 'menu',
      'aria-label': at.label,
      'data-side-view': at.view ? JSON.stringify(at.view) : undefined,
    },
    h(
      'div',
      { class: 'Sidebar_Scroll', 'data-fit-scroll': '' },
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
      at.personal ? draw(at.personal) : null,
      at.space
        ? h(
          'div',
          { class: 'Sidebar_Space' },
          h('div', { class: 'Sidebar_Whose' }, at.space.picker),
          at.space.sections.map(draw),
        )
        : null,
      at.sections?.map(draw),
      at.footer?.length
        ? h(
          'div',
          { class: 'Sidebar_Foot' },
          h(SideNav.Rule, { class: 'Sidebar_Rule' }),
          at.footer.map(draw),
        )
        : null,
    ),
  )
}

// yaks.app's sidebar: one frame and navigation tree, specialized by data.
import { createElement as h, type ReactNode } from 'react'
import { Button, Form, Icon, layer, SideNav } from '@yaks/ui/parts'
import { HOLD } from '@yaks/ui/navigate'
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
  space?: { picker: ReactNode; sections: Section[] }
  sections?: Section[]
  footer?: Section[]
  fold?: { collapsed: boolean; back: string }
}

let worded = (words: string) => h('span', { className: 'Sidebar_Label' }, words)
let glyph = (name: IconName) => h(Icon, { of: icons[name] })

let fold = (at: NonNullable<Sidebar['fold']>) => {
  let said = at.collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'
  return h(
    'form',
    {
      className: 'Sidebar_Fold Page_Form',
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
        className: 'Sidebar_Folder',
        title: said,
        'aria-label': said,
        'aria-controls': 'menu',
        'aria-expanded': String(!at.collapsed),
      },
      h(Icon, { of: icons['panel-left-close'], className: 'Sidebar_Shut' }),
      h(Icon, { of: icons['panel-left-open'], className: 'Sidebar_Unshut' }),
    ),
  )
}

// At a phone's width the side is a layer under the page, at the left, which
// the page (frame.ts) slides aside to uncover.
let Slides = layer('aside', 'left', 'under')

export let Sidebar = (at: Sidebar) => {
  let draw = (s: Section) => section(s, !!at.fold?.collapsed)
  return h(
    SideNav.Edge,
    {
      as: Slides,
      className: at.fold?.collapsed ? 'Sidebar Sidebar-rail' : 'Sidebar',
      id: 'menu',
      'data-swipe': '',
      'aria-label': at.label,
      'data-side-view': at.view ? JSON.stringify(at.view) : undefined,
    },
    h(
      'div',
      { className: 'Sidebar_Scroll', 'data-fit-scroll': '' },
      h(
        'div',
        { className: 'Sidebar_Top' },
        h(
          'a',
          { className: 'Sidebar_Brand', href: at.home, [HOLD]: '' },
          h(Idle, { base: at.base, size: 36 }),
          worded('yaks.app'),
        ),
        at.fold ? fold(at.fold) : null,
        h(
          Button,
          { className: 'Sidebar_Close', href: '#', 'data-pane': '' },
          glyph('x'),
          'Close',
        ),
      ),
      at.back
        ? h(
          Button,
          {
            mod: 'go',
            className: 'Sidebar_Back',
            href: at.back.href,
            [HOLD]: '',
            title: `Back to ${at.back.name}`,
            'aria-label': `Back to ${at.back.name}`,
          },
          glyph('chevron-left'),
          h(
            'span',
            { className: 'Sidebar_Label Sidebar_Way' },
            h('span', { className: 'Sidebar_To' }, at.back.name),
            h('span', { className: 'Sidebar_Before' }, 'Back to'),
          ),
        )
        : null,
      at.title ? h('h2', { className: 'Sidebar_Title' }, at.title) : null,
      at.personal ? draw(at.personal) : null,
      at.space
        ? h(
          'div',
          { className: 'Sidebar_Space' },
          h('div', { className: 'Sidebar_Whose' }, at.space.picker),
          at.space.sections.map(draw),
        )
        : null,
      at.sections?.map(draw),
      at.footer?.length
        ? h(
          'div',
          { className: 'Sidebar_Foot' },
          h(SideNav.Rule, { className: 'Sidebar_Rule' }),
          at.footer.map(draw),
        )
        : null,
    ),
  )
}

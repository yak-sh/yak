// yaks.app's sidebar: one frame and navigation tree, specialized by data.
import { h } from 'preact'
import { Badge, Button, Form, Icon, SideNav } from '@yaks/ui/parts'
import { type IconName, icons } from './icons.ts'
import { Idle } from './mascot.ts'
import { type appMarkImage, managePath } from '@yaks/platform/routes'
import { NAMES } from '@yaks/ui/navigate'
import { acrossBadge, choice } from './space-picker.ts'

export type Item = {
  href: string
  label: string
  /** What the page it opens is called, where that is known here: the
   * page's title says it the moment the link is pressed (@yaks/ui/navigate
   * `NAMES`). */
  names?: string
  icon: IconName
  image?: ReturnType<typeof appMarkImage>
  current?: boolean
  /** Open beside the current page rather than the page itself: a quiet
   * "Open" mark, not the lit tab (talk-sidebar.ts, an app beside the one
   * conversation). */
  beside?: boolean
  /** How many there are, a plain number. */
  count?: number
  /** How many are new or wait on the person, on the red badge, which is
   * drawn hidden at none so a page can add what it learns later to it
   * (`data-waiting`, operator-page.ts `lateScript`). */
  waiting?: number
  /** How many of the person's Updates wait on them across their spaces,
   * filled once the page has asked (space-picker.ts `acrossBadge`). */
  across?: boolean
  submit?: boolean
  /** What a `submit` item's form posts besides its press. */
  fields?: Record<string, string>
  external?: boolean
}

/** How many wait on the person, `n`, on the red badge: hidden at none, and
 * saying the count it was drawn with for a page to add to. */
export let waitingBadge = (n: number, cls?: string) =>
  h(Badge, { class: cls, hidden: !n || undefined, 'data-waiting': n }, n || '')

export type Section = {
  id: string
  label: string
  heading?: boolean
  /** A line under the heading saying what its links open. */
  note?: string
  fit?: boolean
  items: Item[]
  empty?: string
}

export type Sidebar = {
  base: string
  home: string
  label: string
  title?: string
  back?: { href: string; name: string }
  personal?: Section
  space?: { picker: Parameters<typeof choice>; sections: Section[] }
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

/** One item's link, or its form's button for a `submit` item. */
export let link = (at: Item) => {
  let node = h(
    SideNav.Link,
    {
      href: at.submit ? undefined : at.href,
      as: at.submit ? 'button' : 'a',
      type: at.submit ? 'submit' : undefined,
      title: at.label,
      [NAMES]: at.names,
      mod: at.current && 'on',
      'aria-current': at.current ? 'page' : at.beside ? 'true' : undefined,
      target: at.external ? '_blank' : undefined,
      rel: at.external ? 'noopener' : undefined,
    },
    at.image
      ? h(
        'span',
        { class: 'Sidebar_Icon', ...at.image.backdrop },
        h('img', { ...at.image.image, width: 24, height: 24 }),
      )
      : glyph(at.icon),
    h(SideNav.Label, null, at.label),
    at.beside
      ? h(Badge, { mod: 'quiet', class: 'Sidebar_Count' }, 'Open')
      : at.across
      ? acrossBadge('', 'Sidebar_Count')
      : at.waiting != null
      ? waitingBadge(at.waiting, 'Sidebar_Count')
      : at.count != null
      ? h(Badge, { mod: 'quiet', class: 'Sidebar_Count' }, at.count)
      : null,
  )
  return at.submit
    ? h(
      'form',
      { class: 'Sidebar_Form', method: 'post', action: at.href },
      Object.entries(at.fields ?? {}).map(([name, value]) =>
        h(Form.Hidden, { name, value })
      ),
      node,
    )
    : node
}

let more = () =>
  h(
    SideNav.Link,
    {
      as: 'button',
      type: 'button',
      class: 'Sidebar_More',
      title: 'More',
      'aria-expanded': 'false',
      'data-fit-more': '',
      hidden: true,
    },
    glyph('ellipsis'),
    h(SideNav.Label, { 'data-fit-label': '' }, 'More'),
  )

let section = (at: Section, collapsed: boolean) =>
  h(
    'div',
    { class: 'Sidebar_Section' },
    at.heading
      ? h('h3', { class: 'Sidebar_Group', id: at.id }, at.label)
      : null,
    at.note && at.items.length
      ? h('p', { class: 'Sidebar_Note' }, at.note)
      : null,
    at.items.length
      ? h(
        SideNav,
        {
          class: 'Sidebar_Nav',
          mod: collapsed && 'rail',
          'data-fit-list': at.fit ? '' : undefined,
          'aria-labelledby': at.heading ? at.id : undefined,
          'aria-label': at.heading ? undefined : at.label,
        },
        at.items.map(link),
        at.fit ? more() : null,
      )
      : h('p', { class: 'Sidebar_None' }, at.empty),
  )

export let Sidebar = (at: Sidebar) => {
  let draw = (s: Section) => section(s, !!at.fold?.collapsed)
  return h(
    SideNav.Edge,
    {
      class: at.fold?.collapsed ? 'Sidebar Sidebar-rail' : 'Sidebar',
      id: 'menu',
      'aria-label': at.label,
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
          h('div', { class: 'Sidebar_Whose' }, choice(...at.space.picker)),
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

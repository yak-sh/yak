// The space picker shared by the dashboard and Operator sidebar.
import { h } from 'preact'
import { Icon, Menu } from '@yaks/ui/parts'
import { icons } from './icons.ts'
import type { Picked } from './pages.ts'
let named = (s: Picked) => s.title || s.slug
let glyph = (name: 'chevrons-up-down' | 'plus') => h(Icon, { of: icons[name] })

/** A space's logo, or where it has none its first letter. */
export let spaceTile = (s: Picked) =>
  s.logo
    ? h('img', {
      class: 'Desk_Tile',
      src: s.logo,
      width: 32,
      height: 32,
      alt: '',
      decoding: 'async',
    })
    : h(
      'span',
      { class: 'Desk_Tile', 'aria-hidden': 'true' },
      named(s).charAt(0).toUpperCase(),
    )

// The space selector over `all`, holding `here`: each space opens at `to`,
// `make` follows the list, and `about` leads the line under each space's name
// (the dashboard's side, and the Operator's chat app, which names each
// space's Operator: operator-page.ts `chatPage`).
export let choice = (
  here: Picked,
  all: Picked[],
  to: (s: Picked) => string,
  make: { href: string; label: string } | null = null,
  about: (s: Picked) => string = () => '',
) => {
  let add = make
    ? h(
      'a',
      {
        class: 'Desk_New',
        href: make.href,
        title: make.label,
      },
      glyph('plus'),
      h('span', { class: 'Sidebar_Label' }, make.label),
    )
    : null
  let box = (s: Picked, line = '') => {
    let said = [about(s), line].filter(Boolean).join(' · ')
    return [
      spaceTile(s),
      h(
        'span',
        { class: 'Desk_Name' },
        h('b', { class: 'Desk_NameText' }, named(s)),
        said ? h('small', { class: 'Desk_NameNote' }, said) : null,
      ),
    ]
  }
  if (all.length < 2) {
    return [
      h('div', { class: 'Desk_Space', title: named(here) }, box(here)),
      add,
    ]
  }
  return h(
    Menu.Fold,
    { 'data-menu': '' },
    h(
      Menu.Summary,
      {
        class: 'Desk_Space',
        title: `Change space: ${named(here)}`,
        'aria-label': `Change space: ${named(here)}`,
      },
      box(here),
      h('span', { class: 'Desk_Change' }, glyph('chevrons-up-down')),
    ),
    h(
      Menu,
      { mod: 'below' },
      h(Menu.Ask, {}, 'Which space do you want to work in?'),
      all.map((s) =>
        h(
          Menu.Item,
          {
            href: to(s),
            'aria-current': s.slug == here.slug ? 'true' : undefined,
          },
          box(
            s,
            s.owner
              ? ''
              : s.whose
              ? `${s.whose}’s space · you’re a member`
              : 'You’re a member',
          ),
          s.slug == here.slug ? h('span', { class: 'Desk_Tick' }, '✓') : null,
        )
      ),
      add ? h(Menu.Rule, {}) : null,
      add ? h(Menu.Footer, {}, add) : null,
    ),
  )
}

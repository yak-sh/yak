import { Identity } from '@yaks/ui/parts'
// The space picker shared by the dashboard and Operator sidebar.
import { h } from 'preact'
import { Icon, Menu } from '@yaks/ui/parts'
import { icons } from './icons.ts'
import type { Picked } from './pages.ts'
let named = (s: Picked) => s.title || s.slug
let glyph = (name: 'chevrons-up-down' | 'plus' | 'check') =>
  h(Icon, { of: icons[name] })

/** A space's logo, or where it has none its first letter. */
export let spaceTile = (s: Picked, mod?: string) =>
  s.logo
    ? h(Identity.Avatar, {
      as: 'img',
      mod,
      src: s.logo,
      width: 32,
      height: 32,
      alt: '',
      decoding: 'async',
    })
    : h(
      Identity.Avatar,
      { mod, 'aria-hidden': 'true' },
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
      Identity.Add,
      { href: make.href, title: make.label },
      glyph('plus'),
      h('span', { class: 'Sidebar_Label' }, make.label),
    )
    : null
  let box = (s: Picked, line = '') => {
    let said = [about(s), line].filter(Boolean).join(' · ')
    return [
      spaceTile(s),
      h(
        Identity.Text,
        {},
        h(Identity.Name, {}, named(s)),
        said ? h(Identity.Note, {}, said) : null,
      ),
    ]
  }
  if (all.length < 2) {
    return [
      h(Identity, { title: named(here) }, box(here)),
      add,
    ]
  }
  return h(
    Menu.Fold,
    { 'data-menu': '' },
    h(
      Menu.Summary,
      {
        as: Identity,
        title: `Change space: ${named(here)}`,
        'aria-label': `Change space: ${named(here)}`,
      },
      box(here),
      h(Identity.Action, {}, glyph('chevrons-up-down')),
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
          s.slug == here.slug ? h(Identity.Mark, {}, glyph('check')) : null,
        )
      ),
      add ? h(Menu.Rule, {}) : null,
      add ? h(Menu.Footer, {}, add) : null,
    ),
  )
}

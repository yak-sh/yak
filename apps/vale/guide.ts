/** Vale's living kit guide, inside the app, without starting the 3D world. */
import { h, render } from 'preact'
import { Button, Panes, stylesheet } from '@yaks/ui'
import { Contents, Guide } from '@yaks/ui/guide'
import { guideComposition } from './guide-composition.ts'

let query = new URL(location.href).searchParams
let theme = query.get('theme') ?? 'vale'
let skin = query.get('skin') ?? 'vale'
let scheme = query.get('scheme') ?? 'light'
let composition = guideComposition(theme, skin)
document.documentElement.style.colorScheme = scheme == 'dark' ? 'dark' : 'light'
let css = document.createElement('style')
css.textContent = await stylesheet(composition)
document.head.append(css)
let link = (pick: Record<string, string>) =>
  `?${new URLSearchParams({ theme, skin, scheme, ...pick })}`
let choices = (key: string, names: string[]) =>
  h(
    'div',
    {},
    h('b', {}, key),
    ' ',
    names.map((name) => h(Button, { href: link({ [key]: name }) }, name)),
  )
render(
  h(
    Panes,
    {},
    h(
      Panes.Pane,
      { mod: 'nav' },
      h(
        Panes.Top,
        {},
        h(Button, { href: './' }, 'Back to the Vale'),
        choices('theme', ['vale', 'everforest', 'rosepine']),
        choices('skin', ['vale', 'base']),
        choices('scheme', ['light', 'dark']),
      ),
      h(
        Panes.Body,
        {},
        h(Contents, {
          composition,
          entry: (stop: string) => ({ href: `#${stop}` }),
        }),
      ),
    ),
    h(
      Panes.Pane,
      { mod: 'main' },
      h(Panes.Body, {}, h(Guide, { composition })),
    ),
  ),
  document.getElementById('guide')!,
)

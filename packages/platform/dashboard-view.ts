/**
 * A space's Dashboard (T-3702), the parts it is drawn from: the apps to
 * launch, what its Operator has been doing, and what it suggests
 * (./suggestions.ts). The space's own page (`<space>.yaks.app`) draws the
 * apps, and for its members holds the rest in a frame from yaks.app, so no
 * app's code on the space's origin reaches its Operator or its Updates; at
 * yaks.app it is a page of the Operator's frame, beside its chat and
 * Updates.
 *
 * @module
 */
import { type ComponentChildren as Kids, h } from 'preact'
import { Badge, Button, Card, Field, Form, Rows, Tile } from '@yaks/ui/parts'
import { appMark, type MarkedApp } from './routes.ts'
import { monogram } from './monogram.ts'
import type { Suggestion } from './suggestions.ts'

/** An app as the launcher lists it: where it opens, how much it was opened
 * this month, whether it came from the gallery, a line saying what it is,
 * and how many of its Updates wait. */
export type Launched = MarkedApp & {
  href: string
  visits?: number
  installed?: boolean
  about?: string
  waiting?: number
  fixed?: boolean
}

/** A break the Operator took up on its own (yaks.app's unseen.ts `fix`): the
 * app it was in, what it said it did, when, and whether it could not finish. */
export type Fix = { app: string; said: string; at: string; failed: boolean }

/** The attribute the launcher's filter field wears. */
export let FILTER = 'data-launch-filter'

/** The apps most opened first, in their order where none was. */
export let launchOrder = <A extends { visits?: number }>(apps: A[]): A[] =>
  apps.map((app, i) => ({ app, i }))
    .sort((a, b) => (b.app.visits ?? 0) - (a.app.visits ?? 0) || a.i - b.i)
    .map(({ app }) => app)

// An app's mark: its icon over its first letter, which shows until the icon
// arrives and where it never does.
let mark = (app: Launched) =>
  h(
    'span',
    {
      class: 'Launch_Mark',
      style: `--app-mark:url("data:image/svg+xml,${
        encodeURIComponent(monogram(app.title || app.slug, app.eid))
      }")`,
    },
    h('img', {
      src: appMark(app.href.replace(/\/$/, ''), app),
      alt: '',
      width: 48,
      height: 48,
      decoding: 'async',
    }),
  )

let tile = (app: Launched) =>
  h(
    'a',
    {
      class: 'Launch_Tile',
      href: app.href,
      'data-launch': `${app.title} ${app.slug}`.toLowerCase(),
    },
    mark(app),
    h(
      'span',
      { class: 'Launch_Words' },
      h('span', { class: 'Launch_Title' }, app.title || app.slug),
      app.about ? h('span', { class: 'Launch_About' }, app.about) : null,
    ),
    app.waiting
      ? h(
        Badge,
        { class: 'Launch_Badge', title: 'Updates waiting' },
        app.waiting,
      )
      : null,
    app.fixed
      ? h(Badge, { mod: 'quiet', class: 'Launch_Badge' }, 'fixed')
      : null,
  )

let group = (label: string, apps: Launched[]) =>
  apps.length
    ? h(
      'section',
      { class: 'Launch_Group', 'aria-label': label },
      h('h2', { class: 'Launch_Heading' }, label),
      h('div', { class: 'Launch_Grid' }, apps.map(tile)),
    )
    : null

/** The apps to launch, most opened first: the ones made here, then the
 * ones installed from the gallery, and a field that narrows them as it is
 * typed in where there are enough to look through. */
export let Launcher = ({ apps }: { apps: Launched[] }) => {
  let ordered = launchOrder(apps)
  let made = ordered.filter((a) => !a.installed)
  let installed = ordered.filter((a) => a.installed)
  return h(
    'div',
    { class: 'Launch' },
    apps.length > 6
      ? h(Field, {
        type: 'search',
        [FILTER]: '',
        placeholder: 'Find an app',
        'aria-label': 'Find an app',
        class: 'Launch_Filter',
      })
      : null,
    installed.length
      ? [group('Made here', made), group('From the gallery', installed)]
      : h('div', { class: 'Launch_Grid' }, made.map(tile)),
  )
}

/** The script that narrows the launcher to the apps whose names hold what
 * is typed. */
export let launchFilter = `
let field = document.querySelector('[${FILTER}]')
field?.addEventListener('input', () => {
  let q = field.value.trim().toLowerCase()
  for (let t of document.querySelectorAll('[data-launch]')) t.hidden = !!q && !t.dataset.launch.includes(q)
})`

// What a fix said, in its first line.
let firstLine = (text: string) =>
  text.split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim())
    .find(Boolean) ?? ''

/** What the Operator has been doing: the breaks it took up on its own, each
 * under its app's name, and its chat one press away. */
export let Working = (at: {
  operator: string
  fixes: Fix[]
  titles: Map<string, string>
  chat: string
}) =>
  h(
    Card,
    { class: 'Dash_Card' },
    h(
      Card.Head,
      null,
      h(Card.Title, null, `What ${at.operator} has been doing`),
      h(Button, { href: at.chat, mod: 'go' }, `Message ${at.operator}`),
    ),
    at.fixes.length
      ? h(
        Rows,
        null,
        at.fixes.map((f) =>
          h(
            Rows.Item,
            null,
            h(
              Tile,
              null,
              h(
                Tile.Title,
                { mod: 'wrap' },
                `${f.failed ? 'Could not fix' : 'Fixed'} a break in ${
                  at.titles.get(f.app) ?? 'an app'
                }`,
              ),
              h(Tile.Sub, { mod: 'wrap' }, firstLine(f.said)),
              f.at
                ? h(
                  Tile.End,
                  null,
                  h(
                    'time',
                    { datetime: f.at, 'data-ago': '' },
                    f.at.slice(0, 10),
                  ),
                )
                : null,
            ),
          )
        ),
      )
      : h(
        Card.Sub,
        null,
        `When an app breaks, ${at.operator} fixes it on its own and says so here.`,
      ),
  )

/** What the Operator suggests: each a link to the place that does it, or to
 * its chat with the request written, and a press that dismisses it for
 * good, sent to `dismiss`. */
export let Suggestions = (at: {
  operator: string
  suggestions: (Suggestion & { href: string })[]
  dismiss: string
  back: string
}): Kids =>
  at.suggestions.length
    ? h(
      Card,
      { class: 'Dash_Card' },
      h(
        Card.Head,
        null,
        h(Card.Title, null, `${at.operator} could also`),
      ),
      h(
        Rows,
        null,
        at.suggestions.map((s) =>
          h(
            Rows.Item,
            { mod: 'split' },
            h(
              Tile,
              { href: s.href },
              h(Tile.Title, { mod: 'wrap' }, s.says),
            ),
            h(
              'form',
              {
                method: 'post',
                action: at.dismiss,
                target: '_self',
                class: 'Dash_Dismiss',
              },
              h(Form.Hidden, { name: 'dismiss', value: s.name }),
              h(Form.Hidden, { name: 'back', value: at.back }),
              h(Button, {
                type: 'submit',
                mod: 'quiet',
                'aria-label': `Dismiss: ${s.says}`,
                title: 'Dismiss',
              }, '×'),
            ),
          )
        ),
      ),
    )
    : null

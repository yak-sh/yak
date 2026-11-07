// What an app is made of, in the words of somebody who has never seen a
// vocab.json (D-146737): the kinds of things it keeps, each with what it
// keeps of one, and what it can do, its commands. The chat draws both beside
// the conversation while the Operator builds the app (operator-page.ts
// `canvas`), read from the app's draft as each write lands. Pure: the page
// reads the file and hands its text here.
import { type ComponentChildren as Node, h } from 'preact'
import { Button, Empty, Rows } from '@yaks/ui/parts'
import { read } from '@yaks/yaml'
import type { Declared } from './operator-persona.ts'
import { readOnly, titleOf } from './data.ts'

/** How the Operator writes a new app so the column beside the chat shows it
 * being made in order and in plain words, declared beside the code that
 * reads it; the base persona contains it (operator-persona.ts). One write
 * more than writing the whole app at once costs a build about a cent: the
 * step reads the conversation from the cache ($0.10 a million tokens on
 * Sonnet 5.5), against the $5 a newcomer's build may spend (newcomer.ts
 * PER_BUILD). */
export let building: Declared = {
  key: 'building',
  title: 'Making a new app',
  body:
    'While you make an app, the column beside the chat shows it being made, read from its draft as each write lands: What it keeps (the components of its vocab.json), What it can do (its commands, and its pages by their <title>), and Screens once the draft holds a page, the newest open. So when you make a new app, write its vocab.json first, in an app_files call of its own, and its pages after it: the person sees what it will keep before its screens. Give each component, each command and each property a title in the person\'s own words ("Address line 2", not street2), and mark a property the app keeps for itself, which nobody fills in (a slug, a sort position, a flag on sample rows), "readOnly": true: the column leaves it out.',
}

/** A kind of thing an app keeps: its name, and what it keeps of each. */
export type Kind = { name: string; holds: string[] }
/** Something an app can do: its name, and what it does in a sentence. */
export type Act = { name: string; about: string }
/** An app as a person reads it: its kinds, its own commands, and the kinds
 * the platform gives it a way to add and find (tools.md, "Generated `add_`
 * and `find_` commands"). */
export type Made = { kinds: Kind[]; acts: Act[]; finds: string[] }

let object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v == 'object' && !Array.isArray(v)

// A name as a person writes it: `meal_plan`, `mealPlan` and `meal-plan` are
// all "meal plan"; a `title` the entry gives is its own.
let plain = (key: string, entry: Record<string, unknown> = {}) =>
  titleOf(entry) ||
  key.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_\-\s]+/g, ' ')
    .trim().toLowerCase()

// What a kind keeps of one, as a person reads it: all but the properties
// the app keeps for itself.
let shown = (properties: Record<string, unknown>) =>
  Object.entries(properties).map(([p, s]) => [p, object(s) ? s : {}] as const)
    .filter(([, s]) => !readOnly(s))
let capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
// A name inside a sentence, but one that begins with an acronym ("URL").
let lower = (s: string) =>
  /^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1)

// What a command says it does, its first sentence, as a line can hold it.
let sentence = (text: unknown) => {
  let said = typeof text == 'string' ? text.trim() : ''
  let first = said.match(/^[\s\S]*?[.!?](?=\s|$)/)?.[0] ?? said
  return first.length > 160 ? first.slice(0, 159).trimEnd() + '…' : first
}

/**
 * An app's vocab.json (or .yml), as written, in plain words; nothing for a
 * file that is missing or does not read yet, since a draft is often halfway
 * through being written.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { madeOf } from './made.ts'
 * equal(madeOf(JSON.stringify({ $defs: {
 *   recipe: { properties: { serves: {}, photo_url: {} } },
 *   starred: { kind: false, properties: {} },
 *   plan_week: { tool: true, description: 'Picks seven dinners. Then…' },
 * } })), {
 *   kinds: [
 *     { name: 'Recipe', holds: ['serves', 'photo url'] },
 *     { name: 'Starred', holds: [] },
 *   ],
 *   acts: [{ name: 'Plan week', about: 'Picks seven dinners.' }],
 *   finds: ['recipe'],
 * })
 * ```
 */
export let madeOf = (source: string | null, file = 'vocab.json'): Made => {
  let doc: unknown
  try {
    doc = source ? read(source, file) : {}
  } catch {
    doc = {}
  }
  let defs = object(doc) && object(doc.$defs) ? doc.$defs : {}
  let entries = Object.entries(defs).filter(([, e]) => object(e)) as [
    string,
    Record<string, unknown>,
  ][]
  let tools = entries.filter(([, e]) => e.tool === true)
  let kinds = entries.filter(([, e]) => e.tool !== true)
  let declared = new Set(tools.map(([name]) => name))
  return {
    kinds: kinds.map(([key, e]) => ({
      name: capital(plain(key, e)),
      holds: shown(object(e.properties) ? e.properties : {})
        .map(([p, s]) => lower(plain(p, s))),
    })),
    acts: tools.map(([key, e]) => ({
      name: capital(plain(key, e)),
      about: sentence(e.description),
    })),
    finds: object(doc) && doc.tools === false ? [] : kinds
      .filter(([key, e]) =>
        e.kind !== false && e.extends !== true &&
        !(declared.has(`add_${key}`) && declared.has(`find_${key}`))
      )
      .map(([key, e]) => lower(plain(key, e))),
  }
}

/** A page of an app: where it is under the app's address ('' for its
 * index.html, `about` for about.html, `shop/` for shop/index.html), and
 * what it calls itself. */
export type Page = { path: string; title: string }

// Text as a page writes it, its markup and character references read.
let text = (html: string) =>
  html.replace(/<[^>]*>/g, ' ').replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (_, ref: string) =>
      ref[0] == '#'
        ? String.fromCodePoint(parseInt(ref.slice(1).replace(/^x/i, '0x')))
        : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[
          ref.toLowerCase() as 'amp'
        ],
  ).replace(/\s+/g, ' ').trim()

/**
 * An app's pages, each `[path, html]` of its files a page: where each is
 * served and what it calls itself, its `<title>`, else its first `<h1>`,
 * else its name. Its index comes first and a 404.html, which is no page a
 * person goes to, is left out.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { pagesOf } from './made.ts'
 * equal(pagesOf([
 *   ['about.html', '<h1>About <em>us</em></h1>'],
 *   ['index.html', '<title>Recipes &amp; more</title>'],
 *   ['shop/index.html', '<title></title><h1>The shop</h1>'],
 *   ['gift_cards.html', ''],
 *   ['404.html', '<title>Not here</title>'],
 * ]), [
 *   { path: '', title: 'Recipes & more' },
 *   { path: 'about', title: 'About us' },
 *   { path: 'gift_cards', title: 'Gift cards' },
 *   { path: 'shop/', title: 'The shop' },
 * ])
 * ```
 */
export let pagesOf = (files: [string, string][]): Page[] =>
  files.filter(([path]) => path.endsWith('.html') && path != '404.html')
    .map(([path, html]) => {
      let at = path.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '')
      let named = (tag: string) =>
        text(
          new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
            .exec(html)?.[1] ?? '',
        )
      let name = at.replace(/\/$/, '').split('/').at(-1) || 'home'
      return {
        path: at,
        title: named('title') || named('h1') || capital(plain(name)),
      }
    })
    .sort((a, b) =>
      a.path == '' ? -1 : b.path == '' ? 1 : a.path < b.path ? -1 : 1
    )

let AND = new Intl.ListFormat('en', { type: 'conjunction' })
let OR = new Intl.ListFormat('en', { type: 'disjunction' })
let a = (word: string) => (/^[aeiou]/i.test(word) ? 'an ' : 'a ') + word

// One thing in a list: its name over what describes it.
let row = (name: string, meta: string) =>
  h(
    Rows.Item,
    null,
    h(
      Rows.Main,
      null,
      h(Rows.Name, null, name),
      meta ? h(Rows.Meta, null, meta) : null,
    ),
  )

let empty = (said: string) => h(Empty, null, h('p', null, said))

/** Who the panels speak of: the app, and the Operator making it. */
export type Whose = { app: string; operator: string }

/** The kinds of things an app keeps, each with what it keeps of one. */
export let keeps = (made: Made, { app, operator }: Whose): Node =>
  made.kinds.length
    ? h(
      Rows,
      null,
      made.kinds.map((k) => row(k.name, capital(AND.format(k.holds)))),
    )
    : empty(
      `The kinds of things ${app} keeps show here as ${operator} decides them.`,
    )

/** Where an app's pages open: the screens frame they go to (operator-page.ts
 * `screens`), and the address under which they are served there. */
export type Shows = { frame: 'draft' | 'live'; at: string }

/** What an app can do: its own commands, then adding and finding what it
 * keeps, which a person can ask for in the chat once it is live; and its
 * pages, each shown in its screens when pressed. */
export let does = (
  made: Made,
  { app, operator }: Whose,
  live: boolean,
  pages: Page[] = [],
  shows: Shows | null = null,
) =>
  made.acts.length || made.finds.length || pages.length
    ? [
      made.acts.length || made.finds.length
        ? [
          h(
            'p',
            { class: 'Talk_MadeNote' },
            live
              ? 'Ask for any of these in this chat, even with none of its pages open.'
              : 'Once it is live, you can ask for any of these in this chat, even with none of its pages open.',
          ),
          h(
            Rows,
            null,
            made.acts.map((act) => row(act.name, act.about)),
            made.finds.length
              ? row(
                'Add and find what it keeps',
                capital(OR.format(made.finds.map(a))),
              )
              : null,
          ),
        ]
        : null,
      pages.length
        ? [
          h(
            'p',
            { class: 'Talk_MadeNote' },
            'Its pages, each shown in Screens.',
          ),
          h(
            Rows,
            null,
            pages.map((page) =>
              h(
                Rows.Item,
                null,
                h(
                  Rows.Main,
                  null,
                  h(Rows.Name, null, page.title),
                  h(Rows.Meta, null, '/' + page.path),
                ),
                shows
                  ? h(
                    Rows.Actions,
                    null,
                    h(Button, {
                      href: shows.at + page.path,
                      target: `screen-${shows.frame}`,
                      'data-shows': shows.frame,
                    }, 'Show'),
                  )
                  : null,
              )
            ),
          ),
        ]
        : null,
    ]
    : empty(`What ${app} can do shows here as ${operator} adds it.`)

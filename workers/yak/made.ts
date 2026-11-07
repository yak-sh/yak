// What an app is made of, in the words of somebody who has never seen a
// vocab.json (D-146737): the kinds of things it keeps, each with what it
// keeps of one, and what it can do, its commands. The chat draws both beside
// the conversation while the Operator builds the app (operator-page.ts
// `canvas`), read from the app's draft as each write lands. Pure: the page
// reads the file and hands its text here.
import { type ComponentChildren as Node, h } from 'preact'
import { Empty, Rows } from '@yaks/ui/parts'
import { read } from '@yaks/yaml'

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
  typeof entry.title == 'string' && entry.title.trim()
    ? entry.title.trim()
    : key.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_\-\s]+/g, ' ')
      .trim().toLowerCase()
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
      holds: Object.entries(object(e.properties) ? e.properties : {}).map((
        [p, s],
      ) => lower(plain(p, object(s) ? s : {}))),
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

/** What an app can do: its own commands, then adding and finding what it
 * keeps, which a person can ask for in the chat once it is live. */
export let does = (made: Made, { app, operator }: Whose, live: boolean) =>
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
    : empty(`What ${app} can do shows here as ${operator} adds it.`)

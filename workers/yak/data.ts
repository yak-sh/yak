// What an app's data editor edits (pages.ts `editor`, public/data.js), read
// from the words its release declares: the kinds of row it keeps, and for
// each the field a property is written in. Pure data, handed to the page,
// named the way the column beside the chat names them (made.ts).
import type { PropSchema } from '@yaks/vocab'

/** The words a component, command or property gives itself, which name it
 * for a person ('' for none); the column beside the chat names them by these
 * too (made.ts). */
/// titleOf({ title: ' Address line 2 ' }) -> 'Address line 2'
/// titleOf({ title: 2 }) -> ''
export let titleOf = (entry: { title?: unknown }): string =>
  typeof entry.title == 'string' ? entry.title.trim() : ''

/** Whether a property is one the app keeps for itself, which nobody fills in
 * (a slug, a sort position, a flag on sample rows), said the way JSON Schema
 * says it. What it keeps leaves it out; the data editor shows it, never as a
 * control. */
/// readOnly({ readOnly: true }) -> true
/// readOnly({ readOnly: 'yes' }) -> false
export let readOnly = (property: { readOnly?: unknown }): boolean =>
  property.readOnly === true

/** How a property is edited, from what it declares. */
export type Control =
  | 'file'
  | 'pick'
  | 'choice'
  | 'number'
  | 'bool'
  | 'lines'
  | 'json'
  | 'time'
  | 'url'
  | 'text'

/** One property of a kind as its form holds it. A `readOnly` one is shown,
 * never edited. */
export type Field = {
  comp: string
  prop: string
  label: string
  control: Control
  hint?: string
  ref?: string
  choices?: readonly string[]
  readOnly?: true
}

/** A kind of row the editor lists: `line` is the query its rows answer. */
export type Kind = {
  name: string
  label: string
  hint?: string
  line: string
  fields: Field[]
}

// What is not a row a person keeps: a link between rows, what lives only in a
// page or a moment, and what each person holds privately.
let kept = (def: PropSchema & Record<string, unknown>) =>
  !!def.properties && !def.edge && !def.personal && !def.tool &&
  !def.tools &&
  (def.sync == null || def.sync == 'server') &&
  (def.durable == null || def.durable == 'forever')

// A name as a label says it, where its declaration gives no title.
let spoken = (word: string) => {
  let text = word.replaceAll('_', ' ')
  return text[0].toUpperCase() + text.slice(1)
}
let named = (word: string, s: PropSchema) => titleOf(s) || spoken(word)

let lines = (s: PropSchema) =>
  s.type == 'array' &&
  ((s.items as PropSchema | undefined)?.type ?? 'string') == 'string'

// The control a property is edited with, from what it declares. A file is a
// reference to the platform's `blob`, or the guide's `blob` text property.
let control = (prop: string, s: PropSchema): Control => {
  if (s.ref == 'blob' || (prop == 'blob' && s.type == 'string')) return 'file'
  if (s.ref) return 'pick'
  if (s.enum) return 'choice'
  if (s.type == 'number' || s.type == 'integer') return 'number'
  if (s.type == 'boolean') return 'bool'
  if (lines(s)) return 'lines'
  if (s.type != 'string') return 'json'
  if (s.format == 'date-time') return 'time'
  if (s.format == 'uri') return 'url'
  return 'text'
}

/** A kind's fields: its `doc` title and text, unless it declares its own,
 * then one per property it writes. */
/// fields('note', { properties: { when: { type: 'string', format: 'date-time' } } }).map((f) => f.control)
///   -> ['text', 'text', 'time']
/// fields('home', { properties: { street2: { type: 'string', title: 'Address line 2' }, slug: { type: 'string', readOnly: true } } }).slice(2)
///   -> [
///     { comp: 'home', prop: 'street2', label: 'Address line 2', control: 'text' },
///     { comp: 'home', prop: 'slug', label: 'Slug', control: 'text', readOnly: true },
///   ]
export let fields = (name: string, def: PropSchema): Field[] => [
  ...[['title', 'Title'], ['body', 'Text']]
    .filter(([prop]) => !def.properties?.[prop])
    .map(([prop, label]): Field => ({
      comp: 'doc',
      prop,
      label,
      control: 'text',
    })),
  ...Object.entries(def.properties ?? {})
    .filter(([, s]) =>
      !s.computed && !s.stamped && !s.status && !s.contentEncoding
    )
    .map(([prop, s]): Field => ({
      comp: name,
      prop,
      label: named(prop, s),
      control: control(prop, s),
      ...s.description ? { hint: s.description } : {},
      ...s.ref ? { ref: s.ref } : {},
      ...s.enum ? { choices: s.enum } : {},
      ...readOnly(s) ? { readOnly: true } : {},
    })),
]

/** What the editor lists: each kind the words keep, then the rows they have
 * no kind for, so an app whose rows are plain docs still has rows to edit. */
/// kinds({ link: { title: 'Saved link', properties: { url: { type: 'string' } } }, tap: { edge: true, properties: {} } }).map((k) => k.label)
///   -> ['Saved link', 'Other rows']
export let kinds = (defs: Record<string, PropSchema> = {}): Kind[] => {
  let own = Object.entries(defs).filter(([, def]) => kept(def))
    .map(([name, def]): Kind => ({
      name,
      label: named(name, def),
      ...def.description ? { hint: def.description } : {},
      line: `.${name}`,
      fields: fields(name, def),
    }))
  return [...own, {
    name: 'doc',
    label: own.length ? 'Other rows' : 'Rows',
    line: ['.doc', '!comment', ...own.map((k) => `!${k.name}`)].join('&'),
    fields: fields('doc', { properties: {} }),
  }]
}

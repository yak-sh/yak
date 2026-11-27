/**
 * What a store's rows are edited and shown with, read from the words it
 * declares: the kinds of row it keeps, and for each the field a property is
 * written in. Pure data, handed to a page: the data editor (`./editor`) and any
 * app that edits another store's rows (`./form`) draw from it.
 *
 * @module
 */
import { type PropSchema, refOf } from '@yaks/vocab'

/** The words a component, command or property gives itself, which name it
 * for a person ('' for none). */
/// titleOf({ title: ' Address line 2 ' }) -> 'Address line 2'
/// titleOf({ title: 2 }) -> ''
export let titleOf = (entry: { title?: unknown }): string =>
  typeof entry.title == 'string' ? entry.title.trim() : ''

/** Whether a property is one the app keeps for itself, which nobody fills in
 * (a slug, a sort position, a flag on sample rows), said the way JSON Schema
 * says it. The app's Data tab hides it. The data editor shows it as text. */
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

let spoken = (word: string) => {
  let text = word.replaceAll('_', ' ')
  return text[0].toUpperCase() + text.slice(1)
}
/** A word as a label says it: its title, or the word spoken. */
/// label('price_cents', {}) -> 'Price cents'
/// label('held', { title: 'Held on' }) -> 'Held on'
export let label = (word: string, s: PropSchema): string =>
  titleOf(s) || spoken(word)

let lines = (s: PropSchema) =>
  s.type == 'array' &&
  ((s.items as PropSchema | undefined)?.type ?? 'string') == 'string'

// The control a property is edited with, from what it declares. A file is a
// reference to the platform's `blob`, or the guide's `blob` text property.
let control = (prop: string, s: PropSchema): Control => {
  if (refOf(s) == 'blob' || (prop == 'blob' && s.type == 'string')) {
    return 'file'
  }
  if (refOf(s)) return 'pick'
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
      label: label(prop, s),
      control: control(prop, s),
      ...s.description ? { hint: s.description } : {},
      ...refOf(s) ? { ref: refOf(s) } : {},
      ...s.enum ? { choices: s.enum } : {},
      ...readOnly(s) ? { readOnly: true } : {},
    })),
]

/** Every property a component holds, each shown and never edited: what a
 * row says of itself, including what the platform or the app keeps there. */
/// facts('order', { properties: { total_cents: { type: 'integer', stamped: true }, items: { type: 'string', title: 'Items' } } })
///   -> [
///     { comp: 'order', prop: 'total_cents', label: 'Total cents', control: 'number', readOnly: true },
///     { comp: 'order', prop: 'items', label: 'Items', control: 'text', readOnly: true },
///   ]
export let facts = (name: string, def: PropSchema): Field[] =>
  Object.entries(def.properties ?? {}).map(([prop, s]): Field => ({
    comp: name,
    prop,
    label: label(prop, s),
    control: control(prop, s),
    ...s.description ? { hint: s.description } : {},
    ...refOf(s) ? { ref: refOf(s) } : {},
    readOnly: true,
  }))

/** What the editor lists: each kind the words keep, then the rows they have
 * no kind for, so an app whose rows are plain docs still has rows to edit. */
/// kinds({ link: { title: 'Saved link', properties: { url: { type: 'string' } } }, tap: { edge: true, properties: {} } }).map((k) => k.label)
///   -> ['Saved link', 'Other rows']
export let kinds = (defs: Record<string, PropSchema> = {}): Kind[] => {
  let own = Object.entries(defs).filter(([, def]) => kept(def))
    .map(([name, def]): Kind => ({
      name,
      label: label(name, def),
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

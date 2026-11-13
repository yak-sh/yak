/**
 * @yaks/copy — an app's copy: the words its pages show, kept in `copy.json` at
 * the app's root as keyed snippets, apart from the markup that shows them.
 *
 * ```ts
 * import { fill, parse, read, set } from '@yaks/copy'
 *
 * let copy = parse('{\n  "hero": {\n    "title": "Build, host and share web apps"\n  }\n}\n')
 * read(copy, 'hero.title') // 'Build, host and share web apps'
 * fill('Your first space is %{price}.', { price: 'free' }) // ['Your first space is ', 'free', '.']
 * set('{}', { 'hero.kicker': 'yaks.app' }) // '{\n  "hero.kicker": "yaks.app"\n}\n'
 * ```
 *
 * Pure logic and data: it takes and returns strings and values, and reads no
 * file and touches no page.
 *
 * @module
 */

/** A copy file's value: snippets by key, and nested objects of more. */
export type Copy = { [key: string]: string | Copy }

/** The attributes an element names its copy with. */
export let names: {
  /** The key of the element's text. */
  text: 'data-copy'
  /** The slot of its parent's snippet this element fills. */
  slot: 'data-copy-slot'
  /** The attribute naming the key of the element's attribute `name`. */
  attr: (name: string) => string
} = {
  text: 'data-copy',
  slot: 'data-copy-slot',
  attr: (name) => `data-copy-${name}`,
}

/** What an element's attributes say about its copy. */
export type Marks = {
  /** The key of its text. */
  text?: string
  /** The slot it fills in its parent's snippet. */
  slot?: string
  /** The key of each attribute's value, by attribute. */
  attrs: Record<string, string>
}

type Attributes =
  | Iterable<{ name: string; value: string }>
  | Record<string, string>

/**
 * The copy an element's attributes name, from a DOM element's `attributes` or
 * a plain object of them.
 *
 * ```ts
 * marks({ 'data-copy': 'cost.plans', 'data-copy-slot': 'plans', href: '/pricing' })
 * // { text: 'cost.plans', slot: 'plans', attrs: {} }
 * ```
 */
export let marks = (attributes: Attributes): Marks => {
  let pairs = Symbol.iterator in attributes
    ? [...attributes as Iterable<{ name: string; value: string }>]
      .map(({ name, value }) => [name, value])
    : Object.entries(attributes)
  let found: Marks = { attrs: {} }
  let prefix = names.attr('')
  for (let [name, value] of pairs) {
    if (name == names.text) found.text = value
    else if (name == names.slot) found.slot = value
    else if (name.startsWith(prefix)) {
      found.attrs[name.slice(prefix.length)] = value
    }
  }
  return found
}

let object = (value: unknown): value is Copy =>
  typeof value == 'object' && value != null && !Array.isArray(value)

let check = (value: unknown, path: string, file: string): Copy => {
  if (!object(value)) {
    throw new Error(
      `${file}: ${path || 'the file'} is not an object of snippets`,
    )
  }
  for (let [key, inner] of Object.entries(value)) {
    let at = path ? `${path}.${key}` : key
    if (typeof inner != 'string') check(inner, at, file)
  }
  return value
}

/**
 * A copy file's text as its value; blank text is an empty file. `file` is the
 * name an error uses.
 */
export let parse = (text: string, file = 'copy.json'): Copy => {
  if (!text.trim()) return {}
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (e) {
    throw new Error(`${file} is not JSON: ${(e as Error).message}`)
  }
  return check(value, '', file)
}

// Where a key lives: the object holding it and its name there. A key is
// looked for whole first, then under each object a leading part of it names,
// the longest part first, so `"hero.title"` and `{"hero": {"title"}}` both
// answer `hero.title`.
type Spot = { at: Copy; name: string }

let find = (copy: Copy, key: string): Spot | undefined => {
  if (typeof copy[key] == 'string') return { at: copy, name: key }
  let parts = key.split('.')
  for (let n = parts.length - 1; n > 0; n--) {
    let inner = copy[parts.slice(0, n).join('.')]
    let spot = object(inner) && find(inner, parts.slice(n).join('.'))
    if (spot) return spot
  }
  return undefined
}

/** The snippet at `key`, a dotted path through nested objects. */
export let read = (copy: Copy, key: string): string | undefined => {
  let spot = find(copy, key)
  return spot && spot.at[spot.name] as string
}

/** Every snippet's key, in the file's order. */
export let keys = (copy: Copy): string[] =>
  Object.entries(copy).flatMap(([key, value]) =>
    typeof value == 'string'
      ? [key]
      : keys(value).map((inner) => `${key}.${inner}`)
  )

// `%{name}` is a slot; `%%{name}` is the text `%{name}`.
let SLOT = /(%?)%\{([\w-]+)\}/g

/**
 * A snippet's text with its slots filled: the parts in order, text between
 * the values given. A slot given no value stays as its `%{name}`, so a missing
 * part shows by name rather than as a gap.
 *
 * ```ts
 * fill('Tax is included. %{plans}.', { plans: { a: '/pricing' } })
 * // ['Tax is included. ', { a: '/pricing' }, '.']
 * ```
 */
export let fill = <T>(
  value: string,
  values: Record<string, T> = {},
): Array<string | T> => {
  let parts: Array<string | T> = []
  let text = (s: string) => {
    if (!s) return
    let last = parts.length - 1
    if (typeof parts[last] == 'string') parts[last] += s
    else parts.push(s)
  }
  let from = 0
  for (let match of value.matchAll(SLOT)) {
    let [whole, escape, name] = match
    text(value.slice(from, match.index))
    from = match.index + whole.length
    if (escape || !Object.hasOwn(values, name)) text(whole.slice(escape.length))
    else parts.push(values[name])
  }
  text(value.slice(from))
  return parts
}

/** The slots a snippet names, in order. */
export let slots = (value: string): string[] =>
  [...value.matchAll(SLOT)].filter(([, escape]) => !escape).map(([, , name]) =>
    name
  )

/**
 * A copy file's text, one snippet per line, so a text merge of two edits works
 * by key. `indent` is what a level is indented by.
 */
export let format = (copy: Copy, indent = '  '): string =>
  JSON.stringify(copy, null, indent) + '\n'

// A key not yet in the file goes into the deepest object a leading part of it
// names, so `hero.kicker` joins `{"hero": {…}}` and a key nothing names is
// added at the end of the file as it is written.
let place = (copy: Copy, key: string): Spot => {
  let parts = key.split('.')
  for (let n = parts.length - 1; n > 0; n--) {
    let inner = copy[parts.slice(0, n).join('.')]
    if (object(inner)) return place(inner, parts.slice(n).join('.'))
  }
  return { at: copy, name: key }
}

/**
 * A copy file's text with `changes` set by key. A key already there keeps its
 * place; a new one is added at the end of the object its key leads into. The
 * file's indentation is kept, and each snippet stays on its own line.
 */
export let set = (
  text: string,
  changes: Record<string, string>,
  file = 'copy.json',
): string => {
  let copy = parse(text, file)
  for (let [key, value] of Object.entries(changes)) {
    let { at, name } = find(copy, key) ?? place(copy, key)
    at[name] = value
  }
  return format(copy, /\n([ \t]+)"/.exec(text)?.[1])
}

/**
 * A copy file's text with each snippet another copy of it changed laid over
 * it by key: `ours` is the file, `theirs` the other copy (an app's live
 * file, edited on its page), and `base` what both last agreed on. A key
 * `theirs` holds as `base` did is left as `ours` has it, so an edit or removal
 * made only in `ours` stands; any other key `theirs` holds is set to its
 * text, so an edit made in `theirs` wins, even where `ours` changed it too.
 * With no base, every key `theirs` holds is its own.
 *
 * ```ts
 * let base = '{\n  "a": "one",\n  "b": "two"\n}\n'
 * let ours = '{\n  "a": "uno",\n  "b": "two",\n  "c": "three"\n}\n'
 * merge(ours, '{\n  "a": "one",\n  "b": "dos"\n}\n', base)
 * // '{\n  "a": "uno",\n  "b": "dos",\n  "c": "three"\n}\n'
 * ```
 */
export let merge = (
  ours: string,
  theirs: string,
  base = '',
  file = 'copy.json',
): string => {
  let [o, t, b] = [ours, theirs, base].map((text) => parse(text, file))
  let changes = Object.fromEntries(
    keys(t).flatMap((key) => {
      let text = read(t, key)!
      return text == read(b, key) || text == read(o, key) ? [] : [[key, text]]
    }),
  )
  return Object.keys(changes).length ? set(ours, changes, file) : ours
}

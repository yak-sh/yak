// The site's words: every snippet its pages show is a key in the home app's
// copy (apps/home/copy.json, @yaks/copy), and the element showing it names
// that key. A page is drawn with the file's words in it, and a served page is
// filled again from the copy as released (page-copy.ts), so a word changed on
// the page needs no commit and no deploy.
import { type Copy, fill, names, parse, read } from '@yaks/copy'
import { cloneElement, type VNode } from 'preact'
import file from '../../../apps/home/copy.json' with { type: 'json' }

/** The home app's copy, as committed. */
export let COPY: Copy = parse(JSON.stringify(file), 'apps/home/copy.json')

// A page naming a key the file lacks is a page no one wrote the words of.
let snippet = (key: string) => {
  let value = read(COPY, key)
  if (value == null) throw new Error(`apps/home/copy.json has no ${key}`)
  return value
}

/** The snippet at `key` as text, for an attribute, a title or structured
 * data. */
export let said = (key: string): string => fill(snippet(key)).join('')

/** The element filling each slot of a snippet, by the slot's name. */
export type Slots = Record<string, VNode>

/**
 * The props of an element showing the snippet at `key`: its name, and its
 * children the snippet's text with each slot's element in its place, marked
 * as filling it.
 *
 * ```tsx
 * <p {...text('home.cost.limits', {
 *   plans: <a href='/pricing' {...text('home.cost.plans')} />,
 * })} />
 * ```
 */
export let text = (key: string, slots: Slots = {}) => {
  let marked = Object.fromEntries(
    Object.entries(slots).map((
      [name, el],
    ) => [name, cloneElement(el, { [names.slot]: name })]),
  )
  return { [names.text]: key, children: fill(snippet(key), marked) }
}

/** The props of an element whose attribute `name` is the snippet at `key`. */
export let attr = (name: string, key: string) => ({
  [name]: said(key),
  [names.attr(name)]: key,
})

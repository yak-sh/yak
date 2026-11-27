// The site's words: every snippet its pages show is a key in the home app's
// copy (apps/home/copy.json, @yaks/copy), and the element showing it names
// that key. A page is drawn with the file's words in it, and a served page is
// filled again from the copy as released (page-copy.ts), so a word changed on
// the page needs no commit and no deploy.
import { type Copy, fill, items, names, parse, read } from '@yaks/copy'
import { cloneElement, type ReactElement } from 'react'
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
 * data, each slot the words given for it. */
export let said = (key: string, slots: Record<string, string> = {}): string =>
  fill(snippet(key), slots).join('')

/** The element filling each slot of a snippet, by the slot's name. */
export type Slots = Record<string, ReactElement>

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

/**
 * The props of an element showing the list at `key`: its name, and an item
 * for each of the list's snippets, drawn by `item` with the snippet's text.
 * Each item is drawn alike, so one added on the page is drawn as the rest.
 *
 * ```tsx
 * <ul {...list('pricing.always.items', (says) => <li class='Plan_Item'>{says}</li>)} />
 * ```
 */
export let list = (key: string, item: (says: string) => ReactElement) => {
  let all = items(COPY, key)
  if (!all) throw new Error(`apps/home/copy.json has no list ${key}`)
  return {
    [names.list]: key,
    children: all.map((value) => item(fill(value).join(''))),
  }
}

/** The props of an element whose attribute `name` is the snippet at `key`. */
export let attr = <Name extends string>(name: Name, key: string) =>
  ({
    [name]: said(key),
    [names.attr(name)]: key,
  }) as Record<Name, string>

/**
 * The words of a page drawn from the home page's parts, which name the home
 * page's keys: each snippet under `home.` is the page's own, the same key
 * under `page`, where the page has words there, and the home page's where it
 * has none. The element names the key it shows, so editing it on the page
 * edits that one.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let { key } = voiced('build')
 * assertEquals(key('home.hello.title'), 'build.hello.title')
 * assertEquals(key('home.work.title'), 'home.work.title')
 * ```
 */
export let voiced = (page: string) => {
  let own = (key: string) => {
    let rest = key.startsWith('home.') ? key.slice('home.'.length) : null
    return rest != null && read(COPY, `${page}.${rest}`) != null
      ? `${page}.${rest}`
      : key
  }
  return {
    key: own,
    text: (key: string, slots?: Slots) => text(own(key), slots),
    attr: <Name extends string>(name: Name, key: string) =>
      attr(name, own(key)),
  }
}

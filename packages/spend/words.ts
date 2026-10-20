/**
 * Numbers and rows as a reader takes them in: dollars, token counts, and
 * what a row a tally names is, in a line. Pure, for the page and the report.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'

/**
 * Dollars, to the cent below a hundred and whole above.
 *
 * ```ts
 * import { dollars } from './words.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal([dollars(4.216), dollars(1234.5)], ['$4.22', '$1,235'])
 * ```
 */
export let dollars = (n = 0): string =>
  n >= 100 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`

/**
 * A count of tokens, to three figures.
 *
 * ```ts
 * import { tokens } from './words.ts'
 * import { equal } from '@yaks/testing'
 *
 * equal([tokens(950), tokens(20600), tokens(53100000), tokens(1.2e9)], ['950', '20.6k', '53.1M', '1.2B'])
 * ```
 */
export let tokens = (n = 0): string => {
  let at = (d: number, s: string) =>
    `${Number((n / d).toPrecision(3)).toString()}${s}`
  return n >= 1e9
    ? at(1e9, 'B')
    : n >= 1e6
    ? at(1e6, 'M')
    : n >= 1e3
    ? at(1e3, 'k')
    : String(Math.round(n))
}

let line = (text: unknown, n = 60) => {
  let first = String(text ?? '').trim().split('\n')[0]
  return first.length > n ? `${first.slice(0, n - 1)}…` : first
}

let comp = (b: Bundle, name: string) =>
  b[name] as Record<string, unknown> | undefined

/** What a row a tally names is, in a line: a model by its name, a task or
 * anything with a title by its id and title, a session by its id and the
 * harness's id for it, an entry by what it says. */
export let label = (b: Bundle, id: string): string =>
  comp(b, 'model')?.name
    ? String(comp(b, 'model')!.name)
    : comp(b, 'doc')?.title
    ? `${id} ${line(comp(b, 'doc')!.title)}`
    : comp(b, 'session')
    ? `${id} ${line(comp(b, 'session')!.id ?? '')}`.trim()
    : comp(b, 'content')
    ? `${id} ${line(comp(b, 'content')!.body)}`
    : id

/**
 * What every list on a page shares: an answer's rows, what shows while it is
 * out or refused, and a list cut to its first rows with how many more there
 * are, the rest a query away on the map.
 *
 * @module
 */

import { type ComponentChildren, h, type VNode } from 'preact'
import { Rows } from '@yaks/ui'
import type { Answer, Bundle, Io } from './host.ts'
import { count } from './read.ts'

/** The answer's rows, or none while it is out. */
export let rows = (a?: Answer): Bundle[] => a?.rows ?? []

/** What shows in place of an answer that is refused or not in yet; null
 * once it can be drawn. */
export let waiting = (a?: Answer): VNode | null =>
  a?.error
    ? h(Rows.More, {}, a.error)
    : !a?.ready && !a?.rows.length && a?.count == null && !a?.tally
    ? h(Rows.More, {}, '…')
    : null

/** How many more rows a query holds than are shown: a link opening the map
 * with the query in its bar, or nothing when none are left. */
export let more = (io: Io, n: number, query?: string): VNode | null =>
  n > 0
    ? h(
      Rows.More,
      {},
      query
        ? h('a', { href: io.find(query) }, `${count(n)} more`)
        : `${count(n)} more`,
    )
    : null

/** Some rows, and past them how many more the query holds. */
export let listed = (
  io: Io,
  shown: ComponentChildren[],
  total = shown.length,
  query?: string,
): VNode =>
  h(
    Rows,
    {},
    shown.map((row, i) => h(Rows.Item, { key: i }, row)),
    shown.length
      ? more(io, total - shown.length, query)
      : h(Rows.More, {}, 'none'),
  )

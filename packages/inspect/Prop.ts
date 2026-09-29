/**
 * The sections of a property's page (`_prop`, @yaks/vocab): what it is and
 * holds, the values it most often holds, and its recent writes.
 *
 * @module
 */

import { h } from 'preact'
import { parse } from '@yaks/query'
import { Pairs, Rows, Value } from '@yaks/ui'
import type { Asks, Bundle, Props, View } from './host.ts'
import { history, where } from './History.ts'
import { section } from './page.ts'
import { comp, count, face, line, str } from './read.ts'
import { waiting } from './rows.ts'
import { flags, typed } from './Tile.ts'

let { Key, Value: Cell } = Pairs

/** A property's address, `comp.prop`: its `doc.title` (@yaks/vocab titles
 * each property so). */
export let address = (e: Bundle): string => str(e, 'doc', 'title')

let about = section({
  view: 'Inspect.About',
  match: parse('._prop'),
  title: 'About',
  Body: ({ e, io }: Props) => {
    let p = comp(e, '_prop')
    let of = str(e, '_prop', 'comp')
    let pkg = str(e, '_prop', 'package')
    let listed = (k: string) =>
      p[k] != null
        ? [h(Key, { key: `k ${k}` }, k), h(Cell, { key: `v ${k}` }, face(p[k]))]
        : []
    return h(
      Pairs,
      {},
      h(Key, {}, 'of'),
      h(Cell, {}, of ? h('a', { href: io.link(of) }, io.name(of)) : '—'),
      h(Key, {}, 'package'),
      h(Cell, {}, pkg ? h('a', { href: io.link(pkg) }, io.name(pkg)) : '—'),
      h(Key, {}, 'type'),
      h(Cell, {}, typed(p) || '—'),
      h(Key, {}, 'is'),
      h(Cell, {}, flags(p).join(' · ') || '—'),
      ...['enum', 'default', 'death', 'examples'].flatMap(listed),
      h(Key, {}, 'about'),
      h(Cell, {}, str(e, 'doc', 'body') || '—'),
    )
  },
})

/** How many values a property's page lists. */
export let VALUES = 30

/** The values it holds, most common first. The tally reads every entity
 * carrying its component, so it is asked once. */
let values = section({
  view: 'Inspect.Values',
  match: parse('._prop'),
  title: 'Values',
  asks: (e): Asks => {
    let at = address(e)
    let [name] = at.split('.')
    return at.includes('.')
      ? { tally: { query: `.${name}&.tally=${at}`, once: true } }
      : {}
  },
  count: ({ got }) =>
    got.tally?.tally ? Object.keys(got.tally.tally).length : undefined,
  Body: ({ e, io, got }: Props) => {
    let tally = Object.entries(got.tally?.tally ?? {})
    // A reference's values are entities: each links to its page.
    let ref = !!str(e, '_prop', 'ref')
    return waiting(got.tally) ??
      (tally.length
        ? h(
          Pairs,
          {},
          tally
            .toSorted(([, a], [, b]) => b - a)
            .slice(0, VALUES)
            .flatMap(([v, n]) => [
              h(Key, { key: `k ${v}` }, h(Value, { mod: 'num' }, count(n))),
              h(
                Cell,
                { key: `v ${v}` },
                ref && v
                  ? h('a', { href: io.link(v) }, io.name(v))
                  : line(v, 160) || '""',
              ),
            ]),
        )
        : h(Rows.More, {}, 'none'))
  },
})

/** Its recent writes: the writes of its component, each with this
 * property's value. */
let writes = history({
  view: 'Inspect.History',
  match: parse('._prop'),
  title: 'Writes',
  open: false,
  where: (e) => `comp=${str(e, '_prop', 'comp')}`,
  what: (io, b, e) => {
    let v = comp(b, '_change').value as Record<string, unknown> | null
    let name = str(e, '_prop', 'name')
    return h(
      'span',
      {},
      where(io, b),
      ' ',
      v == null ? 'removed' : name in v ? line(face(v[name]), 160) : '·',
    )
  },
})

/** A property's sections. */
export let propViews: View[] = [about, values, writes]

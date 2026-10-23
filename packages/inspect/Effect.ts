/**
 * An effect's page (`_effect`, @yaks/vocab): what it does and the package
 * declaring it; what owes it a run, as its declaration says: the components
 * whose appearance, patch or removal on an entity does, the query a batch
 * makes hold, a process starting, and the queries that narrow them; and how a
 * run is tried. Its runs are the `effect` rows naming it (@yaks/effects), a
 * query away.
 *
 * @module
 */

import { type ComponentChildren, h, type JSX } from 'preact'
import { parse } from '@yaks/query'
import { Pairs, Value } from '@yaks/ui'
import type { Bundle, Io, Props, View } from './host.ts'
import { usePageNotes } from './Entity.ts'
import { chip, propEid } from './schema.ts'
import { Part, useNamed } from './notes.ts'
import { comp, str } from './read.ts'
import { none } from './rows.ts'

let HEADINGS = ['Owed by']

// An effect's name, off its `_effect` bundle.
let nameOf = (e: Bundle): string => str(e, '_effect', 'name')

// A component, or one property of it (`comp.prop`), linked to its page.
let named = (io: Io, word: string) => {
  let [name, ...prop] = word.split('.')
  return prop.length
    ? h('a', { href: io.link(propEid(name, prop.join('.'))) }, word)
    : chip(io, name)
}

let list = (io: Io, words: string[]) =>
  h('span', {}, words.flatMap((w, i) => [i ? ', ' : null, named(io, w)]))

// A query its declaration says, opened as a search where it is one.
let query = (io: Io, q: string) => {
  try {
    parse(q)
    return h('a', { href: io.find(q) }, h(Value, {}, q))
  } catch {
    return h(Value, {}, q)
  }
}

// What owes it a run: how each trigger its declaration can name is drawn.
let TRIGGERS: Record<string, (io: Io, v: unknown) => ComponentChildren> = {
  created: (io, v) => list(io, v as string[]),
  changed: (io, v) => list(io, v as string[]),
  removed: (io, v) => list(io, v as string[]),
  match: (io, v) => query(io, String(v)),
  target: (io, v) => query(io, String(v)),
  active: (io, v) => query(io, String(v)),
  start: () => 'each time a process starts working the effects',
}

// The triggers its declaration names, each beside what it names.
let owed = (io: Io, e: Bundle): [string, ComponentChildren][] => {
  let c = comp(e, '_effect')
  return Object.entries(TRIGGERS)
    .filter(([k]) => c[k] != null && c[k] !== false)
    .map(([k, draw]) => [k, draw(io, c[k])])
}

/** An effect's own page. */
export let EffectPage = ({ e, io }: Props): JSX.Element => {
  let name = nameOf(e)
  let notes = usePageNotes(io, e, HEADINGS)
  let c = comp(e, '_effect')
  let pkg = str(e, '_effect', 'package')
  useNamed(io, [pkg])
  let sub = [
    str(e, 'doc', 'body'),
    h('br', {}),
    pkg
      ? ['from ', h('a', { href: io.link(pkg) }, io.name(pkg))]
      : 'no package',
    c.option ? ` · only with the option ${c.option}` : '',
    c.tries ? ` · ${c.tries} tries` : '',
    c.idempotent === false ? ' · not idempotent' : '',
  ]
  let triggers = owed(io, e)
  return h(
    'div',
    { 'data-inspect': e.entity.eid },
    io.show(e, 'Inspect.Head', { sub, notes: notes.get(''), subject: name }),
    h(
      Part,
      {
        io,
        eid: e.entity.eid,
        subject: name,
        heading: 'Owed by',
        note: io.vocab.comp('effect')
          ? h('a', { href: io.find(`.effect.handler=${name}`) }, 'its runs')
          : undefined,
        notes,
      },
      triggers.length
        ? h(
          Pairs,
          {},
          triggers.flatMap(([k, v]) => [
            h(Pairs.Key, {}, k),
            h(Pairs.Value, {}, v),
          ]),
        )
        : none(),
    ),
  )
}

/** An effect's page. */
export let effectViews: View[] = [
  { view: 'Inspect.Page', match: parse('._effect'), Render: EffectPage },
]

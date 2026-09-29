/**
 * `Inspect.Links`: what an entity is linked to, and what names it. Its edges
 * each way (@yaks/edge: an entity wearing `edge{from, to}` and the relation
 * component), each read as the relation and the entity at its far end, then
 * every other entity whose reference names it, said by the property that
 * does. One query answers both: `.refs=<eid>`, everything referencing it.
 *
 * Where the host's controls take input, an edge whose relation a client may
 * write is removed by its ×, and one is added by naming a relation and the
 * entity at the far end: a bundle wearing `edge` under a `$` alias, whose eid
 * the graph derives from its ends and relation.
 *
 * @module
 */

import { h, type VNode } from 'preact'
import { Button, Chip, Pairs } from '@yaks/ui'
import type { Bundle, Io, Props } from './host.ts'
import { section, sent, write } from './page.ts'
import { comps, relation, str, tone } from './read.ts'
import { rows, waiting } from './rows.ts'

let VIEW = 'Inspect.Links'

let { Key, Value } = Pairs

/** How many links a page shows. */
export let LINKS = 200

/** The components a vocabulary marks as edge relations. */
export let relations = (io: Io): string[] =>
  io.vocab.all.filter((n) => !!io.vocab.comp(n)?.keywords.edge)

let writable = (io: Io, name: string) => io.edits && !!io.vocab.comp(name)?.wire

let far = (io: Io, eid: string) => h('a', { href: io.link(eid) }, io.name(eid))

let unlink = (io: Io, eid: string, b: Bundle, rel: string) =>
  writable(io, rel)
    ? h(Button, {
      type: 'button',
      mod: ['quiet', 'danger'],
      'aria-label': `remove this ${rel} edge`,
      onClick: () =>
        write(io, eid, VIEW, [{
          entity: { eid: b.entity.eid },
          $delete: true,
        }]),
    }, '×')
    : null

// An edge, from where this entity stands: → the far end it points at, or ←
// the far end pointing here.
let edge = (io: Io, eid: string, b: Bundle, rels: string[]): VNode[] => {
  let rel = relation(b, rels) ?? 'edge'
  let from = str(b, 'edge', 'from')
  let out = from == eid
  let key = b.entity.eid
  return [
    h(
      Key,
      { key: `k ${key}` },
      out ? '→ ' : '← ',
      h(Chip, { mod: tone(rel) }, rel),
    ),
    h(
      Value,
      { key: `v ${key}` },
      h('a', { href: io.link(key) }, '#'),
      ' ',
      far(io, out ? str(b, 'edge', 'to') : from),
      ' ',
      unlink(io, eid, b, rel),
    ),
  ]
}

// Every property of `b` that names `eid`.
let naming = (b: Bundle, eid: string): string[] =>
  comps(b).flatMap(([name, row]) =>
    Object.entries(row).filter(([, v]) => v == eid).map(([p]) => `${name}.${p}`)
  )

let reference = (io: Io, eid: string, b: Bundle): VNode[] => [
  h(Key, { key: `k ${b.entity.eid}` }, `← ${naming(b, eid).join(', ')}`),
  h(Value, { key: `v ${b.entity.eid}` }, io.show(b, 'Inspect.Tile')),
]

// Name a relation and the far end, and the edge is added.
let Link = ({ e, io }: { e: Bundle; io: Io }) => {
  let rels = relations(io).filter((r) => writable(io, r))
  if (!rels.length) return null
  let submit = (ev: Event & { currentTarget: HTMLFormElement }) => {
    let { relation, to } = sent(ev)
    if (!relation || !to) return
    write(io, e.entity.eid, VIEW, [{
      entity: { eid: '$edge' },
      edge: { from: e.entity.eid, to },
      [relation]: {},
    }])
  }
  return h(
    'form',
    { class: 'Inspect_Actions', onSubmit: submit },
    h(
      'select',
      { class: 'Edit', name: 'relation', 'aria-label': 'relation' },
      rels.map((r) => h('option', { key: r, value: r }, r)),
    ),
    h('input', {
      class: 'Edit',
      name: 'to',
      'aria-label': 'to',
      placeholder: 'to (an id: T-12)',
    }),
    h(Button, { type: 'submit', mod: 'add' }, '+ edge'),
  )
}

let Body = ({ e, io, got }: Props) => {
  let eid = e.entity.eid
  let rels = relations(io)
  let all = rows(got.refs)
  let edges = all.filter((b) => b.edge)
  let others = all.filter((b) => !b.edge)
  return h(
    'div',
    {},
    waiting(got.refs) ??
      h(
        Pairs,
        {},
        edges.toSorted((a, b) =>
          (relation(a, rels) ?? '').localeCompare(relation(b, rels) ?? '')
        ).flatMap((b) => edge(io, eid, b, rels)),
        others.flatMap((b) => reference(io, eid, b)),
      ),
    io.edits ? h(Link, { e, io }) : null,
  )
}

/** What an entity links to, and what names it. */
export let links = section({
  view: VIEW,
  match: true,
  title: 'Links',
  asks: (e) => ({
    refs: `.refs=${e.entity.eid}&.limit=${LINKS}`,
    // the far ends, so each is called by its name
    ends: `(.edges_from.edge.to=${e.entity.eid}` +
      `|.edges_to.edge.from=${e.entity.eid})&.limit=${LINKS}`,
  }),
  count: ({ got }) => got.refs?.ready ? rows(got.refs).length : undefined,
  Body,
})

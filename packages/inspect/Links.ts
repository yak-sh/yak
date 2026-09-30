/**
 * What an entity is linked to (`Inspect.Links`): its edges (@yaks/edge: an
 * entity wearing `edge{from, to}` and its relation component), grouped by the
 * relation they state, read from this end (`requires`, and from the far end
 * `required by`, or the relation's `reversed`); then every other entity whose
 * reference names this one, grouped by the property that does
 * (`comment.target`). Each entity at the far end is named, and linked. One
 * query answers both: `.refs=<eid>`.
 *
 * Edited, it is a table of every link, an edge whose relation a client may
 * write removed by its ×, and one added on the line under it by naming a
 * relation and the far end: a bundle wearing `edge` under a `$` alias, whose
 * eid the graph derives from its ends and its relation.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { useRef } from 'preact/hooks'
import { Button, Field, Pairs, Rows, Say, Value } from '@yaks/ui'
import type { Bundle, Io, Props, View } from './host.ts'
import { chip, relations } from './schema.ts'
import { Grid } from './grid.ts'
import { about, Part, useNamed } from './notes.ts'
import { comps, count, relation, str, writable } from './read.ts'
import { rows, waiting } from './rows.ts'
import { edited, key, write } from './state.ts'
import { mention } from './value.ts'

/** How many links a page reads. */
export let LINKS = 200

/** How many entities a group names before it says how many more. */
export let NAMED = 12

/** What the links are drawn with besides the entity: what the page shows in a
 * part of its own, by relation (`cites`) or by the property that names it
 * (`belief.about`), and the notes by heading. */
export type LinksCtx = { skip?: string[]; notes?: Map<string, Bundle[]> }

// The entity at an edge's far end from `eid`.
let far = (b: Bundle, eid: string) =>
  str(b, 'edge', 'from') == eid ? str(b, 'edge', 'to') : str(b, 'edge', 'from')

// Every property of `b` that names `eid`.
let naming = (b: Bundle, eid: string): string[] =>
  comps(b).flatMap(([name, row]) =>
    Object.entries(row).filter(([, v]) => v == eid).map(([p]) => `${name}.${p}`)
  )

/**
 * What a link reads as from `eid`'s end: the relation it states, or the far
 * end's phrase for it (`reversed`, else the relation and `(from)`); a
 * reference, by the property that names this one.
 */
let phrase = (io: Io, b: Bundle, eid: string, rels: string[]): string => {
  let rel = relation(b, rels)
  if (!b.edge || !rel) return naming(b, eid).join(', ')
  if (str(b, 'edge', 'from') == eid) return rel
  let back = io.vocab.comp(rel)?.keywords.reversed
  return typeof back == 'string' ? back : `${rel} (from)`
}

// Name a relation and the far end, and the edge is added.
let Link = ({ e, io }: { e: Bundle; io: Io }) => {
  let rels = relations(io).filter((r) => writable(io, r))
  let rel = useRef<HTMLSelectElement>(null)
  let to = useRef<HTMLInputElement>(null)
  if (!rels.length) return null
  let eid = e.entity.eid
  let send = (ev: Event) => {
    ev.preventDefault()
    let relation = rel.current?.value ?? rels[0]
    let end = String(to.current?.value ?? '').trim()
    if (!end) return
    if (to.current) to.current.value = ''
    write(io, key(eid, 'Links'), [{
      entity: { eid: '$edge' },
      edge: { from: eid, to: end },
      [relation]: {},
    }])
  }
  return h(
    Say,
    { onSubmit: send },
    h(
      'select',
      {
        ref: rel,
        class: 'Edit Edit-fit',
        name: 'relation',
        'aria-label': 'relation',
      },
      rels.map((r) => h('option', { key: r, value: r }, r)),
    ),
    h(Field, {
      elRef: to,
      name: 'to',
      'aria-label': 'to',
      placeholder: 'to: an id, T-12',
    }),
    h(Button, { type: 'submit', mod: 'add' }, '+ edge'),
  )
}

// Every link, a row each, each edge a client may write removable.
let Table = (
  { e, io, all, rels }: { e: Bundle; io: Io; all: Bundle[]; rels: string[] },
) => {
  let eid = e.entity.eid
  let end = (b: Bundle) => b.edge ? far(b, eid) : b.entity.eid
  return h(Grid, {
    io,
    id: key(eid, 'Links'),
    local: true,
    rows: all,
    pick: end,
    columns: [
      {
        name: 'link',
        cell: (b) =>
          b.edge
            ? chip(io, relation(b, rels) ?? 'edge')
            : h(Value, { mod: 'id' }, naming(b, eid).join(', ')),
      },
      {
        name: 'way',
        cell: (b) => b.edge && str(b, 'edge', 'from') == eid ? '→' : '←',
      },
      { name: 'entity', cell: (b) => mention(io, end(b)) },
      {
        name: '',
        cell: (b: Bundle) => {
          let rel = relation(b, rels)
          return b.edge && rel && writable(io, rel)
            ? h(Button, {
              type: 'button',
              mod: ['quiet', 'danger'],
              'aria-label': `remove this ${rel} edge`,
              onClick: () =>
                write(io, key(eid, 'Links'), [{
                  entity: { eid: b.entity.eid },
                  $delete: true,
                }]),
            }, '×')
            : null
        },
      },
    ],
  })
}

/** What an entity is linked to. */
export let Links = ({ e, io, ctx }: Props): JSX.Element | null => {
  let { skip = [], notes } = ctx as LinksCtx
  let eid = e.entity.eid
  let got = io.ask({ refs: `.refs=${eid}&.limit=${LINKS}` })
  let rels = relations(io)
  let shown = (b: Bundle) =>
    b.edge
      ? !skip.includes(relation(b, rels) ?? '')
      : !naming(b, eid).some((n) => skip.includes(n))
  let all = rows(got.refs).filter(shown)
  let end = (b: Bundle) => b.edge ? far(b, eid) : b.entity.eid
  let editing = edited(io, eid)
  let groups = [...Map.groupBy(all, (b) => phrase(io, b, eid, rels))]
    .toSorted(([a], [b]) => a.localeCompare(b))
  useNamed(io, groups.flatMap(([, bs]) => bs.slice(0, NAMED).map(end)))
  if (got.refs?.ready && !all.length && !editing) return null
  return h(
    Part,
    {
      io,
      eid,
      subject: about(io, e),
      heading: 'Links',
      count: got.refs?.ready ? all.length : undefined,
      notes,
    },
    waiting(got.refs) ?? (editing ? h(Table, { e, io, all, rels }) : h(
      Pairs,
      {},
      groups.flatMap(([said, bs]) => [
        h(Pairs.Key, { key: `${said} k` }, said),
        h(
          Pairs.Value,
          { key: `${said} v` },
          bs.slice(0, NAMED).flatMap((b, i) => [
            i ? ', ' : null,
            mention(io, end(b)),
          ]),
          bs.length > NAMED
            ? h(Rows.More, {}, `and ${count(bs.length - NAMED)} more`)
            : null,
        ),
      ]),
    )),
    editing ? h(Link, { e, io }) : null,
  )
}

/** The links of any entity. */
export let linkViews: View[] = [
  { view: 'Inspect.Links', match: true, Render: Links },
]

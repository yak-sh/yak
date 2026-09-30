/**
 * An entity's edges (@yaks/edge: an entity wearing `edge{from, to}` and its
 * relation component), a row each: the relation, which way it points, and
 * the entity at its far end, which a press on the row picks. After them, each
 * other entity whose reference names this one, by the property that does.
 * One query answers both: `.refs=<eid>`.
 *
 * Where the host's controls take input, an edge whose relation a client may
 * write is removed by its ×, and one is added on the line under the table
 * by naming a relation and the far end: a bundle wearing `edge` under a `$`
 * alias, whose eid the graph derives from its ends and its relation.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { useRef } from 'preact/hooks'
import { Button, Field, Say, Value } from '@yaks/ui'
import type { Bundle, Io } from './host.ts'
import { chip, relations } from './links.ts'
import { Grid } from './grid.ts'
import { about, Part, useNamed } from './notes.ts'
import { comps, relation, str, writable } from './read.ts'
import { rows, waiting } from './rows.ts'
import { key, write } from './state.ts'

/** How many links a page reads. */
export let LINKS = 200

// The entity at an edge's far end from `eid`.
let far = (b: Bundle, eid: string) =>
  str(b, 'edge', 'from') == eid ? str(b, 'edge', 'to') : str(b, 'edge', 'from')

// Every property of `b` that names `eid`.
let naming = (b: Bundle, eid: string): string[] =>
  comps(b).flatMap(([name, row]) =>
    Object.entries(row).filter(([, v]) => v == eid).map(([p]) => `${name}.${p}`)
  )

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
    write(io, key(eid, 'Edges'), [{
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

/** An entity's edges, and what names it. */
export let Edges = (
  { e, io, notes }: { e: Bundle; io: Io; notes: Map<string, Bundle[]> },
): JSX.Element => {
  let eid = e.entity.eid
  let got = io.ask({ refs: `.refs=${eid}&.limit=${LINKS}` })
  let rels = relations(io)
  let all = rows(got.refs)
  let edges = all.filter((b) => b.edge).toSorted((a, b) =>
    (relation(a, rels) ?? '').localeCompare(relation(b, rels) ?? '')
  )
  let others = all.filter((b) => !b.edge)
  useNamed(io, edges.map((b) => far(b, eid)))
  let end = (b: Bundle) => b.edge ? far(b, eid) : b.entity.eid
  return h(
    Part,
    {
      io,
      eid,
      subject: about(io, e),
      heading: 'Edges',
      count: got.refs?.ready ? all.length : undefined,
      notes,
    },
    waiting(got.refs) ?? h(Grid, {
      io,
      id: key(eid, 'Edges'),
      local: true,
      rows: [...edges, ...others],
      pick: end,
      columns: [
        {
          name: 'relation',
          cell: (b) =>
            b.edge
              ? chip(io, relation(b, rels) ?? 'edge')
              : h(Value, { mod: 'id' }, naming(b, eid).join(', ')),
        },
        {
          name: 'way',
          cell: (b) => b.edge && str(b, 'edge', 'from') == eid ? '→' : '←',
        },
        {
          name: 'entity',
          cell: (b) => h('a', { href: io.link(end(b)) }, io.name(end(b))),
        },
        ...io.edits
          ? [{
            name: '',
            cell: (b: Bundle) => {
              let rel = relation(b, rels)
              return b.edge && rel && writable(io, rel)
                ? h(Button, {
                  type: 'button',
                  mod: ['quiet', 'danger'],
                  'aria-label': `remove this ${rel} edge`,
                  onClick: () =>
                    write(io, key(eid, 'Edges'), [{
                      entity: { eid: b.entity.eid },
                      $delete: true,
                    }]),
                }, '×')
                : null
            },
          }]
          : [],
      ],
    }),
    io.edits ? h(Link, { e, io }) : null,
  )
}

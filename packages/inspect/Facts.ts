/**
 * What an entity states (`Inspect.Facts`): each component it carries that the
 * head and the body do not already say, in the order they mean (./read.ts
 * `facts`): the kinds it is, what else it carries, then what happened to it.
 *
 * Read, each component is a line: its name, linked to its page and telling
 * what it is where the pointer rests, then the values it holds, each as a
 * person reads it; one that holds nothing says what it means instead. Edited,
 * each is a table of every property it stores or declares, each value typed
 * over where it stands, and removed by its ×; the title and the body are
 * among them, since editing is where they change.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { Button, Pairs, Rows, Section, Value } from '@yaks/ui'
import type { Bundle, Io, Props, View } from './host.ts'
import { Cell, reads } from './value.ts'
import { Grid } from './grid.ts'
import { chip } from './schema.ts'
import { about, Part, Said, useNamed } from './notes.ts'
import { comp, comps, facts, line, named, writable } from './read.ts'
import { edited, key, write } from './state.ts'

/** What the facts are drawn with besides the entity: components the page
 * says in a part of its own, and the notes by heading. */
export type FactsCtx = { skip?: string[]; notes?: Map<string, Bundle[]> }

/** One component of an entity, edited: a row per property it stores or
 * declares, so a component just added shows what it can be given. */
export let CompTable = (
  { e, io, name, notes }: {
    e: Bundle
    io: Io
    name: string
    notes?: Map<string, Bundle[]>
  },
): JSX.Element => {
  let eid = e.entity.eid
  let row = comp(e, name)
  let props = [...new Set([...Object.keys(row), ...io.vocab.props(name)])]
  let refs = props.filter((p) => io.vocab.prop(name, p)?.category == 'ref')
  useNamed(io, refs.map((p) => row[p] as string))
  let remove = writable(io, name)
    ? h(Button, {
      type: 'button',
      mod: ['quiet', 'danger'],
      'aria-label': `remove ${name}`,
      title: `remove ${name}`,
      onClick: () => write(io, eid, [{ entity: { eid }, [name]: null }]),
    }, '×')
    : null
  return h(
    Part,
    {
      io,
      eid,
      subject: about(io, e),
      heading: name,
      title: chip(io, name),
      act: remove,
      sub: io.vocab.comp(name)?.description,
      notes,
    },
    props.length
      ? h(Grid, {
        io,
        id: key(eid, name),
        pick: false,
        local: true,
        rows: props.map((prop): Bundle => ({ entity: { eid: prop } })),
        columns: [
          { name: 'property', mod: 'key', cell: (p) => p.entity.eid },
          {
            name: 'value',
            cell: (p) => h(Cell, { io, e, name, prop: p.entity.eid }),
          },
        ],
      })
      : h(Rows.More, {}, 'no properties: it is there, or not'),
  )
}

// One component, read: the values it holds, or what it means; and the notes
// left under it.
let stated = (
  io: Io,
  e: Bundle,
  name: string,
  notes?: Map<string, Bundle[]>,
) => {
  let held = Object.entries(comp(e, name)).filter(([, v]) =>
    v != null && v !== ''
  )
  let what = io.vocab.comp(name)?.description
  let eid = e.entity.eid
  return [
    h(Pairs.Key, { key: `${name} k`, 'data-tip': what }, chip(io, name)),
    h(
      Pairs.Value,
      { key: `${name} v` },
      held.length
        ? held.flatMap(([p, v], i) => [
          i ? ' · ' : null,
          h(Value, { key: p, mod: 'id' }, p),
          ' ',
          reads(io, v, io.vocab.prop(name, p)),
        ])
        : h(Value, { mod: 'nil' }, line(what ?? 'there', 120)),
      h(Said, {
        io,
        eid,
        subject: about(io, e),
        heading: name,
        notes: notes?.get(name),
      }),
    ),
  ]
}

/** What an entity states. */
export let Facts = ({ e, io, ctx }: Props): JSX.Element | null => {
  let { skip = [], notes } = ctx as FactsCtx
  let editing = edited(io, e.entity.eid)
  let names = editing
    ? comps(e).map(([n]) => n).filter((n) => !skip.includes(n))
    : facts(io.vocab, e, skip)
  useNamed(
    io,
    names.flatMap((n) => Object.values(comp(e, n)).filter(named)),
  )
  if (!names.length) return null
  return editing
    ? h(
      'div',
      {},
      names.map((name) => h(CompTable, { key: name, e, io, name, notes })),
    )
    : h(
      Section,
      { 'data-facts': '' },
      h(Pairs, {}, names.flatMap((n) => stated(io, e, n, notes))),
    )
}

/** The facts of any entity. */
export let factViews: View[] = [
  { view: 'Inspect.Facts', match: true, Render: Facts },
]

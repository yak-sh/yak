/**
 * A component's page (`_comp`, @yaks/vocab): its name, its package and what
 * it is; its properties; the sets of components it is found with, and how
 * many entities each set makes; the components it refers to and those that
 * refer to it, through reference properties; and the entities carrying it, a
 * row each and a column per property, a page at a time, sorted by any column
 * that sorts.
 *
 * How many entities each set makes is a tally over the entities carrying
 * this component (`.<name>&.tally=entity.archetype`), asked once; the sets'
 * components are asked for the page of them shown.
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { parse } from '@yaks/query'
import { Head, Value } from '@yaks/ui'
import type { Answer, Bundle, Io, Props, View } from './host.ts'
import { Cell } from './cell.ts'
import { type Column, Grid, paged, SIZE } from './grid.ts'
import { chip, chips } from './links.ts'
import {
  NoteButton,
  Part,
  Said,
  under,
  useNamed,
  useNotes,
  useSets,
} from './notes.ts'
import { comp, count, flags, line, str, tables, typed } from './read.ts'
import { rows, waiting } from './rows.ts'
import { grid, key } from './state.ts'

/** A component's name, off its `_comp` bundle. */
export let nameOf = (e: Bundle): string => str(e, '_comp', 'name')

let HEADINGS = ['Properties', 'Found with', 'Refers to', 'Entities']

type Part_ = { e: Bundle; io: Io; notes: Map<string, Bundle[]> }

// What the vocabulary says of how the component is kept.
let kept = (io: Io, name: string): string[] => {
  let c = io.vocab.comp(name)
  if (!c) return []
  let prefix = c.keywords.prefix
  return [
    c.kind && 'kind',
    typeof prefix == 'string' && `prefix ${prefix}`,
    c.mark && 'mark',
    !c.wire && 'read-only to clients',
    c.computed && 'computed',
    c.sync != 'server' && `sync ${c.sync}`,
    c.durable != 'forever' && `durable ${c.durable}`,
    c.keywords.edge != null && 'edge relation',
  ].filter((f): f is string => !!f)
}

let Top = ({ e, io, notes }: Part_) => {
  let eid = e.entity.eid
  let name = nameOf(e)
  let pkg = str(e, '_comp', 'package')
  useNamed(io, [pkg])
  return h(
    'div',
    {},
    h(
      Head,
      {},
      h(
        Head.Title,
        {},
        name,
        h(Head.Kind, {}, 'component'),
        h(NoteButton, { io, eid, heading: '', subject: name }),
      ),
      h(Head.Sub, {}, str(e, 'doc', 'body')),
      h(
        Head.Facts,
        {},
        pkg ? h('a', { href: io.link(pkg) }, io.name(pkg)) : 'no package',
        ...kept(io, name).map((f) => h('span', {}, f)),
      ),
    ),
    h(Said, { io, eid, subject: name, heading: '', notes: notes.get('') }),
  )
}

// Its properties, in declared order.
let Properties = ({ e, io, notes, props }: Part_ & { props: Answer }) =>
  h(
    Part,
    {
      io,
      eid: e.entity.eid,
      subject: nameOf(e),
      heading: 'Properties',
      count: props.ready ? rows(props).length : undefined,
      notes,
    },
    waiting(props) ?? h(Grid, {
      io,
      id: key(e.entity.eid, 'Properties'),
      local: true,
      rows: rows(props),
      columns: [
        {
          name: 'name',
          cell: (b) =>
            h('a', { href: io.link(b.entity.eid) }, str(b, '_prop', 'name')),
        },
        { name: 'type', cell: (b) => typed(comp(b, '_prop')) },
        {
          name: 'description',
          mod: 'prose',
          cell: (b) => line(str(b, 'doc', 'body'), 200),
        },
        { name: 'flags', cell: (b) => flags(comp(b, '_prop')).join(' ') },
      ],
    }),
  )

// The sets of components it is found with, most entities first.
let Found = ({ e, io, notes }: Part_) => {
  let eid = e.entity.eid
  let id = key(eid, 'Found with')
  let got = io.ask({
    tally: { query: `.${nameOf(e)}&.tally=entity.archetype`, once: true },
  })
  let tally = got.tally?.tally ?? {}
  let sets = Object.keys(tally).toSorted((a, b) => tally[b] - tally[a])
  let page = grid(io, id).after?.length ?? 0
  let shown = sets.slice(page * SIZE, (page + 1) * SIZE)
  io.ask(
    shown.length
      ? {
        sets: `.archetype&.entity.eid=${
          shown.join(',')
        }&.fields=archetype.tables`,
      }
      : {},
  )
  return h(
    Part,
    {
      io,
      eid,
      subject: nameOf(e),
      heading: 'Found with',
      count: got.tally?.tally ? sets.length : undefined,
      notes,
    },
    waiting(got.tally) ?? h(Grid, {
      io,
      id,
      local: true,
      rows: sets.map((s): Bundle => ({ entity: { eid: s } })),
      columns: [
        {
          name: 'components',
          cell: (b) => {
            let set = io.get(b.entity.eid)
            return set ? chips(io, tables(set)) : '…'
          },
        },
        {
          name: 'entities',
          mod: 'num',
          cell: (b) =>
            h(
              'a',
              { href: io.find(`.entity.archetype=${b.entity.eid}`) },
              count(tally[b.entity.eid] ?? 0),
            ),
        },
      ],
    }),
  )
}

// What it refers to through its references, and what refers to it.
let Refers = (
  { e, io, notes, props }: Part_ & { props: Answer },
) => {
  let name = nameOf(e)
  let got = io.ask({ into: `._prop&._prop.ref=${name}&?doc` })
  let out = rows(props).filter((b) => str(b, '_prop', 'ref'))
  let into = rows(got.into)
  let all = [...out, ...into]
  let target = (b: Bundle) => str(b, '_prop', 'ref')
  return h(
    Part,
    {
      io,
      eid: e.entity.eid,
      subject: name,
      heading: 'Refers to',
      title: 'Refers to, and referred to by',
      count: props.ready && got.into?.ready ? all.length : undefined,
      notes,
    },
    waiting(props) ?? waiting(got.into) ?? h(Grid, {
      io,
      id: key(e.entity.eid, 'Refers to'),
      local: true,
      rows: all,
      columns: [
        {
          name: 'property',
          cell: (b) =>
            h('a', { href: io.link(b.entity.eid) }, str(b, 'doc', 'title')),
        },
        {
          name: 'way',
          cell: (b) => out.includes(b) ? '→' : '←',
        },
        {
          name: 'component',
          cell: (b) =>
            out.includes(b)
              ? target(b) == 'entity'
                ? h(Value, { mod: 'nil' }, 'any entity')
                : chip(io, target(b))
              : chip(io, str(b, 'doc', 'title').split('.')[0]),
        },
      ],
    }),
  )
}

// Whether the graph can run rows by a property: anything but JSON.
let sorts = (io: Io, name: string, prop: string) =>
  io.vocab.prop(name, prop)?.scalar != 'jsonb'

// Whether a property holds a number, whose column sets right.
let numeric = (io: Io, name: string, prop: string) =>
  ['number', 'priority'].includes(io.vocab.prop(name, prop)?.scalar ?? '')

// The entities carrying it, a page at a time.
let Entities = ({ e, io, notes }: Part_) => {
  let eid = e.entity.eid
  let name = nameOf(e)
  let id = key(eid, 'Entities')
  let props = io.vocab.props(name)
  let got = io.ask({
    rows: paged(io, id, `.${name}`),
    titles: `${paged(io, id, `.${name}`)}&.fields=doc.title`,
    total: { query: `.${name}&.count`, once: true },
  })
  let title = new Map(
    rows(got.titles).map((b) => [b.entity.eid, str(b, 'doc', 'title')]),
  )
  let refs = props.filter((p) => io.vocab.prop(name, p)?.category == 'ref')
  useSets(io, rows(got.rows))
  useNamed(
    io,
    rows(got.rows).flatMap((b) => refs.map((p) => comp(b, name)[p] as string)),
  )
  return h(
    Part,
    {
      io,
      eid,
      subject: name,
      heading: 'Entities',
      count: got.total?.count,
      note: h('a', { href: io.find(`.${name}`) }, `.${name}`),
      notes,
    },
    waiting(got.rows) ?? h(Grid, {
      io,
      id,
      rows: rows(got.rows),
      total: got.total?.count,
      columns: [
        {
          name: 'id',
          cell: (b) => h('a', { href: io.link(b.entity.eid) }, io.id(b)),
        },
        ...[...title.values()].some(Boolean)
          ? [{
            name: 'title',
            cell: (b: Bundle) => line(title.get(b.entity.eid), 80),
          }]
          : [],
        ...props.map((prop): Column => ({
          name: prop,
          sort: sorts(io, name, prop) ? `${name}.${prop}` : undefined,
          mod: numeric(io, name, prop) ? 'num' : undefined,
          cell: (b: Bundle) => h(Cell, { io, e: b, name, prop }),
        })),
      ],
    }),
  )
}

/** A component's own page. */
export let CompPage = ({ e, io }: Props): JSX.Element => {
  let name = nameOf(e)
  let notes = under(useNotes(io, e.entity.eid), name, HEADINGS)
  let got = io.ask({
    props: `._prop&._prop.comp=${e.entity.eid}&.order=_prop.ord&*`,
  })
  return h(
    'div',
    { 'data-inspect': e.entity.eid },
    h(Top, { e, io, notes }),
    h(Properties, { e, io, notes, props: got.props }),
    h(Found, { e, io, notes }),
    h(Refers, { e, io, notes, props: got.props }),
    h(Entities, { e, io, notes }),
  )
}

/** A component's page. */
export let compViews: View[] = [
  { view: 'Inspect.Page', match: parse('._comp'), Render: CompPage },
]

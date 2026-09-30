/**
 * A component's page (`_comp`, @yaks/vocab): what it is, its package, how many
 * entities carry it and how it is kept; its properties; the sets of
 * components it is found with; what it refers to and what refers to it, both
 * through reference properties and through edges, each relation with how many
 * edges state it and what is at their far end; and the entities carrying it,
 * a row each and a column per property, a page at a time, sorted by any column
 * that sorts.
 *
 * How many carry it, and the sets it is found in, are read off the census
 * every map page shares (./census.ts); the edges, off a tally of the edges
 * whose ends are made of those sets, asked once.
 *
 * @module
 */

import { type ComponentChildren, h, type JSX } from 'preact'
import { parse } from '@yaks/query'
import { Value } from '@yaks/ui'
import type { Answer, Bundle, Io, Props, View } from './host.ts'
import { type Census, useCensus, within } from './census.ts'
import { type Column, Grid, paged } from './grid.ts'
import { chip, chips, relations } from './schema.ts'
import { Part, useNamed, useSets } from './notes.ts'
import { usePageNotes } from './Entity.ts'
import { comp, count, flags, line, str, tables, typed } from './read.ts'
import { rows, waiting } from './rows.ts'
import { edited, key } from './state.ts'
import { Cell, reads } from './value.ts'

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
    c.kind && 'a kind',
    typeof prefix == 'string' && `ids ${prefix}-`,
    c.mark && 'a mark',
    !c.wire && 'read-only to clients',
    c.computed && 'computed',
    c.sync != 'server' && `sync ${c.sync}`,
    c.durable != 'forever' && `kept ${c.durable}`,
    c.keywords.edge != null && 'an edge relation',
  ].filter((f): f is string => !!f)
}

// A reference property's target: a component, or any entity.
let target = (io: Io, ref: string) =>
  !ref || ref == 'entity'
    ? h(Value, { mod: 'nil' }, 'any entity')
    : chip(io, ref)

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
          value: (b) => str(b, '_prop', 'name'),
          cell: (b) =>
            h('a', { href: io.link(b.entity.eid) }, str(b, '_prop', 'name')),
        },
        {
          name: 'type',
          cell: (b) => {
            let p = comp(b, '_prop')
            let ref = str(b, '_prop', 'ref')
            return p.ref
              ? h(
                'span',
                {},
                typed({ ...p, ref: null }),
                ' → ',
                target(io, ref),
              )
              : typed(p)
          },
        },
        {
          name: 'what it is',
          mod: 'prose',
          cell: (b) => line(str(b, 'doc', 'body'), 200),
        },
        { name: 'flags', cell: (b) => flags(comp(b, '_prop')).join(' ') },
      ],
    }),
  )

// The sets of components it is found with, most entities first.
let Found = ({ e, io, notes, census }: Part_ & { census: Census }) => {
  let name = nameOf(e)
  let sets = within(census.sets, name)
  return h(
    Part,
    {
      io,
      eid: e.entity.eid,
      subject: name,
      heading: 'Found with',
      count: census.ready ? sets.length : undefined,
      notes,
    },
    waiting({ rows: sets, ready: census.ready, error: census.error }) ??
      h(Grid, {
        io,
        id: key(e.entity.eid, 'Found with'),
        local: true,
        rows: sets,
        columns: [
          {
            name: 'with',
            cell: (b) => {
              let others = tables(b).filter((t) => t != name)
              return others.length
                ? chips(io, others)
                : h(Value, { mod: 'nil' }, 'nothing else')
            },
          },
          {
            name: 'entities',
            mod: 'num',
            value: (b) => census.tally[b.entity.eid] ?? 0,
            cell: (b) =>
              h(
                'a',
                { href: io.find(`.entity.archetype=${b.entity.eid}`) },
                count(census.tally[b.entity.eid] ?? 0),
              ),
          },
        ],
      }),
  )
}

/** One way a component is linked: which way, through what, to what, and
 * how often where edges say it. */
type Tie = {
  entity: { eid: string }
  way: '→' | '←'
  through: ComponentChildren
  far: ComponentChildren
  n?: number
}

// Each set's kind, by the set's eid: what an entity made of it shows as.
let kinds = (io: Io, census: Census, eids: string[]) => {
  let of = new Map(census.sets.map((s) => [s.entity.eid, tables(s)]))
  return eids.map((eid) =>
    io.vocab.kindOf(
      Object.fromEntries((of.get(eid) ?? []).map((t) => [t, {}])),
    ) || 'entity'
  )
}

// A tally of sets read as how many of each kind: `entry 650, doc 20`.
let spread = (io: Io, census: Census, tally: Record<string, number>) => {
  let eids = Object.keys(tally)
  let by = new Map<string, number>()
  kinds(io, census, eids).forEach((k, i) =>
    by.set(k, (by.get(k) ?? 0) + tally[eids[i]])
  )
  let all = [...by].toSorted(([, a], [, b]) => b - a)
  return all.length
    ? h(
      'span',
      {},
      all.flatMap((
        [k, n],
        i,
      ) => [i ? ', ' : null, chip(io, k), ` ${count(n)}`]),
    )
    : h(Value, { mod: 'nil' }, '…')
}

// The edges of one relation from (or to) the sets `archs`, by what their far
// end is made of: asked once.
let FarEnds = (
  { io, census, relation, way, archs }: {
    io: Io
    census: Census
    relation: string
    way: 'from' | 'to'
    archs: string[]
  },
) => {
  let far = way == 'from' ? 'to' : 'from'
  let got = io.ask({
    far: {
      query: `.${relation}&.edge.${way}.entity.archetype=${archs.join(',')}` +
        `&.tally=edge.${far}.entity.archetype`,
      once: true,
    },
  })
  return got.far?.tally ? spread(io, census, got.far.tally) : '…'
}

// What it refers to, and what refers to it: through its reference properties
// and others', and through edges whose ends carry it.
let Refers = (
  { e, io, notes, props, census }: Part_ & { props: Answer; census: Census },
) => {
  let name = nameOf(e)
  let eid = e.entity.eid
  let archs = within(census.sets, name).map((s) => s.entity.eid)
  let ends = (way: 'from' | 'to') =>
    `.edge&.edge.${way}.entity.archetype=${archs.join(',')}` +
    `&.tally=entity.archetype`
  let got = io.ask({
    into: `._prop&._prop.ref=${name}&?doc&?_prop`,
    ...archs.length
      ? {
        out: { query: ends('from'), once: true },
        in: { query: ends('to'), once: true },
      }
      : {},
  })
  let rels = relations(io)
  // Edges by relation, off a tally of the edges' own sets.
  let byRelation = (tally: Record<string, number> = {}) => {
    let by = new Map<string, number>()
    let of = new Map(census.sets.map((s) => [s.entity.eid, tables(s)]))
    for (let [set, n] of Object.entries(tally)) {
      let rel = (of.get(set) ?? []).find((t) => rels.includes(t))
      if (rel) by.set(rel, (by.get(rel) ?? 0) + n)
    }
    return [...by].toSorted(([, a], [, b]) => b - a)
  }
  let edge = (way: '→' | '←', [rel, n]: [string, number]): Tie => ({
    entity: { eid: `${way} ${rel}` },
    way,
    through: chip(io, rel),
    far: h(FarEnds, {
      io,
      census,
      relation: rel,
      way: way == '→' ? 'from' : 'to',
      archs,
    }),
    n,
  })
  let ties: Tie[] = [
    ...rows(props).filter((b) => str(b, '_prop', 'ref')).map((b): Tie => ({
      entity: { eid: b.entity.eid },
      way: '→',
      through: h('a', { href: io.link(b.entity.eid) }, str(b, 'doc', 'title')),
      far: target(io, str(b, '_prop', 'ref')),
    })),
    ...byRelation(got.out?.tally).map((r) => edge('→', r)),
    ...rows(got.into).map((b): Tie => ({
      entity: { eid: b.entity.eid },
      way: '←',
      through: h('a', { href: io.link(b.entity.eid) }, str(b, 'doc', 'title')),
      far: chip(io, str(b, 'doc', 'title').split('.')[0]),
    })),
    ...byRelation(got.in?.tally).map((r) => edge('←', r)),
  ]
  let ready = props.ready && got.into?.ready &&
    (!archs.length || (!!got.out?.tally && !!got.in?.tally))
  let tie = new Map(ties.map((t) => [t.entity.eid, t]))
  let of = (b: Bundle) => tie.get(b.entity.eid)!
  return h(
    Part,
    {
      io,
      eid,
      subject: name,
      heading: 'Refers to',
      title: 'Refers to, and referred to by',
      count: ready ? ties.length : undefined,
      notes,
    },
    waiting(props) ?? waiting(got.into) ?? h(Grid, {
      io,
      id: key(eid, 'Refers to'),
      local: true,
      pick: false,
      rows: ties.map((t): Bundle => ({ entity: t.entity })),
      columns: [
        { name: 'way', cell: (b) => of(b).way },
        { name: 'through', cell: (b) => of(b).through },
        { name: 'at the other end', cell: (b) => of(b).far },
        {
          name: 'edges',
          mod: 'num',
          cell: (b) => of(b).n != null ? count(of(b).n!) : '',
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

// The entities carrying it, a page at a time: each value read, or, while the
// page is edited, changed where it stands.
let Entities = ({ e, io, notes, census }: Part_ & { census: Census }) => {
  let eid = e.entity.eid
  let name = nameOf(e)
  let id = key(eid, 'Entities')
  let props = io.vocab.props(name)
  let got = io.ask({
    rows: paged(io, id, `.${name}`),
    titles: `${paged(io, id, `.${name}`)}&.fields=doc.title`,
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
  let editing = edited(io, eid)
  let total = census.ready ? census.carried[name] ?? 0 : undefined
  return h(
    Part,
    {
      io,
      eid,
      subject: name,
      heading: 'Entities',
      count: total,
      note: h('a', { href: io.find(`.${name}`) }, `.${name}`),
      notes,
    },
    waiting(got.rows) ?? h(Grid, {
      io,
      id,
      rows: rows(got.rows),
      total,
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
          cell: (b: Bundle) =>
            editing
              ? h(Cell, { io, e: b, name, prop })
              : reads(io, comp(b, name)[prop], io.vocab.prop(name, prop)),
        })),
      ],
    }),
  )
}

/** A component's own page. */
export let CompPage = ({ e, io }: Props): JSX.Element => {
  let name = nameOf(e)
  let notes = usePageNotes(io, e, HEADINGS)
  let census = useCensus(io)
  let got = io.ask({
    props: `._prop&._prop.comp=${e.entity.eid}&.order=_prop.ord&*`,
  })
  let pkg = str(e, '_comp', 'package')
  useNamed(io, [pkg])
  let n = census.carried[name]
  let sub = [
    io.vocab.comp(name)?.description ?? str(e, 'doc', 'body'),
    h('br', {}),
    pkg
      ? ['from ', h('a', { href: io.link(pkg) }, io.name(pkg))]
      : 'no package',
    census.ready ? ` · carried by ${count(n ?? 0)} entities` : '',
    ...kept(io, name).map((f) => ` · ${f}`),
  ]
  return h(
    'div',
    { 'data-inspect': e.entity.eid },
    io.show(e, 'Inspect.Head', { sub, notes: notes.get(''), subject: name }),
    h(Properties, { e, io, notes, props: got.props }),
    h(Found, { e, io, notes, census }),
    h(Refers, { e, io, notes, props: got.props, census }),
    h(Entities, { e, io, notes, census }),
  )
}

/** A component's page. */
export let compViews: View[] = [
  { view: 'Inspect.Page', match: parse('._comp'), Render: CompPage },
]

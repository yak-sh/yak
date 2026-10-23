/**
 * The schema: how the graph's data is made, one slice at a time, each a
 * listing to press into.
 *
 * - Packages: a tree of each package the vocabulary is served from, the
 *   components and effects it declares, and the properties of each
 *   component: what each is, what it holds and how many entities carry it.
 *   Opening a package shows its components and effects, opening a component
 *   its properties.
 * - Components: every component, its package, what it is and how many
 *   entities carry it, the most carried first.
 * - Relations: every component that is an edge relation (@yaks/edge), what it
 *   reads as from the far end, and how many edges state it.
 * - Archetypes: every set of components entities are made of, the most
 *   populous first.
 *
 * Which slice shows, which rows are open and how each table runs are the
 * page's own state (./state.ts), so the map shows as it was left. Names, what
 * each is and what it holds come from the vocabulary the host was served, so
 * the map paints at once; every count comes from one census (./census.ts),
 * which the graph answers from the populations it keeps, and fills in when
 * it does.
 *
 * @module
 */

import { type ComponentChildren, h, type JSX } from 'preact'
import { Head, Loading, Tabs, Value } from '@yaks/ui'
import { type EffectDecl, effectsIn } from '@yaks/vocab'
import type { Bundle, Io } from './host.ts'
import { type Census, useCensus } from './census.ts'
import { Grid } from './grid.ts'
import {
  chip,
  chips,
  compEid,
  effectEid,
  packEid,
  propEid,
  relations,
} from './schema.ts'
import { Part, under, useNotes } from './notes.ts'
import { count, line, str, tables } from './read.ts'
import { waiting } from './rows.ts'
import { key, me, put } from './state.ts'

/** The slices of the schema the map shows, the first when none is chosen. */
export let SLICES = ['packages', 'components', 'relations', 'archetypes']

// Each slice's heading, and the component its notes are about: what its
// rows are made of.
let SLICE: Record<string, { heading: string; concept: string }> = {
  packages: { heading: 'Packages', concept: '_package' },
  components: { heading: 'Components', concept: '_comp' },
  relations: { heading: 'Relations', concept: 'edge' },
  archetypes: { heading: 'Archetypes', concept: 'archetype' },
}

// Keep known counts visible during a refresh, not zeroes before the census.
let tallied = (ready: boolean, n: number) =>
  ready || n ? count(n) : h(Loading, {})

let plural = (n: number, one: string, many: string) =>
  `${count(n)} ${n == 1 ? one : many}`

// A property's type, in a word: what it points at, the values it takes, or
// its scalar.
let typeOf = (io: Io, comp: string, prop: string): string => {
  let p = io.vocab.prop(comp, prop)
  return p?.ref
    ? `→ ${p.ref}`
    : p?.values?.join(' | ') ?? p?.types?.join(' | ') ?? p?.scalar ?? ''
}

/** What every slice reads: the vocabulary's packages, the components and
 * effects each declares, and the census. */
type Schema = {
  io: Io
  census: Census
  packages: string[]
  declared: Map<string, string[]>
  effects: Map<string, EffectDecl[]>
}

// The rows of the package tree, each made of the vocabulary component it
// stands for: a property's row names its component as the graph does, by
// its eid.
let packRow = (name: string): Bundle => ({
  entity: { eid: packEid(name) },
  _package: { name },
})
let compRow = (name: string): Bundle => ({
  entity: { eid: compEid(name) },
  _comp: { name },
})
let propRow = (comp: string, prop: string): Bundle => ({
  entity: { eid: propEid(comp, prop) },
  _prop: { name: prop, comp: compEid(comp) },
})
let effectRow = ({ name }: EffectDecl): Bundle => ({
  entity: { eid: effectEid(name) },
  _effect: { name },
})

// What a row of the package tree says: its name and the link drawn for it,
// what it holds (a count of the rows under it, or a property's type, in
// words and to sort by), what it is, how many entities carry it (none for a
// property or an effect, which the census does not count), and the rows
// under it.
type Node = {
  name: string
  link: ComponentChildren
  holds: number | string
  said: string
  about?: string
  entities?: number
  kids: Bundle[]
}

// The package tree: packages, then the components and effects each
// declares, then the properties of each component.
let PackageTree = ({ io, census, packages, declared, effects }: Schema) => {
  let { carried, sets, tally, ready } = census
  let vocab = io.vocab
  let names = new Map(vocab.all.map((n) => [compEid(n), n]))
  // How many entities carry any of a package's components.
  let reach = new Map<string, number>()
  for (let s of sets) {
    let own = new Set(tables(s).map((t) => vocab.comp(t)?.package ?? ''))
    for (let p of own) {
      reach.set(p, (reach.get(p) ?? 0) + (tally[s.entity.eid] ?? 0))
    }
  }
  let described = new Map(
    [...effects.values()].flat().map((x) => [x.name, x.description]),
  )
  let read = (b: Bundle): Node => {
    if (b._package) {
      let name = str(b, '_package', 'name')
      let comps = declared.get(name) ?? []
      let acts = effects.get(name) ?? []
      return {
        name,
        link: name
          ? io.show(io.get(b.entity.eid) ?? b, 'Inspect.Reference.Inline')
          : h(Value, { mod: 'nil' }, 'unpackaged'),
        holds: comps.length + acts.length,
        said: [
          plural(comps.length, 'component', 'components'),
          acts.length ? plural(acts.length, 'effect', 'effects') : '',
        ].filter(Boolean).join(' · '),
        about: vocab.docs.find((d) => d.package == name)?.description,
        entities: reach.get(name) ?? 0,
        kids: [...comps.map(compRow), ...acts.map(effectRow)],
      }
    }
    if (b._effect) {
      let name = str(b, '_effect', 'name')
      return {
        name,
        link: io.show(b, 'Inline'),
        holds: 'an effect',
        said: 'an effect',
        about: described.get(name),
        kids: [],
      }
    }
    if (b._comp) {
      let name = str(b, '_comp', 'name')
      let kids = vocab.props(name).map((p) => propRow(name, p))
      return {
        name,
        link: chip(io, name),
        holds: kids.length,
        said: kids.length
          ? plural(kids.length, 'property', 'properties')
          : 'a mark',
        about: vocab.comp(name)?.description,
        entities: carried[name] ?? 0,
        kids,
      }
    }
    let name = str(b, '_prop', 'name')
    let comp = names.get(str(b, '_prop', 'comp')) ?? ''
    let type = typeOf(io, comp, name)
    return {
      name,
      link: io.show(b, 'Inline'),
      holds: type,
      said: type,
      about: vocab.prop(comp, name)?.description,
      kids: [],
    }
  }
  let nodes = new Map<string, Node>()
  let node = (b: Bundle) =>
    nodes.get(b.entity.eid) ??
      nodes.set(b.entity.eid, read(b)).get(b.entity.eid)!
  return h(Grid, {
    io,
    id: key('schema', 'Packages'),
    local: true,
    rows: packages.map(packRow),
    columns: [
      { name: 'name', value: (b) => node(b).name, cell: (b) => node(b).link },
      { name: 'holds', value: (b) => node(b).holds, cell: (b) => node(b).said },
      {
        name: 'what it is',
        mod: 'prose',
        cell: (b) => line(node(b).about, 200),
      },
      {
        name: 'entities',
        mod: 'num',
        value: (b) => node(b).entities ?? 0,
        cell: (b) => {
          let n = node(b).entities
          return n == null ? '' : tallied(ready, n)
        },
      },
    ],
    pick: (b) => node(b).name ? b.entity.eid : undefined,
    holds: (b) => node(b).kids,
  })
}

// Every component, the most carried first.
let ComponentList = ({ io, census: { carried, ready } }: Schema) => {
  let vocab = io.vocab
  let comps = vocab.all.toSorted((a, b) =>
    (carried[b] ?? 0) - (carried[a] ?? 0) || a.localeCompare(b)
  )
  return h(Grid, {
    io,
    id: key('schema', 'Components'),
    local: true,
    rows: comps.map(compRow),
    columns: [
      {
        name: 'component',
        value: (b) => str(b, '_comp', 'name'),
        cell: (b) => chip(io, str(b, '_comp', 'name')),
      },
      {
        name: 'package',
        value: (b) => vocab.comp(str(b, '_comp', 'name'))?.package ?? '',
        cell: (b) => vocab.comp(str(b, '_comp', 'name'))?.package ?? '',
      },
      {
        name: 'what it is',
        mod: 'prose',
        cell: (b) =>
          line(vocab.comp(str(b, '_comp', 'name'))?.description, 160),
      },
      {
        name: 'entities',
        mod: 'num',
        value: (b) => carried[str(b, '_comp', 'name')] ?? 0,
        cell: (b) => tallied(ready, carried[str(b, '_comp', 'name')] ?? 0),
      },
    ],
  })
}

// Every edge relation, what it reads as from the far end, and its edges.
let RelationList = ({ io, census: { carried, ready } }: Schema) => {
  let vocab = io.vocab
  return h(Grid, {
    io,
    id: key('schema', 'Relations'),
    local: true,
    rows: relations(io).toSorted().map(compRow),
    columns: [
      {
        name: 'relation',
        value: (b) => str(b, '_comp', 'name'),
        cell: (b) => chip(io, str(b, '_comp', 'name')),
      },
      {
        name: 'from the far end',
        cell: (b) => {
          let back = vocab.comp(str(b, '_comp', 'name'))?.keywords.reversed
          return typeof back == 'string'
            ? back
            : h(Value, { mod: 'nil' }, 'the same')
        },
      },
      {
        name: 'edges',
        mod: 'num',
        value: (b) => carried[str(b, '_comp', 'name')] ?? 0,
        cell: (b) => tallied(ready, carried[str(b, '_comp', 'name')] ?? 0),
      },
      {
        name: 'package',
        value: (b) => vocab.comp(str(b, '_comp', 'name'))?.package ?? '',
        cell: (b) => vocab.comp(str(b, '_comp', 'name'))?.package ?? '',
      },
    ],
  })
}

// Every set of components entities are made of, the most populous first; a
// set's count lists its entities.
let ArchetypeList = ({ io, census }: Schema) =>
  waiting({ rows: census.sets, ready: census.ready, error: census.error }) ??
    h(Grid, {
      io,
      id: key('schema', 'Archetypes'),
      local: true,
      rows: census.sets,
      columns: [
        {
          name: 'components',
          cell: (b) =>
            tables(b).length
              ? chips(io, tables(b))
              : h(Value, { mod: 'nil' }, 'no components'),
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
    })

// What each slice says under its heading, and draws.
let BODY: Record<
  string,
  {
    sub: string
    Body: (m: Schema) => JSX.Element | null
    size: (m: Schema) => number | undefined
  }
> = {
  packages: {
    sub: 'Each package the vocabulary is served from. Open one for the ' +
      'components it declares, and a component for its properties; press a ' +
      'row to open its page.',
    Body: PackageTree,
    size: (m) => m.packages.length,
  },
  components: {
    sub: 'Every component and how many entities carry it, the most carried ' +
      'first; a pressed heading runs them by it.',
    Body: ComponentList,
    size: (m) => m.io.vocab.all.length,
  },
  relations: {
    sub: 'Every component that relates one entity to another, what it reads ' +
      'as from the far end, and how many edges state it.',
    Body: RelationList,
    size: (m) => relations(m.io).length,
  },
  archetypes: {
    sub: 'Every set of components entities are made of, the most populous ' +
      'first; press a count to list them.',
    Body: ArchetypeList,
    size: (m) => m.census.ready ? m.census.sets.length : undefined,
  },
}

// The slice showing, under its heading, with the notes left there; notes on
// a slice are about the component its rows are made of.
let Slice = ({ slice, ...m }: Schema & { slice: string }) => {
  let { heading, concept } = SLICE[slice]
  let eid = compEid(concept)
  let { sub, Body, size } = BODY[slice]
  return h(
    Part,
    {
      io: m.io,
      eid,
      subject: concept,
      heading,
      notes: under(useNotes(m.io, eid), concept, [heading]),
      count: size(m),
      sub,
    },
    h(Body, m),
  )
}

/** The map of the schema. */
export let HomePage = ({ io }: { io: Io }): JSX.Element => {
  let census = useCensus(io)
  let vocab = io.vocab
  let declared = Map.groupBy(
    vocab.all.toSorted(),
    (n) => vocab.comp(n)?.package ?? '',
  )
  // Every package the vocabulary declares, even one declaring no component
  // (it only extends another's), and the components no package declares.
  let effects = Map.groupBy(
    vocab.docs.flatMap((d) =>
      effectsIn(d).map((x) => ({ ...x, package: d.package ?? '' }))
    ).toSorted((a, b) => a.name.localeCompare(b.name)),
    (x) => x.package,
  )
  let named = [...new Set(vocab.docs.flatMap((d) => d.package ?? []))]
    .toSorted()
  let packages = declared.has('') || effects.has('') ? [...named, ''] : named
  let slice = SLICES.includes(me(io).slice ?? '') ? me(io).slice! : SLICES[0]
  let total = Object.values(census.tally).reduce((a, b) => a + b, 0)
  return h(
    'div',
    {},
    h(
      Head,
      {},
      h(Head.Title, {}, 'Schema'),
      h(
        Head.Sub,
        {},
        "The graph's data model: the packages it is declared in, the " +
          'components entities carry and their properties, the relations ' +
          'between them, and the sets of components entities are made of.',
      ),
      h(
        Head.Facts,
        {},
        h('span', {}, plural(named.length, 'package', 'packages')),
        h('span', {}, plural(vocab.all.length, 'component', 'components')),
        h(
          'span',
          {},
          plural([...effects.values()].flat().length, 'effect', 'effects'),
        ),
        h(
          'span',
          {},
          plural(relations(io).length, 'relation', 'relations'),
        ),
        h(
          'span',
          {},
          census.ready || census.sets.length
            ? plural(census.sets.length, 'archetype', 'archetypes')
            : h(Loading, {}),
        ),
        h(
          'span',
          {},
          census.ready || total
            ? plural(total, 'entity', 'entities')
            : h(Loading, {}),
        ),
      ),
    ),
    h(
      Tabs,
      { role: 'group', 'aria-label': 'slice of the schema' },
      SLICES.map((s) =>
        h(Tabs.Tab, {
          key: s,
          type: 'button',
          mod: s == slice && 'on',
          'aria-pressed': s == slice,
          onClick: () => io.set(put({ slice: s })),
        }, SLICE[s].heading)
      ),
    ),
    h(Slice, { io, census, packages, declared, effects, slice }),
  )
}

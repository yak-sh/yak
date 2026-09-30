/**
 * The inspector's first page, a map of how the data is made, each part a
 * listing to press into:
 *
 * - Packages: each package the vocabulary is served from, what it is, how many
 *   components it declares, and how many entities carry any of them.
 * - Components: every component, its package, what it is and how many
 *   entities carry it, the most carried first; a pressed heading runs them
 *   by it.
 * - Relations: every component that is an edge relation (@yaks/edge), what it
 *   reads as from the far end, and how many edges state it.
 * - Archetypes: every set of components entities are made of, the most
 *   populous first.
 *
 * What each is comes from the vocabulary the host was served and the graph's
 * description of it (@yaks/vocab's `_package`); every count from one census
 * (./census.ts).
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { Head, Value } from '@yaks/ui'
import type { Bundle, Io } from './host.ts'
import { useCensus } from './census.ts'
import { Grid } from './grid.ts'
import { chip, chips, compEid, packEid, relations } from './schema.ts'
import { Part, under, useNotes } from './notes.ts'
import { count, line, str, tables } from './read.ts'
import { waiting } from './rows.ts'
import { key } from './state.ts'

// Notes on the first page are about the components its parts are made of:
// `_package` for the packages, `_comp` for the components, `edge` for the
// relations, `archetype` for the archetypes.
let useConcept = (io: Io, name: string, heading: string) => {
  let eid = compEid(name)
  return {
    eid,
    subject: name,
    notes: under(useNotes(io, eid), name, [heading]),
  }
}

// A row standing for a name, for a table of names.
let named = (n: string): Bundle => ({ entity: { eid: n } })

// A count, or `…` while the census is out.
let tallied = (ready: boolean, n: number) => ready ? count(n) : '…'

/** The first page. */
export let HomePage = ({ io }: { io: Io }): JSX.Element => {
  let census = useCensus(io)
  let { carried, sets, tally, ready } = census
  let got = io.ask({ packs: { query: '._package&?_package&?doc', once: true } })
  let about = new Map(
    (got.packs?.rows ?? []).map((b) => [
      str(b, '_package', 'name'),
      str(b, 'doc', 'body'),
    ]),
  )
  let vocab = io.vocab
  let packs = [...new Set(vocab.docs.flatMap((d) => d.package ?? []))]
    .toSorted()
  let declared = Map.groupBy(vocab.all, (n) => vocab.comp(n)?.package ?? '')
  // How many entities carry any of a package's components.
  let reach = (p: string) => {
    let own = new Set(declared.get(p) ?? [])
    return sets.reduce(
      (n, s) =>
        tables(s).some((t) => own.has(t)) ? n + (tally[s.entity.eid] ?? 0) : n,
      0,
    )
  }
  let rels = relations(io).toSorted()
  let comps = vocab.all.toSorted((a, b) =>
    (carried[b] ?? 0) - (carried[a] ?? 0) || a.localeCompare(b)
  )
  let total = Object.values(tally).reduce((a, b) => a + b, 0)
  return h(
    'div',
    {},
    h(
      Head,
      {},
      h(Head.Title, {}, 'inspect'),
      h(
        Head.Sub,
        {},
        "The graph's data model: the packages it is declared in, the " +
          'components entities carry, the relations between them, and the ' +
          'sets of components entities are made of. Press a row to open it.',
      ),
      h(
        Head.Facts,
        {},
        h('span', {}, `${count(packs.length)} packages`),
        h('span', {}, `${count(vocab.all.length)} components`),
        h('span', {}, `${count(rels.length)} relations`),
        h('span', {}, `${count(sets.length)} archetypes`),
        h('span', {}, ready ? `${count(total)} entities` : '… entities'),
      ),
    ),
    h(
      Part,
      {
        io,
        ...useConcept(io, '_package', 'Packages'),
        heading: 'Packages',
        count: packs.length,
      },
      h(Grid, {
        io,
        id: key('inspect', 'Packages'),
        local: true,
        rows: packs.map(named),
        pick: (b) => packEid(b.entity.eid),
        columns: [
          {
            name: 'package',
            value: (b) => b.entity.eid,
            cell: (b) =>
              h('a', { href: io.link(packEid(b.entity.eid)) }, b.entity.eid),
          },
          {
            name: 'what it is',
            mod: 'prose',
            cell: (b) => line(about.get(b.entity.eid), 160),
          },
          {
            name: 'components',
            mod: 'num',
            value: (b) => declared.get(b.entity.eid)?.length ?? 0,
            cell: (b) => count(declared.get(b.entity.eid)?.length ?? 0),
          },
          {
            name: 'entities',
            mod: 'num',
            value: (b) => reach(b.entity.eid),
            cell: (b) => tallied(ready, reach(b.entity.eid)),
          },
        ],
      }),
    ),
    h(
      Part,
      {
        io,
        ...useConcept(io, '_comp', 'Components'),
        heading: 'Components',
        count: comps.length,
      },
      h(Grid, {
        io,
        id: key('inspect', 'Components'),
        local: true,
        rows: comps.map(named),
        pick: (b) => compEid(b.entity.eid),
        columns: [
          {
            name: 'component',
            value: (b) => b.entity.eid,
            cell: (b) => chip(io, b.entity.eid),
          },
          {
            name: 'package',
            value: (b) => vocab.comp(b.entity.eid)?.package ?? '',
            cell: (b) => vocab.comp(b.entity.eid)?.package ?? '',
          },
          {
            name: 'what it is',
            mod: 'prose',
            cell: (b) => line(vocab.comp(b.entity.eid)?.description, 160),
          },
          {
            name: 'entities',
            mod: 'num',
            value: (b) => carried[b.entity.eid] ?? 0,
            cell: (b) => tallied(ready, carried[b.entity.eid] ?? 0),
          },
        ],
      }),
    ),
    h(
      Part,
      {
        io,
        ...useConcept(io, 'edge', 'Relations'),
        heading: 'Relations',
        count: rels.length,
      },
      h(Grid, {
        io,
        id: key('inspect', 'Relations'),
        local: true,
        rows: rels.map(named),
        pick: (b) => compEid(b.entity.eid),
        columns: [
          {
            name: 'relation',
            value: (b) => b.entity.eid,
            cell: (b) => chip(io, b.entity.eid),
          },
          {
            name: 'from the far end',
            cell: (b) => {
              let back = vocab.comp(b.entity.eid)?.keywords.reversed
              return typeof back == 'string'
                ? back
                : h(Value, { mod: 'nil' }, 'the same')
            },
          },
          {
            name: 'edges',
            mod: 'num',
            value: (b) => carried[b.entity.eid] ?? 0,
            cell: (b) => tallied(ready, carried[b.entity.eid] ?? 0),
          },
          {
            name: 'package',
            cell: (b) => vocab.comp(b.entity.eid)?.package ?? '',
          },
        ],
      }),
    ),
    h(
      Part,
      {
        io,
        ...useConcept(io, 'archetype', 'Archetypes'),
        heading: 'Archetypes',
        count: sets.length || undefined,
      },
      waiting({
        rows: sets,
        ready: census.ready,
        error: census.error,
      }) ?? h(Grid, {
        io,
        id: key('inspect', 'Archetypes'),
        local: true,
        rows: sets,
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
            value: (b) => tally[b.entity.eid] ?? 0,
            cell: (b) =>
              h(
                'a',
                { href: io.find(`.entity.archetype=${b.entity.eid}`) },
                count(tally[b.entity.eid] ?? 0),
              ),
          },
        ],
      }),
    ),
  )
}

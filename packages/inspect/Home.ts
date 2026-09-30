/**
 * The inspector's first page, before anything is picked: how the data is
 * made. Its archetypes, every set of components entities are made of, most
 * populous first; and its relations, every component that is an edge
 * relation (@yaks/edge), what it reads as from the far end, and how many
 * edges state it.
 *
 * Both are read off one census: the archetypes, and a tally of every
 * entity's archetype. The tally reads every entity (seconds on a large
 * graph), so it is asked once (README, Limits).
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { Head, Value } from '@yaks/ui'
import type { Bundle, Io } from './host.ts'
import { Grid } from './grid.ts'
import { chip, chips, compEid, relations } from './links.ts'
import { Part, under, useNotes } from './notes.ts'
import { census, count, tables } from './read.ts'
import { rows, waiting } from './rows.ts'
import { key } from './state.ts'

/** The census the first page reads: each set of components that occurs,
 * and how many entities are made of each. */
export let CENSUS = {
  sets: '.archetype&.fields=archetype.tables',
  tally: '.tally=entity.archetype',
}

// Notes on the first page are about the components its parts are made of:
// `archetype` for the archetypes, `edge` for the relations.
let useConcept = (io: Io, name: string, heading: string) => {
  let eid = compEid(name)
  return {
    eid,
    subject: name,
    notes: under(useNotes(io, eid), name, [heading]),
  }
}

/** The first page. */
export let HomePage = ({ io }: { io: Io }): JSX.Element => {
  let got = io.ask({
    sets: CENSUS.sets,
    tally: { query: CENSUS.tally, once: true },
  })
  let tally = got.tally?.tally ?? {}
  let sets = rows(got.sets).toSorted((a, b) =>
    (tally[b.entity.eid] ?? 0) - (tally[a.entity.eid] ?? 0)
  )
  let carried = got.tally?.tally ? census(sets, tally) : undefined
  let archetypes = useConcept(io, 'archetype', 'Archetypes')
  let edges = useConcept(io, 'edge', 'Relations')
  let rels = relations(io).toSorted()
  let rel = (b: Bundle) => b.entity.eid
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
        "The graph's data model: every package and component (the index), " +
          'the sets of components entities are made of, and the relations ' +
          'between them. Press a row to see it beside the page.',
      ),
      h(
        Head.Facts,
        {},
        h('span', {}, `${count(io.vocab.all.length)} components`),
        h('span', {}, `${count(sets.length)} archetypes`),
        h('span', {}, `${count(rels.length)} relations`),
      ),
    ),
    h(
      Part,
      {
        io,
        ...archetypes,
        heading: 'Archetypes',
        count: sets.length || undefined,
      },
      waiting(got.sets) ?? h(Grid, {
        io,
        id: key('inspect', 'Archetypes'),
        local: true,
        rows: sets,
        columns: [
          { name: 'components', cell: (b) => chips(io, tables(b)) },
          {
            name: 'entities',
            mod: 'num',
            cell: (b) =>
              got.tally?.tally
                ? h(
                  'a',
                  { href: io.find(`.entity.archetype=${b.entity.eid}`) },
                  count(tally[b.entity.eid] ?? 0),
                )
                : '…',
          },
        ],
      }),
    ),
    h(
      Part,
      { io, ...edges, heading: 'Relations', count: rels.length },
      h(Grid, {
        io,
        id: key('inspect', 'Relations'),
        local: true,
        rows: rels.map((n): Bundle => ({ entity: { eid: n } })),
        pick: (b) => compEid(rel(b)),
        columns: [
          { name: 'relation', cell: (b) => chip(io, rel(b)) },
          {
            name: 'from the far end',
            cell: (b) => {
              let back = io.vocab.comp(rel(b))?.keywords.reversed
              return typeof back == 'string'
                ? back
                : h(Value, { mod: 'nil' }, 'the same')
            },
          },
          {
            name: 'edges',
            mod: 'num',
            cell: (b) => carried ? count(carried[rel(b)] ?? 0) : '…',
          },
          {
            name: 'package',
            cell: (b) => io.vocab.comp(rel(b))?.package ?? '',
          },
        ],
      }),
    ),
  )
}

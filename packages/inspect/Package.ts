/**
 * A package's page (`_package`, @yaks/vocab): what it is, the components it
 * declares, and the properties it adds to components other packages declare
 * (`extends`).
 *
 * @module
 */

import { h, type JSX } from 'preact'
import { parse } from '@yaks/query'
import { Head } from '@yaks/ui'
import type { Answer, Bundle, Io, Props, View } from './host.ts'
import { Grid } from './grid.ts'
import { chip } from './schema.ts'
import { NoteButton, Part, Said, under, useNotes } from './notes.ts'
import { comp, line, str, typed } from './read.ts'
import { rows, waiting } from './rows.ts'
import { key } from './state.ts'

let HEADINGS = ['Components', 'Extends']

type Part_ = { e: Bundle; io: Io; notes: Map<string, Bundle[]> }

let about = (b: Bundle) => line(str(b, 'doc', 'body'), 200)

// The components it declares.
let Declares = ({ e, io, notes, comps }: Part_ & { comps: Answer }) =>
  h(
    Part,
    {
      io,
      eid: e.entity.eid,
      subject: str(e, '_package', 'name'),
      heading: 'Components',
      count: comps.ready ? rows(comps).length : undefined,
      notes,
    },
    waiting(comps) ?? h(Grid, {
      io,
      id: key(e.entity.eid, 'Components'),
      local: true,
      rows: rows(comps),
      columns: [
        { name: 'name', cell: (b) => chip(io, str(b, '_comp', 'name')) },
        { name: 'description', mod: 'prose', cell: about },
      ],
    }),
  )

// The properties it adds to components it does not declare.
let Extends = (
  { e, io, notes, comps, props }: Part_ & { comps: Answer; props: Answer },
) => {
  let own = new Set(rows(comps).map((b) => b.entity.eid))
  let theirs = rows(props).filter((b) => !own.has(str(b, '_prop', 'comp')))
  return h(
    Part,
    {
      io,
      eid: e.entity.eid,
      subject: str(e, '_package', 'name'),
      heading: 'Extends',
      count: props.ready && comps.ready ? theirs.length : undefined,
      notes,
    },
    waiting(props) ?? waiting(comps) ?? h(Grid, {
      io,
      id: key(e.entity.eid, 'Extends'),
      local: true,
      rows: theirs,
      columns: [
        {
          name: 'property',
          cell: (b) =>
            h('a', { href: io.link(b.entity.eid) }, str(b, 'doc', 'title')),
        },
        { name: 'type', cell: (b) => typed(comp(b, '_prop')) },
        { name: 'description', mod: 'prose', cell: about },
      ],
    }),
  )
}

/** A package's own page. */
export let PackagePage = ({ e, io }: Props): JSX.Element => {
  let eid = e.entity.eid
  let name = str(e, '_package', 'name') || str(e, 'doc', 'title')
  let notes = under(useNotes(io, eid), name, HEADINGS)
  let got = io.ask({
    comps: `._comp&._comp.package=${eid}&?doc&.order=_comp.name`,
    props: `._prop&._prop.package=${eid}&?doc&.order=_prop.comp`,
  })
  return h(
    'div',
    { 'data-inspect': eid },
    h(
      Head,
      {},
      h(
        Head.Title,
        {},
        name,
        h(Head.Kind, {}, 'package'),
        h(NoteButton, { io, eid, heading: '', subject: name }),
      ),
      h(Head.Sub, {}, str(e, 'doc', 'body')),
    ),
    h(Said, { io, eid, subject: name, heading: '', notes: notes.get('') }),
    h(Declares, { e, io, notes, comps: got.comps }),
    h(Extends, { e, io, notes, comps: got.comps, props: got.props }),
  )
}

/** A package's page. */
export let packageViews: View[] = [
  { view: 'Inspect.Page', match: parse('._package'), Render: PackagePage },
]

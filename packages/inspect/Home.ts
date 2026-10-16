/**
 * The schema starts with packages, not every slice of the graph. Opening a
 * package mounts its components; opening a component mounts its properties.
 * All three come from the vocabulary the host already loaded: opening this
 * map never waits for a graph census or reads rows to count them.
 * @module
 */

import { type ComponentChildren, Fragment, h, type JSX } from 'preact'
import { Head, Rows, Section } from '@yaks/ui'
import { Disclosure, disclosureAt, isOpen } from '@yaks/ux'
import type { Bundle, Io } from './host.ts'
import { Grid } from './grid.ts'
import { compEid, packEid, propEid } from './schema.ts'
import { count, str } from './read.ts'
import { key } from './state.ts'

// Expansion belongs to the page graph, and survives leaving the map.
let Branch = ({ io, e, children }: {
  io: Io
  e: Bundle
  children?: ComponentChildren
}) => {
  let eid = disclosureAt(key('schema', e.entity.eid))
  let state = io.state(eid) ?? { entity: { eid } }
  return h(Disclosure, {
    e: state,
    onChange: (b) => io.set([b]),
    summary: h(
      Fragment,
      {},
      isOpen(state) ? '▾ ' : '▸ ',
      io.show(e, 'Inspect.Schema.Summary'),
    ),
    summaryProps: { mod: 'quiet' },
  }, h(Rows, { mod: 'nested' }, children))
}

let Properties = ({ io, name }: { io: Io; name: string }) => {
  let props = io.vocab.props(name)
  return props.length
    ? h(Grid, {
      io,
      id: key('schema', name, 'properties'),
      local: true,
      rows: props.map((prop): Bundle => ({
        entity: { eid: propEid(name, prop) },
        _prop: { name: prop },
      })),
      columns: [
        {
          name: 'property',
          cell: (b) => io.show(b, 'Inline'),
        },
        {
          name: 'type',
          cell: (b) => {
            let p = io.vocab.prop(name, str(b, '_prop', 'name'))
            return p?.ref
              ? `→ ${p.ref}`
              : p?.values?.join(' | ') ?? p?.types?.join(' | ') ?? p?.scalar ??
                ''
          },
        },
        {
          name: 'what it is',
          mod: 'prose',
          cell: (b) =>
            io.vocab.prop(name, str(b, '_prop', 'name'))?.description ?? '',
        },
      ],
    })
    : h(Section.Sub, {}, 'A mark: no properties.')
}

let Components = ({ io, names }: { io: Io; names: string[] }) =>
  h(
    Rows,
    {},
    names.map((name) => {
      let e: Bundle = {
        entity: { eid: compEid(name) },
        _comp: { name },
      }
      return h(
        Rows.Item,
        { key: name },
        h(
          Branch,
          { io, e },
          io.show(e, 'Tile'),
          h(Section.Sub, {}, io.vocab.comp(name)?.description),
          h(Properties, { io, name }),
        ),
      )
    }),
  )

/** A package → component → property map, with no query required to paint. */
export let HomePage = ({ io }: { io: Io }): JSX.Element => {
  let declared = Map.groupBy(
    io.vocab.all.toSorted(),
    (name) => io.vocab.comp(name)?.package ?? '',
  )
  // Keep packages with no components (and properties extending another
  // package's component) visible too. Properties are the merged vocabulary.
  let packages = [
    ...new Set([
      ...io.vocab.docs.flatMap((d) => d.package ? [d.package] : []),
      ...declared.keys(),
    ]),
  ].toSorted()
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
        'Open a package, then a component, to see its properties. ',
        'Names link to their full definitions and data.',
      ),
      h(
        Head.Facts,
        {},
        h('span', {}, `${count(packages.length)} packages`),
        h('span', {}, `${count(io.vocab.all.length)} components`),
        h('a', { href: io.find('.archetype') }, 'Archetypes'),
      ),
    ),
    h(
      Rows,
      {},
      packages.map((name) => {
        let names = declared.get(name) ?? []
        let e: Bundle = {
          entity: { eid: packEid(name) },
          _package: { name: name || 'Unpackaged' },
        }
        return h(
          Rows.Item,
          { key: name },
          h(
            Branch,
            { io, e },
            name ? io.show(e, 'Tile') : null,
            h(
              Section.Sub,
              {},
              io.vocab.docs.find((d) => d.package == name)?.description,
            ),
            names.length
              ? h(Components, { io, names })
              : h(Section.Sub, {}, 'No components declared.'),
          ),
        )
      }),
    ),
  )
}

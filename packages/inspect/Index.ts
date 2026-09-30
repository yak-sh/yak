/**
 * The index beside every page: every package, and under it every component
 * it declares, always there, each a link to its page; the one shown lit.
 * What is typed in the field above it (the `filter` on `inspect`, @yaks/filter)
 * narrows it as it is typed: to the components whose name holds it, and to
 * every component of a package whose name does. The field runs it as a
 * query when it is sent (./Frame.ts).
 *
 * @module
 */

import { h, type JSX } from 'preact'
import * as ui from '@yaks/ui'
import type { Bundle, Io } from './host.ts'
import { str } from './read.ts'
import { rows, waiting } from './rows.ts'
import { INSPECT } from './state.ts'

/** What the index asks for: every package and every component, by name. */
export let INDEX = {
  packs: '._package&.fields=_package.name&.order=_package.name',
  comps: '._comp&.fields=_comp.name,_comp.package&.order=_comp.name',
}

/**
 * The groups an index shows for `text`: each package with the components of
 * it that match, a package matching by its own name keeping all of them.
 * Components no package declares come last, under none.
 *
 * ```ts
 * import { grouped } from './Index.ts'
 * let pack = (eid: string, name: string) => ({ entity: { eid }, _package: { name } })
 * let comp = (eid: string, name: string, pkg: string) => ({ entity: { eid }, _comp: { name, package: pkg } })
 * let packs = [pack('p1', '@yaks/task'), pack('p2', '@yaks/doc')]
 * let comps = [comp('c1', 'task', 'p1'), comp('c2', 'blocked', 'p1'), comp('c3', 'doc', 'p2')]
 * grouped(packs, comps, 'bl').map(([p, cs]) => [p?.entity.eid, cs.length]) // [['p1', 1]]
 * grouped(packs, comps, 'doc').map(([p, cs]) => [p?.entity.eid, cs.length]) // [['p2', 1]]
 * ```
 */
export let grouped = (
  packs: Bundle[],
  comps: Bundle[],
  text: string,
): [Bundle | undefined, Bundle[]][] => {
  let t = text.trim().toLowerCase()
  let has = (s: string) => !t || s.toLowerCase().includes(t)
  let by = Map.groupBy(comps, (c) => str(c, '_comp', 'package'))
  let own = new Set(packs.map((p) => p.entity.eid))
  let groups: [Bundle | undefined, Bundle[]][] = [
    ...packs.map((p): [Bundle, Bundle[]] => [p, by.get(p.entity.eid) ?? []]),
    [undefined, comps.filter((c) => !own.has(str(c, '_comp', 'package')))],
  ]
  return groups.flatMap(([p, cs]): [Bundle | undefined, Bundle[]][] => {
    let whole = !!p && has(str(p, '_package', 'name'))
    let shown = whole ? cs : cs.filter((c) => has(str(c, '_comp', 'name')))
    return whole || shown.length ? [[p, shown]] : []
  })
}

/** The index. `here` is the eid of the page shown, where it is one. */
export let Index = ({ io, here }: { io: Io; here?: string }): JSX.Element => {
  let got = io.ask(INDEX)
  let text = str(io.state(INSPECT), 'filter', 'text')
  let groups = grouped(rows(got.packs), rows(got.comps), text)
  return waiting(got.comps) ?? h(
    ui.Index,
    {},
    h(
      ui.Index.Group,
      {},
      h(ui.Index.Head, { href: io.find(''), mod: !here && 'on' }, 'inspect'),
    ),
    groups.map(([p, cs]) =>
      h(
        ui.Index.Group,
        { key: p?.entity.eid ?? 'none' },
        p
          ? h(ui.Index.Head, {
            href: io.link(p.entity.eid),
            mod: p.entity.eid == here && 'on',
          }, str(p, '_package', 'name'))
          : h(ui.Index.Head, {}, 'no package'),
        cs.map((c) =>
          h(ui.Index.Item, {
            key: c.entity.eid,
            href: io.link(c.entity.eid),
            mod: c.entity.eid == here && 'on',
          }, str(c, '_comp', 'name'))
        ),
      )
    ),
    !groups.length ? h(ui.Rows.More, {}, `nothing is named ${text}`) : null,
  )
}

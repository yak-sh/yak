/**
 * What an entity holds by its links, in the order they are read, put in
 * order where it stands: `Held`. Each row is the entity a link leads to,
 * drawn by its own renderer (the view `tile` names). Where the host takes
 * edits, a row is picked up and dropped between two others, which writes the
 * links' positions (`edge.ord`, @yaks/edge `placed`), and an entity carried
 * from elsewhere (@yaks/ux `carry`: a row of another list, of a desk) joins
 * the list where it is dropped, linked by `tag`. Each row opens in place on
 * the title and body of what it leads to, typed over where they stand
 * (@yaks/ux `Edit.Text`), and read only where the host takes no edits.
 *
 * Its caller names the links and their order (the order its reader reads
 * them in) and draws the heading around it.
 *
 * ```ts ignore
 * h(Held, { io, from: eid, links, ends, tile: 'Topic.List.Tile', tag: 'contains', empty: 'nothing yet' })
 * ```
 *
 * @module
 */

import { h, type JSX } from 'preact'
import * as ui from '@yaks/ui'
import {
  at as editAt,
  disclosed,
  disclosureAt,
  Edit,
  isOpen,
  Order,
  orderAt,
} from '@yaks/ux'
import { link, placed } from '@yaks/edge'
import type { Answer, Bundle, Io } from './host.ts'
import { relation, str } from './read.ts'
import { relations } from './schema.ts'
import { refusal, write } from './state.ts'
import { mention } from './value.ts'

/** What a list of what an entity holds is drawn with. */
export type HeldProps = {
  io: Io
  /** the entity whose links these are */
  from: string
  /** its links, in the order they are read */
  links: Bundle[]
  /** the entities they lead to, whole */
  ends?: Answer
  /** the view each is drawn by */
  tile: string
  /** what a list with nothing on it says */
  empty: string
  /** the relation an entity joining from elsewhere is linked by; without
   * one, none joins */
  tag?: string
  /** what else an entity joining from elsewhere writes, or `undefined` when
   * it may not join */
  join?: (to: string) => Bundle[] | undefined
}

let far = (b: Bundle) => str(b, 'edge', 'to')

/** A row opened in place: the title and body of what it leads to. */
let Detail = ({ io, end, owner }: { io: Io; end: Bundle; owner: string }) => {
  let eid = end.entity.eid
  let text = (prop: string, more: Record<string, unknown>) =>
    h(Edit.Text, {
      e: end,
      comp: 'doc',
      prop,
      at: editAt(owner, eid, 'doc', prop),
      readOnly: !io.edits,
      ...more,
    })
  let no = refusal(io, eid)
  return h(
    ui.Rows.Detail,
    { 'data-detail': eid },
    h('strong', {}, text('title', { inline: true })),
    h(ui.Body, {}, text('body', { multi: true })),
    no ? h(ui.Rows.More, { role: 'alert' }, no) : io.edits
      ? h(
        ui.Rows.More,
        {},
        'double-click the title or the text to type over it',
      )
      : null,
  )
}

/** What an entity holds by its links, in order, each opened in place. */
export let Held = (
  { io, from, links, ends, tile, empty, tag, join }: HeldProps,
): JSX.Element => {
  let held = new Map((ends?.rows ?? []).map((b) => [b.entity.eid, b]))
  let rels = relations(io)
  let seen = new Set<string>()
  let rows = links.filter((b) => {
    let to = far(b)
    return to && !seen.has(to) && seen.add(to)
  })
  let named = [...new Set(rows.map((b) => relation(b, rels) ?? ''))]
  let kinds = named.length > 1
  let by = new Map(rows.map((b) => [far(b), b]))
  let order = orderAt(`held/${from}/${tag ?? named.sort().join(' ')}`)

  // A row put between two others, or an entity from elsewhere joining.
  let place = (to: string, at: number) => {
    let had = by.get(to)
    if (had) return void write(io, from, placed(rows, had, at))
    let more = tag && to != from ? join ? join(to) : [] : undefined
    if (more) {
      void write(io, from, [...more, ...placed(rows, link(from, tag!, to), at)])
    }
  }

  let row = (to: string) => {
    let b = by.get(to)!
    let end = held.get(to)
    let at = disclosureAt(`held/${b.entity.eid}`)
    let state = io.state(at) ?? { entity: { eid: at } }
    let open = isOpen(state) && !!end?.doc
    return [
      h(
        ui.Rows.Line,
        { 'data-held': to },
        h(ui.Rows.Toggle, {
          type: 'button',
          disabled: !end?.doc,
          'aria-expanded': open,
          'aria-label': open ? 'close it' : 'open it here',
          onClick: () => io.set([disclosed(state, !open)]),
        }, open ? '▾' : '▸'),
        h(
          'div',
          {},
          kinds ? h(ui.Rows.Kind, {}, relation(b, rels)) : null,
          end
            ? io.show(end, tile, {})
            : ends?.ready
            ? [mention(io, to), ' is gone']
            : h(ui.Loading, {}),
        ),
      ),
      open && end ? h(Detail, { io, end, owner: b.entity.eid }) : null,
    ]
  }

  return h(Order, {
    e: io.state(order) ?? { entity: { eid: order } },
    onChange: (b: Bundle) => io.set([b]),
    ids: rows.map(far),
    row,
    onPlace: io.edits ? place : undefined,
    empty,
  })
}

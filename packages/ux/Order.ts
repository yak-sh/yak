/**
 * A list put in order by dragging its rows: `Order`. Each row drags the
 * entity it stands for (`drag`), so it can be dropped on another list as
 * well, and the list takes any dragged entity: dropped between two rows, it
 * is put there (`onPlace`), whether it was one of the list's rows or came
 * from elsewhere. While one is dragged over the list, a line shows where it
 * would land. That is its state, `Order{at}`, the index of the row it would
 * land before, on the consumer-named page entity (`orderAt`), kept by its
 * consumer as a disclosure's is. What each row says, and what opens beneath
 * it, is the consumer's. A row opened for reading and typing (`open`) is no
 * drag handle: selecting its text, clicking into it and typing never pick it
 * up.
 *
 * @module
 */

import { type ComponentChildren, h, type JSX } from 'preact'
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { Rows } from '@yaks/ui'
import { drag, dragged, drags } from './drag.ts'

/** The page entity holding this owner's order state. */
export let orderAt = (owner: string): string =>
  derivedEid(['Order', owner].join('|'))

/** Where a dragged entity would land, or nothing while none is dragged over
 * the list. */
/// landing({ entity: { eid: 'o' }, Order: { at: 2 } }) -> 2
/// landing({ entity: { eid: 'o' } }) -> undefined
export let landing = (e?: Bundle): number | undefined => {
  let at = (e?.Order as { at?: unknown } | undefined)?.at
  return typeof at == 'number' ? at : undefined
}

/** The bundle saying where a dragged entity would land; `null`, nowhere. */
/// landed({ entity: { eid: 'o' } }, 1) -> { entity: { eid: 'o' }, Order: { at: 1 } }
/// landed({ entity: { eid: 'o' } }, null).Order -> null
export let landed = (e: Bundle, at: number | null): Bundle => ({
  entity: { eid: e.entity.eid },
  Order: at == null ? null : { at },
})

/** Where a drop at height `y` lands among rows drawn in these boxes: before
 * the first whose middle is below it, or after them all. */
/// among([{ top: 0, height: 10 }, { top: 10, height: 10 }], 4) -> 0
/// among([{ top: 0, height: 10 }, { top: 10, height: 10 }], 16) -> 2
export let among = (
  boxes: { top: number; height: number }[],
  y: number,
): number => {
  let i = boxes.findIndex((b) => y < b.top + b.height / 2)
  return i < 0 ? boxes.length : i
}

/** Where among the others a row lands when it is dropped before the row at
 * `at`, or nothing when that leaves it where it is. One from elsewhere lands
 * at `at`. */
/// placing(['a', 'b', 'c'], 'a', 2) -> 1
/// placing(['a', 'b', 'c'], 'c', 0) -> 0
/// placing(['a', 'b', 'c'], 'b', 2) -> undefined
/// placing(['a', 'b'], 'x', 1) -> 1
export let placing = (
  ids: string[],
  eid: string,
  at: number,
): number | undefined => {
  let k = ids.indexOf(eid)
  if (k < 0) return at
  let i = k < at ? at - 1 : at
  return i == k ? undefined : i
}

/** State and rows supplied by the order's consumer. */
export type OrderProps = {
  /** its state: `Order{at}` while an entity is dragged over it */
  e: Bundle
  /** where its state bundles go */
  onChange: (b: Bundle) => void
  /** the entities its rows stand for, in order */
  ids: string[]
  /** what a row says, and what opens beneath it */
  row: (id: string) => ComponentChildren
  /** an entity put at `at` among the other rows; without it, the rows are
   * neither picked up nor put in order */
  onPlace?: (eid: string, at: number) => void
  /** whether a row is open for reading and typing, and so not picked up */
  open?: (id: string) => boolean
  /** what a list with no rows says */
  empty?: ComponentChildren
}

type Ev = DragEvent & { currentTarget: HTMLElement }

/** The boxes a list's rows are drawn in. */
let boxes = (list: HTMLElement) =>
  [...list.children]
    .filter((n) => n.classList.contains('Rows_Item'))
    .map((n) => n.getBoundingClientRect())

/** A list put in order by dragging its rows. */
export let Order = (
  { e, onChange, ids, row, onPlace, open, empty }: OrderProps,
): JSX.Element => {
  let at = landing(e)
  let land = (i: number | null) => {
    if ((i ?? undefined) !== at) onChange(landed(e, i))
  }
  let takes = onPlace
    ? {
      onDragOver: (ev: Ev) => {
        if (!drags(ev)) return
        ev.preventDefault()
        land(among(boxes(ev.currentTarget), ev.clientY))
      },
      onDragLeave: (ev: Ev) => {
        if (!ev.currentTarget.contains(ev.relatedTarget as Node)) land(null)
      },
      onDrop: (ev: Ev) => {
        let eid = dragged(ev)
        land(null)
        if (!eid) return
        ev.preventDefault()
        ev.stopPropagation()
        let i = placing(ids, eid, among(boxes(ev.currentTarget), ev.clientY))
        if (i != null) onPlace(eid, i)
      },
    }
    : {}
  let picked = (id: string) =>
    onPlace && !open?.(id)
      ? {
        draggable: true,
        onDragStart: (ev: DragEvent) => drag(ev, id),
        onDragEnd: () => land(null),
      }
      : {}
  return h(
    Rows,
    { mod: 'ordered', role: 'list', ...takes },
    ids.length
      ? ids.map((id, i) =>
        h(
          Rows.Item,
          {
            key: id,
            role: 'listitem',
            mod: [
              at === i && 'before',
              at === ids.length && i == ids.length - 1 && 'after',
            ],
            ...picked(id),
          },
          row(id),
        )
      )
      : h(Rows.More, {}, empty),
  )
}

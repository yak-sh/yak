/**
 * An entity carried by a drag, from any place on a page to any other: a row
 * dragged out of one list says which entity it stands for under one type, and
 * the list it is dropped on reads it, whichever package drew either. A drag
 * says what it carries only when it is dropped; while it moves, a place can
 * ask only whether it carries one (`carries`), to say it would take it.
 *
 * ```ts
 * import { carried, carries, carry } from '@yaks/ux'
 * import { equal } from '@yaks/testing'
 *
 * let kept = new Map<string, string>()
 * let dataTransfer = {
 *   get types() { return [...kept.keys()] },
 *   setData: (type: string, value: string) => kept.set(type, value),
 *   getData: (type: string) => kept.get(type) ?? '',
 * }
 * let ev = { dataTransfer } as unknown as DragEvent
 * equal(carries(ev), false)
 * carry(ev, 'M-1')
 * equal([carries(ev), carried(ev)], [true, 'M-1'])
 * ```
 *
 * @module
 */

/** The type a carried entity's eid travels under. */
export let CARRIED = 'application/x-yaks-entity'

/** Carry an entity in a drag, as it starts. */
export let carry = (ev: DragEvent, eid: string): void => {
  ev.dataTransfer?.setData(CARRIED, eid)
}

/** Whether a drag carries an entity: all a place can know before the drop. */
export let carries = (ev: DragEvent): boolean =>
  [...ev.dataTransfer?.types ?? []].includes(CARRIED)

/** The entity a dropped drag carries, or nothing. */
export let carried = (ev: DragEvent): string =>
  ev.dataTransfer?.getData(CARRIED) ?? ''

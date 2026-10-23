/**
 * An entity dragged from any place on a page to any other: a row dragged out
 * of one list says which entity it stands for under one type, and the list it
 * is dropped on reads it, whichever package drew either. A drag says which
 * entity it holds only when it is dropped; while it moves, a place can ask
 * only whether it holds one (`drags`), to say it would take it.
 *
 * ```ts
 * import { drag, dragged, drags } from '@yaks/ux'
 * import { equal } from '@yaks/testing'
 *
 * let kept = new Map<string, string>()
 * let dataTransfer = {
 *   get types() { return [...kept.keys()] },
 *   setData: (type: string, value: string) => kept.set(type, value),
 *   getData: (type: string) => kept.get(type) ?? '',
 * }
 * let ev = { dataTransfer } as unknown as DragEvent
 * equal(drags(ev), false)
 * drag(ev, 'M-1')
 * equal([drags(ev), dragged(ev)], [true, 'M-1'])
 * ```
 *
 * @module
 */

/** The type a dragged entity's eid travels under. */
export let DRAGGED = 'application/x-yaks-entity'

/** Put an entity in a drag, as it starts. */
export let drag = (ev: DragEvent, eid: string): void => {
  ev.dataTransfer?.setData(DRAGGED, eid)
}

/** Whether a drag holds an entity: all a place can know before the drop. */
export let drags = (ev: DragEvent): boolean =>
  [...ev.dataTransfer?.types ?? []].includes(DRAGGED)

/** The entity a dropped drag holds, or nothing. */
export let dragged = (ev: DragEvent): string =>
  ev.dataTransfer?.getData(DRAGGED) ?? ''

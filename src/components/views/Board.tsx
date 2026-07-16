import { type Ent } from '../../types.ts'
import { byPriority, ent, mutate, statuses } from '../../live.ts'
import { block } from '../ui.tsx'
import { dragData, View } from '../View.tsx'

let Frame = block('div', 'Board', { Col: 'div', ColName: 'div', Item: 'div' })
let { Col, ColName, Item } = Frame

// A project as kanban: columns derived from task status, ordered by
// priority. Every task row is draggable — dropped on another column (or
// another spot in its own) it patches status + priority, where priority is
// the midpoint of its new neighbours at the drop point; dragged out to the
// canvas it spawns a Task card (the standard drag payload — Canvas owns
// that drop).
export let Board = ({ e }: { e: Ent }) => {
  let drop = (
    ev: DragEvent & { currentTarget: HTMLElement },
    status: string,
  ) => {
    let data = ev.dataTransfer?.getData('application/x-tasks-card')
    if (!data) return
    let { target_eid } = JSON.parse(data)
    if (!ent(target_eid).task) return // not a task: let the canvas spawn it
    ev.preventDefault()
    ev.stopPropagation()
    // The new neighbours: this column's tasks (minus the dragged one), in
    // render order; the drop's insertion index comes from the row midpoints.
    let list = e.kids
      .filter((k) => k.task?.status == status && k.eid != target_eid)
      .sort(byPriority)
    let rows = [...ev.currentTarget.querySelectorAll('.Board_Item')]
      .filter((r) => (r as HTMLElement).dataset.eid != target_eid)
    let i = rows.findIndex((r) => {
      let box = r.getBoundingClientRect()
      return ev.clientY < box.top + box.height / 2
    })
    if (i < 0) i = list.length
    let prev = list[i - 1]?.task?.priority
    let next = list[i]?.task?.priority
    let priority = prev == null && next == null
      ? 0
      : prev == null
      ? next! - 1
      : next == null
      ? prev + 1
      : (prev + next) / 2
    mutate({ eid: target_eid, name: 'task', comp: { status, priority } })
  }

  return (
    <Frame>
      {statuses.map((s) => (
        <Col
          key={s}
          onDrop={(ev: DragEvent & { currentTarget: HTMLElement }) =>
            drop(ev, s)}
        >
          <ColName>{s}</ColName>
          {e.kids.filter((k) => k.task?.status == s).sort(byPriority).map(
            (k) => (
              <Item
                key={k.eid}
                draggable
                data-eid={k.eid}
                onDragStart={(ev: DragEvent) => dragData(ev, k.eid, 'Task')}
              >
                <View eid={k.eid} />
              </Item>
            ),
          )}
        </Col>
      ))}
    </Frame>
  )
}

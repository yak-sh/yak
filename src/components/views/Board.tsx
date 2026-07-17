import { type Ent } from '../../types.ts'
import {
  boardTasks,
  byPriority,
  cache,
  clientId,
  ent,
  mutate,
  statuses,
} from '../../live.ts'
import { adopt, parseQuery } from '../../query.ts'
import { block } from '../ui.tsx'
import { Dot } from '../Dot.tsx'
import { dragData, View } from '../View.tsx'

let Frame = block('div', 'Board', {
  Col: 'div',
  ColName: 'div',
  Count: 'span',
  Item: 'div',
})
let { Col, ColName, Count, Item } = Frame

// A board as kanban over its saved QUERY (board.query, query.ts grammar):
// membership is never stored, a task is here because it matches. Columns
// derived from task status, ordered by priority. Every task row is
// draggable — dropped on another column (or another spot in its own) it
// patches status + priority (midpoint of its new neighbours), plus
// whatever scalar equalities the query demands, so a foreign task JOINS
// the board it lands on; dragged out to the canvas it spawns a Task card
// (the standard drag payload — Canvas owns that drop).
export let Board = ({ e }: { e: Ent }) => {
  let tasks: Ent[]
  try {
    tasks = boardTasks(e)
  } catch (err) {
    return (
      <Frame>
        bad query: {String(err instanceof Error ? err.message : err)}
      </Frame>
    )
  }
  // Double-click a column name to fold the column to a vertical header.
  // Folds are graph state like camera — a `fold` entity per (client,
  // board), so they persist, sync across this client's tabs, and agents
  // can see them. The TUI has no client identity; it just never folds.
  let me = (() => {
    try {
      return clientId()
    } catch {
      return null
    }
  })()
  let row = me
    ? Object.entries(cache.value).find(([, c]) =>
      c.fold?.client_eid == me && c.fold.board_eid == e.eid
    )
    : null
  let folded = new Set(
    String(row?.[1].fold?.statuses ?? '').split(',').filter(Boolean),
  )
  let fold = (s: string) => {
    if (!me) return
    folded.has(s) ? folded.delete(s) : folded.add(s)
    mutate({
      eid: row?.[0] ?? crypto.randomUUID(),
      name: 'fold',
      comp: {
        client_eid: me,
        board_eid: e.eid,
        statuses: [...folded].join(','),
      },
    })
  }
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
    let list = tasks
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
    mutate({
      eid: target_eid,
      name: 'task',
      comp: {
        ...adopt(parseQuery(String(e.board?.query ?? '')), 'task'),
        status,
        priority,
      },
    })
  }

  return (
    <Frame>
      {statuses.map((s) => {
        let list = tasks.filter((k) => k.task?.status == s).sort(byPriority)
        return (
          <Col
            key={s}
            mod={folded.has(s) && 'folded'}
            onDrop={(ev: DragEvent & { currentTarget: HTMLElement }) =>
              drop(ev, s)}
          >
            <ColName onDblClick={() => fold(s)}>
              <Dot status={s} />
              {s}
              <Count>{list.length}</Count>
            </ColName>
            {!folded.has(s) && list.map((k) => (
              <Item
                key={k.eid}
                draggable
                data-eid={k.eid}
                onDragStart={(ev: DragEvent) => dragData(ev, k.eid, 'Task')}
              >
                <View eid={k.eid} view='Task.Row' />
              </Item>
            ))}
          </Col>
        )
      })}
    </Frame>
  )
}

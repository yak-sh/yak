import { useState } from 'preact/hooks'
import { type Ent } from '../../types.ts'
import {
  boardTasks,
  byPriority,
  cache,
  clientId,
  ent,
  mutate,
  statuses,
  uuid,
} from '../../live.ts'
import { adopt, parseQuery } from '../../query.ts'
import { block, focus } from '../ui.tsx'
import { Dot } from '../Dot.tsx'
import { dragData, View } from '../View.tsx'

let Frame = block('div', 'Board', {
  Col: 'div',
  ColName: 'div',
  Count: 'span',
  Scroll: 'div',
  Item: 'div',
  Add: 'div',
  New: 'input',
})
let { Col, ColName, Count, Scroll, Item, Add, New } = Frame

// A board as kanban over its saved QUERY (board.query, query.ts grammar):
// membership is never stored, a task is here because it matches. Columns
// derived from task status, ordered by priority. Every task row is
// draggable — dropped on another column (or another spot in its own) it
// patches status + priority (midpoint of its new neighbours), plus
// whatever scalar equalities the query demands, so a foreign task JOINS
// the board it lands on; dragged out to the canvas it spawns a Task card
// (the standard drag payload — Canvas owns that drop).
export let Board = ({ e }: { e: Ent }) => {
  // Which column's quick-create box is open ('' = none). One at a time:
  // the box is a keyboard, and there's one keyboard.
  let [adding, setAdding] = useState('')
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

  // Quick-create: a task born INTO the column it was typed in — status
  // from the column, plus the query's scalar equalities (adopt(), the
  // drop's own path), so a task minted here MATCHES the board that made
  // it. The box lives in the HEADER, so the task lands at the TOP where
  // the typist is looking (priority before the first row) — nobody
  // else's value moves; drag it down when it isn't the most urgent.
  let create = (status: string, list: Ent[], title: string) => {
    let eid = uuid()
    mutate(
      { eid, name: 'doc', comp: { title, body: '' } },
      {
        eid,
        name: 'task',
        comp: {
          ...adopt(parseQuery(String(e.board?.query ?? '')), 'task'),
          status,
          priority: (list[0]?.task?.priority ?? 1) - 1,
        },
      },
    )
  }

  return (
    <Frame>
      {statuses.map((s) => {
        let list = tasks.filter((k) => k.task?.status == s).sort(byPriority)
        return (
          <Col
            key={s}
            mod={folded.has(s) && 'folded'}
            // the drop target cancels dragover ITSELF — leaning on an
            // ancestor's cancel is how fullscreen boards lost their drops
            onDragOver={(ev: DragEvent) => ev.preventDefault()}
            onDrop={(ev: DragEvent & { currentTarget: HTMLElement }) =>
              drop(ev, s)}
          >
            <ColName onDblClick={() => fold(s)}>
              <Dot status={s} />
              {s}
              <Count>{list.length}</Count>
              {!folded.has(s) && adding != s && (
                <Add onClick={() => setAdding(s)} title={`new ${s} task`}>
                  +
                </Add>
              )}
            </ColName>
            {
              /* Under the header, above the rows: type a title, Enter
                files it at the top and clears for the next one — filing
                a list is one uninterrupted keyboard — Escape (or
                clicking away) closes the box. */
            }
            {!folded.has(s) && adding == s && (
              <New
                elRef={focus}
                placeholder='title…'
                onKeyDown={(ev: KeyboardEvent) => {
                  let t = ev.currentTarget as HTMLInputElement
                  let title = t.value.trim()
                  if (ev.key == 'Enter' && title) {
                    create(s, list, title)
                    t.value = ''
                  } else if (ev.key == 'Escape') setAdding('')
                }}
                onBlur={() => setAdding('')}
              />
            )}
            {!folded.has(s) && (
              <Scroll>
                {list.map((k) => (
                  <Item
                    key={k.eid}
                    draggable
                    data-eid={k.eid}
                    onDragStart={(ev: DragEvent) => dragData(ev, k.eid, 'Task')}
                  >
                    <View eid={k.eid} view='Task.Row' />
                  </Item>
                ))}
              </Scroll>
            )}
          </Col>
        )
      })}
    </Frame>
  )
}

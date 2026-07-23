import { useState } from 'preact/hooks'
import { type Ent } from '../../types.ts'
import {
  boardTasks,
  byPriority,
  byWarmth,
  cache,
  clientId,
  ent,
  mutate,
  statuses,
  uuid,
} from '../../live.ts'
import { spec, taskChanges } from '../../client.ts'
import { adopt, orderOf, parseQuery } from '../../query.ts'
import { block, focus } from '../ui.tsx'
import { Dot } from '../Dot.tsx'
import { Prio } from '../Prio.tsx'
import { passOf } from '../Filter.tsx'
import { dragData } from '../drag.ts'
import { View } from '../View.tsx'

let Frame = block('div', 'Board', {
  Col: 'div',
  ColName: 'div',
  Count: 'span',
  Scroll: 'div',
  Item: 'div',
  Add: 'div',
  New: 'textarea',
  Chips: 'div',
  Chip: 'span',
})
let { Col, ColName, Count, Scroll, Item, Add, New, Chips, Chip } = Frame

// A board as kanban over its saved QUERY (board.query, query.ts grammar):
// membership is never stored, a task is here because it matches. Columns
// derived from task status, ordered by priority. Every task row is
// draggable — dropped on another column (or another spot in its own) it
// patches status + priority (midpoint of its new neighbours), plus
// whatever scalar equalities the query demands, so a foreign task JOINS
// the board it lands on; dragged out to the canvas it spawns a Task card
// (the standard drag payload — Canvas owns that drop).
// The quick-add box, under the header above the rows: ONE growing row —
// Shift+Enter starts the body and the box follows (CSS field-sizing) —
// with the parse shown live as chips while you type, so 'P1 .domain=Eng
// Ship it' announces what Enter will file. Enter files and clears for
// the next title (filing a list is one uninterrupted keyboard); Escape
// or clicking away closes. Uncontrolled on purpose: the DOM owns the
// text, state only mirrors it for the chips.
let QuickAdd = (
  { file, close }: { file: (text: string) => boolean; close: () => void },
) => {
  let [text, setText] = useState('')
  let { body, grouped } = spec(text)
  let p = grouped.task?.priority
  let chips = Object.entries(grouped).flatMap(([comp, props]) =>
    Object.entries(props)
      .filter(([prop]) => comp != 'task' || prop != 'priority')
      .map(([prop, v]) => `${prop}=${v}`)
  )
  return (
    <>
      {(p != null || chips.length > 0 || !!body) && (
        <Chips>
          {p != null && <Prio p={Number(p)} />}
          {chips.map((x) => <Chip key={x}>{x}</Chip>)}
          {!!body && <Chip mod='body'>+ body</Chip>}
        </Chips>
      )}
      <New
        elRef={focus}
        rows={1}
        placeholder='P1 .domain=Eng title…'
        onInput={(ev: InputEvent) =>
          setText((ev.currentTarget as HTMLTextAreaElement).value)}
        onKeyDown={(ev: KeyboardEvent) => {
          let t = ev.currentTarget as HTMLTextAreaElement
          if (ev.key == 'Enter' && !ev.shiftKey) {
            ev.preventDefault()
            if (file(t.value)) {
              t.value = ''
              setText('')
            }
          } else if (ev.key == 'Escape') close()
        }}
        onBlur={close}
      />
    </>
  )
}

export let Board = ({ e }: { e: Ent }) => {
  // Which column's quick-create box is open ('' = none). One at a time:
  // the box is a keyboard, and there's one keyboard.
  let [adding, setAdding] = useState('')
  // A board that says .order=hot ranks its columns by warmth, not
  // priority — the Front page: attention IS the ordering. Drag-drop
  // still writes priorities (adopt semantics unchanged); the ranking is
  // read-time only, like everything hot().
  let order = byPriority
  try {
    if (orderOf(parseQuery(String(e.board?.query ?? ''))) == 'hot') {
      order = byWarmth(Date.now())
    }
  } catch { /* boardTasks below surfaces the bad query */ }
  // The ephemeral filter (typed in the titlebar) ANDs into the saved
  // query at read time only — drops and quick-adds still adopt from
  // board.query alone, so a glance never leaks into what a filed task
  // carries.
  let pass = passOf(e.eid)
  let tasks: Ent[]
  try {
    tasks = boardTasks(e).filter((k) => pass(k.eid))
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

  // Quick-create: a task born INTO the column it was typed in. The line
  // is PARSED, not just taken (client.ts spec): 'P1 .domain=Eng Ship it'
  // sets priority and domain, Shift+Enter lines become the body. The
  // column's status and the query's scalar equalities (adopt(), the
  // drop's own path) ride along, but what you TYPED wins over the auto
  // top-landing priority. Lands at the top where the typist is looking.
  let create = (status: string, list: Ent[], text: string) => {
    let { title, body, grouped } = spec(text)
    if (!title) return false
    mutate(...taskChanges(uuid(), {
      ...grouped,
      doc: { title, body, ...grouped.doc },
      task: {
        ...adopt(parseQuery(String(e.board?.query ?? '')), 'task'),
        priority: (list[0]?.task?.priority ?? 1) - 1,
        ...grouped.task,
        status,
      },
    }))
    return true
  }

  return (
    <Frame>
      {statuses.map((s) => {
        let list = tasks.filter((k) => k.task?.status == s).sort(order)
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
            {!folded.has(s) && adding == s && (
              <QuickAdd
                file={(text) => create(s, list, text)}
                close={() => setAdding('')}
              />
            )}
            {!folded.has(s) && (
              <Scroll>
                {list.map((k) => (
                  <Item
                    key={k.eid}
                    draggable
                    data-eid={k.eid}
                    onDragStart={(ev: DragEvent) => dragData(ev, k.eid, 'Full')}
                  >
                    <View eid={k.eid} view='Board.List.Tile' />
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

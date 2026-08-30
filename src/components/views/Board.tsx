import { useEffect, useRef, useState } from 'preact/hooks'
import { type Ent, statusOf } from '../../types.ts'
import {
  boardTally,
  boardTasks,
  byPriority,
  byWarmth,
  clientId,
  ent,
  foldFor,
  mutate,
  statuses,
  uuid,
} from '../../live.ts'
import { spec, taskChanges } from '../../client.ts'
import { adopt, orderOf, parseQuery } from '../../query.ts'
import { peek, useDraft } from '../drafts.ts'
import { useBoardSub, useBoardTally } from '../subscriptions.ts'
import { SubscriptionFailure } from '../SubscriptionFailure.tsx'
import { block } from '../ui.tsx'
import { Dot } from '../Dot.tsx'
import { Prio } from '../Prio.tsx'
import { filterLine, usePassOf } from '../Filter.tsx'
import { dragData } from '../drag.ts'
import { Entity } from '../Entity.tsx'

let Frame = block('div', 'Board', {
  Col: 'div',
  ColName: 'div',
  Count: 'span',
  Scroll: 'div',
  Item: 'div',
  Add: 'div',
  More: 'button',
  New: 'textarea',
  Chips: 'div',
  Chip: 'span',
})
let { Col, ColName, Count, Scroll, Item, Add, More, New, Chips, Chip } = Frame

// Bound the initial DOM, not the board: every task remains one explicit click
// away. A large project otherwise builds tens of thousands of nodes before the
// operator can interact with its first card.
export let CAP = 100
export let visible = <T,>(rows: T[], expanded: boolean) => ({
  rows: expanded ? rows : rows.slice(0, CAP),
  more: expanded ? 0 : Math.max(0, rows.length - CAP),
})

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
// closes. Uncontrolled on purpose: the DOM owns the text, state only
// mirrors it for the chips. dkey persists the line per (board, column) —
// a hot swap or reload that unmounts this box (adding resets) is caught
// by Board reopening the column from the draft, so a half-typed task is
// never lost. Blur closes the box but KEEPS the draft (Board resurfaces
// it); only filing or Escape spends it.
let QuickAdd = (
  { dkey, file, close }: {
    dkey: string
    file: (text: string) => boolean
    close: () => void
  },
) => {
  let [text, setText] = useState('')
  let box = useRef<HTMLTextAreaElement>(null)
  let { sync, spend } = useDraft(dkey, box, setText)
  useEffect(() => void box.current?.focus(), [])
  let { body, grouped } = spec(text)
  let p = grouped.task?.priority
  let chips = Object.entries(grouped).flatMap(([comp, props]) =>
    props == null ? [`${comp}=false`] : Object.entries(props)
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
        elRef={box}
        rows={1}
        placeholder='P1 .domain=Eng title…'
        onInput={(ev: InputEvent) =>
          sync(ev.currentTarget as HTMLTextAreaElement)}
        onKeyDown={(ev: KeyboardEvent) => {
          let t = ev.currentTarget as HTMLTextAreaElement
          if (ev.key == 'Enter' && !ev.shiftKey) {
            ev.preventDefault()
            if (file(t.value)) {
              t.value = ''
              setText('')
              spend()
            }
          } else if (ev.key == 'Escape') {
            spend()
            close()
          }
        }}
        onBlur={close}
      />
    </>
  )
}

// The quick-add draft key for one column — stable across remounts, so a
// swap or reload reseeds the exact box that was being typed in.
let addKey = (eid: string, status: string) => `new:${eid}:${status}`

export let Board = ({ e }: { e: Ent }) => {
  let boardRead = useBoardSub(e)
  // The member sub is a WINDOW now (live.ts boardLine), so the rows a column
  // holds are a page of it — while the COUNT a column names is the whole
  // truth, and it comes from the same aggregate the tile reads (T-22509): one
  // indexed group-by instead of a membership stream nobody paints. A column
  // reading its own length would report the page as the set.
  // The tally answers the SAVED query, so it stops being this board's truth the
  // moment the titlebar's ephemeral filter narrows what's on screen — then the
  // held rows are the only set anyone is claiming.
  useBoardTally(e)
  let counts = filterLine(e.eid).trim() ? undefined : boardTally(e)
  // Which column's quick-create box is open ('' = none). One at a time:
  // the box is a keyboard, and there's one keyboard. On mount, a column
  // with a live draft reopens itself — a half-typed task the last mount
  // (hot swap, reload, closed card) never got to file resurfaces where it
  // was left, caret and all.
  let [adding, setAdding] = useState(() =>
    statuses.find((s) => peek(addKey(e.eid, s))) ?? ''
  )
  let [expanded, setExpanded] = useState<Record<string, boolean>>({})
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
  let pass = usePassOf(e.eid)
  let failed = boardRead?.state.status == 'failed'
    ? boardRead
    : pass.subscription?.state.status == 'failed'
    ? pass.subscription
    : undefined
  if (failed) {
    return (
      <Frame>
        <SubscriptionFailure read={failed} />
      </Frame>
    )
  }
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
  let row = me ? foldFor(me, e.eid) : null
  let folded = new Set(
    String(row?.statuses ?? '').split(',').filter(Boolean),
  )
  let fold = (s: string) => {
    if (!me) return
    folded.has(s) ? folded.delete(s) : folded.add(s)
    mutate({
      eid: row?.eid ?? crypto.randomUUID(),
      name: 'fold',
      comp: {
        client: me,
        board: e.eid,
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
    let { target } = JSON.parse(data)
    if (!ent(target).task) return // not a task: let the canvas spawn it
    ev.preventDefault()
    ev.stopPropagation()
    // The new neighbours: this column's tasks (minus the dragged one), in
    // render order; the drop's insertion index comes from the row midpoints.
    let list = tasks
      .filter((k) => k.task && statusOf(k) == status && k.eid != target)
      .sort(byPriority)
    let rows = [...ev.currentTarget.querySelectorAll('.Board_Item')]
      .filter((r) => (r as HTMLElement).dataset.eid != target)
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
      eid: target,
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
        let list = tasks.filter((k) => k.task && statusOf(k) == s).sort(order)
        let pageKey = `${e.eid}:${s}`
        let page = visible(list, !!expanded[pageKey])
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
              <Count>{counts?.[s] ?? list.length}</Count>
              {!folded.has(s) && adding != s && (
                <Add onClick={() => setAdding(s)} title={`new ${s} task`}>
                  +
                </Add>
              )}
            </ColName>
            {!folded.has(s) && adding == s && (
              <QuickAdd
                dkey={addKey(e.eid, s)}
                file={(text) => create(s, list, text)}
                close={() => setAdding('')}
              />
            )}
            {!folded.has(s) && (
              <Scroll>
                {page.rows.map((k) => (
                  <Item
                    key={k.eid}
                    draggable
                    data-eid={k.eid}
                    onDragStart={(ev: DragEvent) => dragData(ev, k.eid, 'Full')}
                  >
                    <Entity eid={k.eid} view='Board.List.Tile' />
                  </Item>
                ))}
                {page.more > 0 && (
                  <More
                    type='button'
                    onClick={() =>
                      setExpanded((seen) => ({ ...seen, [pageKey]: true }))}
                  >
                    +{page.more} more
                  </More>
                )}
              </Scroll>
            )}
          </Col>
        )
      })}
    </Frame>
  )
}

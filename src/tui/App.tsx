// The TUI app: browse the first board with vim keys. Everything
// below this file is shared with the web — same cache, same registry, same
// mode signal. Only Board and the task Full are overridden (columns become
// a nested list, the body reads as raw markdown); Dot, Id, Dependency and
// Debug.Tile render through the very same components the browser uses,
// painted as lines instead of CSS.
import { signal } from '@preact/signals'
import { useBoardSub } from '../components/subscriptions.ts'
import { formatProp, propAt } from '../props.ts'
import { type Ent, idOf } from '../types.ts'
import {
  applyLocal,
  boardTasks,
  byPriority,
  cache,
  commentsOn,
  ent,
  gated,
  mode,
  mutate,
  problem,
  rows as graph,
  send,
  statuses,
} from '../live.ts'
import { type Command, commands, type Ctx, run } from '../commands.ts'
import { has, type Renderer, resolve } from '../components/registry.ts'
import { Entity } from '../components/Entity.tsx'
import { byline, viaName } from '../components/Comments.tsx'
import { Dot } from '../components/Dot.tsx'
import { Id } from '../components/views/Inline.tsx'
import { clipboard } from './paint.ts'
import { Md } from './md.tsx'

export let sel = signal({ col: 0, row: 0 })
export let quit = signal(false)
let msg = signal('')
let buf = signal('') // the : command line
let priority = propAt('task', 'priority')!

// The first board is the one we browse — v0 has exactly one.
let boardEid = () =>
  Object.entries(cache.value)
    .filter(([, r]) => r.board)
    .sort(([, a], [, b]) => (a.entity?.num ?? 0) - (b.entity?.num ?? 0))[0]
    ?.[0]

let rows = (e: Ent, status: string) =>
  boardTasks(e).filter((k) => k.task?.status == status).sort(byPriority)

export let selected = () => {
  let p = boardEid()
  if (!p) return undefined
  let list = rows(ent(p), statuses[sel.value.col])
  return list[Math.min(sel.value.row, list.length - 1)]?.eid
}

// Where we are: a trail of entities entered with l/Enter; empty = the
// board. h (or Ctrl-d, from any mode) pops back out.
export let trail = signal<string[]>([])

let enter = (): boolean => {
  let s = selected()
  if (!s || trail.value.at(-1) == s) return false
  trail.value = [...trail.value, s]
  return true
}

let back = () => {
  trail.value = trail.value.slice(0, -1)
  mode.value = 'normal'
}

// The in-progress edit. TUI insert mode is append/backspace on one prop,
// edited right where it lives: the LOCAL cache carries text + a block
// caret while typing (the wire never sees it), so whatever view shows the
// prop shows the edit. One clean patch goes out when insert ends. Escape
// commits — vim leaves insert, it doesn't cancel. i on the board edits
// the selected title; i (or Enter from the board) on a task, the body.
let edit = signal<
  { eid: string; prop: 'title' | 'body'; text: string; was: string } | null
>(null)

let show = (e: NonNullable<typeof edit.value>, caret: boolean) =>
  applyLocal([{
    eid: e.eid,
    name: 'doc',
    comp: { [e.prop]: caret ? e.text + '█' : e.text },
  }])

let startEdit = () => {
  let here = trail.value.at(-1)
  let eid = here ?? selected()
  if (!eid || !ent(eid).doc) return
  let prop: 'title' | 'body' = here ? 'body' : 'title'
  let was = ent(eid).doc![prop] ?? ''
  edit.value = { eid, prop, text: was, was }
  mode.value = 'insert'
  show(edit.value, true)
}

let typeEdit = (k: string) => {
  let e = edit.value
  if (!e) return
  if (k == '\x7f') e = { ...e, text: e.text.slice(0, -1) }
  else if (k == '\r' && e.prop == 'body') e = { ...e, text: e.text + '\n' }
  else if (k == '\r') return endEdit()
  else if (k >= ' ') e = { ...e, text: e.text + k }
  else return
  edit.value = e
  show(e, true)
}

let endEdit = () => {
  let e = edit.value
  if (!e) {
    mode.value = 'normal'
    return
  }
  show(e, false) // strip the caret from the local cache
  if (e.text != e.was) {
    send({ eid: e.eid, name: 'doc', comp: { [e.prop]: e.text } })
  }
  edit.value = null
  mode.value = 'normal'
}

// Yank the current entity through its Markdown file form (the same registry
// forms that power drag-to-desktop on the web; non-tasks fall back to
// JSON). OSC 52 rides the tty, so the copy lands even over ssh.
let yank = () => {
  let eid = trail.value.at(-1) ?? selected()
  if (!eid) return
  let e = ent(eid)
  let f = resolve(e, 'Markdown').file!
  clipboard(f.text(e))
  msg.value = `yanked ${idOf(e)}.${f.ext}`
}

// Vertically the board reads as ONE list: j past the bottom of a column
// continues into the next column's first row, k mirrors it back up.
let vert = (d: number) => {
  let p = boardEid()
  if (!p) return
  let e = ent(p)
  let flat = statuses.flatMap((s, col) =>
    rows(e, s).map((_, row) => ({ col, row }))
  )
  if (!flat.length) return
  let i = flat.findIndex((x) =>
    x.col == sel.value.col && x.row == Math.min(
        sel.value.row,
        rows(e, statuses[sel.value.col]).length - 1,
      )
  )
  sel.value = flat[Math.max(0, Math.min(flat.length - 1, i + d))]
}

// The Board override: columns as a nested list, the selection inverted.
// Each row is the same Debug.Tile the web's inspector uses.
let TuiBoard = ({ e }: { e: Ent }) => (
  <div class='TBoard'>
    {statuses.map((s, ci) => (
      <div class='TCol'>
        <div class='TCol_Name'>
          {`${s.toUpperCase()} (${rows(e, s).length})`}
        </div>
        {rows(e, s).map((k, ri) => (
          <div
            class={ci == sel.value.col && ri == sel.value.row
              ? 'TRow TRow-on'
              : 'TRow'}
          >
            <Entity eid={k.eid} view='Debug.Tile' />
          </div>
        ))}
      </div>
    ))}
  </div>
)

// The web Full renders its body as markdown through innerHTML, which the
// fake DOM ignores — here the raw source IS the readable form (that's
// markdown's whole point), so the TUI overrides a task's Full with a
// plain-text twin.
let TuiTask = ({ e }: { e: Ent }) => (
  <div class='Task'>
    <div class='Task_Head'>
      <Dot status={e.task!.status} gated={gated(e)} />
      <span class='Task_Title'>{e.doc?.title}</span>
      <span class='Task_Prio'>{formatProp(priority, e.task!.priority)}</span>
      {e.claim && (
        <span class='Task_Claim'>
          ⚑ {viaName(e.claim.session_eid)}
        </span>
      )}
      <Id e={e} />
    </div>
    {e.doc?.body && (
      <p class='Task_Body'>
        <Md text={e.doc.body} />
      </p>
    )}
    {e.refs.map((r) => (
      <Entity key={r.child} eid={r.child} view='Dependency' type={r.type} />
    ))}
    {commentsOn(e.eid).map((c) => (
      <div class='TComment'>
        <span class='Comments_Who'>{byline(c)}</span>{' '}
        <Md text={c.doc?.body ?? ''} />
      </div>
    ))}
  </div>
)

// Same scores as the shared entries they shadow — a tie goes to the
// override because platform layers are consulted first.
export let overrides: Renderer[] = [
  { view: 'Board', match: has('doc', 'board'), Render: TuiBoard },
  { view: 'Full', match: has('doc', 'task'), Render: TuiTask },
]

// The command context here: the entity you're IN (the trail's head), or
// the row the cursor is on at the board — the same "what you're looking
// at" rule the web reads off its URL.
let ctx = (): Ctx => ({ eid: trail.value.at(-1) ?? selected(), rows: graph() })

// Quitting is the one verb a browser has no answer for; the rest of the
// language is shared (commands.ts).
let bye: Command = {
  args: '',
  about: 'leave',
  run: () => {
    quit.value = true
    return {}
  },
}
let local: Record<string, Command> = { q: bye, quit: bye }

let exec = (line: string) => {
  try {
    let r = run(line, ctx(), local)
    if (r.changes?.length) mutate(...r.changes)
    if (r.go) trail.value = [...trail.value, r.go]
    msg.value = r.msg ?? ''
  } catch (e) {
    msg.value = e instanceof Error ? e.message : String(e)
  }
}

// Raw stdin, one key at a time. Normal mode is vim; : opens the command
// line, which owns every key until Enter or Escape. Ctrl-d backs out of
// the current entity from ANY mode; everything else is per-mode.
export let key = (k: string) => {
  if (k == '\x04') {
    if (mode.value == 'insert') endEdit() // commit, then out — no data loss
    return back()
  }
  if (mode.value == 'command') {
    if (k == '\r') {
      exec(buf.value)
      buf.value = ''
      mode.value = 'normal'
    } else if (k == '\x1b') {
      buf.value = ''
      mode.value = 'normal'
    } else if (k == '\x7f') buf.value = buf.value.slice(0, -1)
    else if (k >= ' ') buf.value += k
    return
  }
  if (mode.value == 'insert') {
    if (k == '\x1b') endEdit()
    else typeEdit(k)
    return
  }
  if (k == ':') {
    msg.value = ''
    buf.value = ''
    mode.value = 'command'
  } else if (k == 'j') vert(1)
  else if (k == 'k') vert(-1)
  else if (k == 'l') enter()
  else if (k == 'i') startEdit()
  else if (k == '\r') {
    if (enter()) startEdit()
  } else if (k == 'h') back()
  else if (k == 'y') yank()
  else if (k == 'q' || k == '\x03') quit.value = true
  else if (k == '\x1b') msg.value = ''
}

let TStatus = () => {
  // the verb greens once it names a command — the web bar does the same
  let [, pre, verb, rest] = buf.value.match(/^(\s*)(\S+)(.*)$/s) ?? []
  return (
    <footer class='TStatus'>
      {mode.value == 'command'
        ? (
          <span class='TStatus_Cmd'>
            :{verb
              ? (
                <>
                  {pre}
                  {(commands[verb] ?? local[verb])
                    ? <span class='TStatus_Verb'>{verb}</span>
                    : verb}
                  {rest}
                </>
              )
              : buf.value}█
          </span>
        )
        : (
          <>
            <span class={`TStatus_Mode TStatus_Mode-${mode.value}`}>
              {mode.value == 'insert'
                ? '-- INSERT --'
                : mode.value.toUpperCase()}
            </span>
            {(msg.value || problem.value) && (
              <span class='TStatus_Msg'>{msg.value || problem.value}</span>
            )}
            <span class='TStatus_Hint'>
              j/k browse · l in · h out · i edit · y yank · : cmd · q quit
            </span>
          </>
        )}
    </footer>
  )
}

// The screen: the board when the trail is empty, else the entered entity
// through its first applicable view. The title doubles as the breadcrumb.
export let App = () => {
  let p = boardEid()
  useBoardSub(p ? ent(p) : undefined)
  let s = selected()
  let here = trail.value.at(-1)
  // The trail persists across runs; entities don't have to. Drop any
  // entries the graph no longer knows (deleted while we were away).
  if (here && !cache.value[here]) {
    trail.value = trail.value.filter((eid) => cache.value[eid])
    here = trail.value.at(-1)
  }
  let crumbs = [
    p ? ent(p).doc?.title ?? 'untitled' : 'no board',
    ...trail.value.map((eid) => idOf(ent(eid))),
  ]
  return (
    <div class='TApp'>
      <div class='TTitle'>{['tasks', ...crumbs].join(' · ')}</div>
      {here ? <Entity eid={here} /> : p && (
        <>
          <Entity eid={p} view='Board' />
          {s && (
            <div class='TDetail'>
              <Entity eid={s} view='Full' />
            </div>
          )}
        </>
      )}
      <TStatus />
    </div>
  )
}

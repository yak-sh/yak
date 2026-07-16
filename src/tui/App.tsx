// The TUI app: browse the first project's board with vim keys. Everything
// below this file is shared with the web — same cache, same registry, same
// mode signal. Only Board is overridden (columns become a nested list);
// Task, Dot, Id, Dependency and Debug.ListItem render through the very same
// components the browser uses, painted as lines instead of CSS.
import { signal } from '@preact/signals'
import { type Ent } from '../types.ts'
import {
  applyLocal,
  byPriority,
  cache,
  ent,
  mode,
  send,
  statuses,
} from '../live.ts'
import { type Renderer, resolve, View } from '../components/View.tsx'
import { idOf } from '../components/views/Id.tsx'
import { clipboard } from './paint.ts'

export let sel = signal({ col: 0, row: 0 })
export let quit = signal(false)
let msg = signal('')
let buf = signal('') // the : command line

// The first project is the board we browse — v0 has exactly one.
let projEid = () =>
  Object.entries(cache.value)
    .filter(([, r]) => r.project)
    .sort(([, a], [, b]) => (a.entity?.num ?? 0) - (b.entity?.num ?? 0))[0]
    ?.[0]

let rows = (e: Ent, status: string) =>
  e.kids.filter((k) => k.task?.status == status).sort(byPriority)

export let selected = () => {
  let p = projEid()
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

// The in-progress edit. TUI insert mode is append/backspace on one prop:
// every keystroke lands in the local cache (the text changes in place,
// live), the wire hears ONE patch when insert ends. Escape commits — vim
// leaves insert, it doesn't cancel. i on the board edits the selected
// title; i (or Enter from the board) on a task edits its body.
let edit = signal<
  { eid: string; prop: 'title' | 'body'; text: string; was: string } | null
>(null)

let startEdit = () => {
  let here = trail.value.at(-1)
  let eid = here ?? selected()
  if (!eid || !ent(eid).task) return
  let prop: 'title' | 'body' = here ? 'body' : 'title'
  let was = ent(eid).task![prop] ?? ''
  edit.value = { eid, prop, text: was, was }
  mode.value = 'insert'
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
  applyLocal([{ eid: e.eid, name: 'task', comp: { [e.prop]: e.text } }])
}

let endEdit = () => {
  let e = edit.value
  if (e && e.text != e.was) {
    send({ eid: e.eid, name: 'task', comp: { [e.prop]: e.text } })
  }
  edit.value = null
  mode.value = 'normal'
}

// Yank the current entity through its MD file form (the same registry
// forms that power drag-to-desktop on the web; non-tasks fall back to
// JSON). OSC 52 rides the tty, so the copy lands even over ssh.
let yank = () => {
  let eid = trail.value.at(-1) ?? selected()
  if (!eid) return
  let e = ent(eid)
  let f = resolve(e, 'MD').file!
  clipboard(f.text(e))
  msg.value = `yanked ${idOf(e)}.${f.ext}`
}

// Vertically the board reads as ONE list: j past the bottom of a column
// continues into the next column's first row, k mirrors it back up.
let vert = (d: number) => {
  let p = projEid()
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
// Each row is the same Debug.ListItem the web's inspector uses.
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
            <View eid={k.eid} view='Debug.ListItem' />
          </div>
        ))}
      </div>
    ))}
  </div>
)

export let overrides: Renderer[] = [
  { view: 'Board', match: (e) => !!e.project, Render: TuiBoard },
]

let commands: Record<string, (args: string[]) => string | void> = {
  q: () => {
    quit.value = true
  },
  quit: () => {
    quit.value = true
  },
}

let run = (line: string) => {
  let [name, ...args] = line.trim().split(/\s+/)
  if (!name) return
  let c = commands[name]
  msg.value = c ? c(args) ?? '' : `not a command: ${name}`
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
      run(buf.value)
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

let TStatus = () => (
  <footer class='TStatus'>
    {mode.value == 'command'
      ? <span class='TStatus_Cmd'>:{buf.value}█</span>
      : (
        <>
          <span class={`TStatus_Mode TStatus_Mode-${mode.value}`}>
            {mode.value == 'insert' ? '-- INSERT --' : mode.value.toUpperCase()}
          </span>
          {mode.value == 'insert' && edit.value && (
            <span class='TStatus_Cmd'>
              {`${edit.value.prop}: ${
                edit.value.text.split('\n').at(-1) ?? ''
              }█`}
            </span>
          )}
          {msg.value && <span class='TStatus_Msg'>{msg.value}</span>}
          <span class='TStatus_Hint'>
            j/k browse · l in · h out · i edit · y yank · : cmd · q quit
          </span>
        </>
      )}
  </footer>
)

// The screen: the board when the trail is empty, else the entered entity
// through its first applicable view. The title doubles as the breadcrumb.
export let App = () => {
  let p = projEid()
  let s = selected()
  let here = trail.value.at(-1)
  let crumbs = [
    p ? ent(p).project!.title : 'no project',
    ...trail.value.map((eid) => idOf(ent(eid))),
  ]
  return (
    <div class='TApp'>
      <div class='TTitle'>{['tasks', ...crumbs].join(' · ')}</div>
      {here ? <View eid={here} /> : p && (
        <>
          <View eid={p} view='Board' />
          {s && (
            <div class='TDetail'>
              <View eid={s} view='Task' />
            </div>
          )}
        </>
      )}
      <TStatus />
    </div>
  )
}

// The TUI app: browse the first project's board with vim keys. Everything
// below this file is shared with the web — same cache, same registry, same
// mode signal. Only Board is overridden (columns become a nested list);
// Task, Dot, Id, Dependency and Debug.ListItem render through the very same
// components the browser uses, painted as lines instead of CSS.
import { signal } from '@preact/signals'
import { type Ent } from '../types.ts'
import { byPriority, cache, ent, mode, statuses } from '../live.ts'
import { type Renderer, View } from '../components/View.tsx'

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

// Sideways: hop columns, keeping the row (clamped live against the board —
// rows come and go under us when another client drags a task away).
let horiz = (d: number) => {
  let p = projEid()
  if (!p) return
  let col = Math.max(0, Math.min(statuses.length - 1, sel.value.col + d))
  let len = rows(ent(p), statuses[col]).length
  let row = Math.max(0, Math.min(len - 1, sel.value.row))
  sel.value = { col, row }
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
// line, which owns every key until Enter or Escape.
export let key = (k: string) => {
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
  if (k == ':') {
    msg.value = ''
    buf.value = ''
    mode.value = 'command'
  } else if (k == 'j') vert(1)
  else if (k == 'k') vert(-1)
  else if (k == 'h') horiz(-1)
  else if (k == 'l') horiz(1)
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
          {msg.value && <span class='TStatus_Msg'>{msg.value}</span>}
          <span class='TStatus_Hint'>j/k/h/l browse · : cmd · q quit</span>
        </>
      )}
  </footer>
)

export let App = () => {
  let p = projEid()
  let s = selected()
  return (
    <div class='TApp'>
      <div class='TTitle'>
        tasks{p ? ` · ${ent(p).project!.title}` : ' · no project'}
      </div>
      {p && <View eid={p} view='Board' />}
      {s && (
        <div class='TDetail'>
          <View eid={s} view='Task' />
        </div>
      )}
      <TStatus />
    </div>
  )
}

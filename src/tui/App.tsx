// The TUI app: browse the first board with vim keys. Everything
// below this file is shared with the web — same cache, same registry, same
// mode signal. Only Board and the task Full are overridden (columns become
// a nested list, the body reads as raw markdown); Dot, Id, Dependency and
// Debug.Tile render through the very same components the browser uses,
// painted as lines instead of CSS.
import { signal } from '@preact/signals'
import { useBoardSub } from '../components/subscriptions.ts'
import { useCommentsOn } from '../components/useQuery.ts'
import { tuiKeys } from '../keybindings.ts'
import { formatProp, propAt } from '../props.ts'
import { type Ent, idOf, verdictName } from '../types.ts'
import {
  applyLocal,
  boardTasks,
  byPriority,
  cache,
  capable,
  crewed,
  ent,
  findEid,
  gated,
  mode,
  mutate,
  pending,
  problem,
  queryEids,
  repoUrl,
  rows as graph,
  send,
  statuses,
  uuid,
} from '../live.ts'
import { parseQuery, resolveRefs } from '../query.ts'
import {
  type Command,
  commands,
  type Ctx,
  run,
  type SpawnIntent,
  spawnTask,
} from '../commands.ts'
import { inflate, sessionFrames, spawnPlan } from '../client.ts'
import {
  applicable,
  has,
  type Renderer,
  resolve,
} from '../components/registry.ts'
import { Entity } from '../components/Entity.tsx'
import { byline, viaName } from '../components/Comments.tsx'
import { Dot } from '../components/Dot.tsx'
import { Id } from '../components/views/Inline.tsx'
import { eidOf } from '../components/nav.tsx'
import { clipboard, link } from './paint.ts'
import { root, touch } from './dom.ts'
import { Md } from './md.tsx'
import {
  type AccountControl,
  type AccountView,
  codexAccount,
} from '../account_client.ts'
import {
  type ConfigControl,
  configControl,
  type CredStatus,
  type SettingRow,
} from '../config_client.ts'
import { catalog as settingCatalog, spec as settingSpec } from '../config.ts'
import { catalog } from '../providers.ts'
import { liveBlocked, load, providers } from '../components/Run.tsx'
import { useQuery } from '../components/useQuery.ts'
import { navigationQuery, navigationView } from '../navigation.ts'

export let sel = signal({ col: 0, row: 0 })
export let quit = signal(false)
let msg = signal('')
let buf = signal('') // the : command line
export let help = signal(false)
export let configOpen = signal(false)
export let configSel = signal(0)
export let accountCallback = signal<string | null>(null)
// Which backend the operator is entering for a secret this session: a local
// plaintext value or a 1Password op:// reference. Absent = local value.
let credBackend = signal<Record<string, 'value' | 'op'>>({})
// The in-progress field entry. A setting draft is plain; a secret `value` is
// masked on PAINT (never its bytes) and an `op` reference is plain text (it is
// not a secret). Cleared on commit or cancel, so no secret lingers here.
let configEdit = signal<
  { kind: 'setting' | 'value' | 'op'; key: string; text: string } | null
>(null)
export let navigationOpen = signal(false)
export let navigationPick = signal(0)
let priority = propAt('task', 'priority')!

// The first board is the one we browse — v0 has exactly one. Membership reads
// the query door (T-17064); the num sort peeks rows without re-subscribing.
let boardEid = () =>
  queryEids(parseQuery('.board!'))
    .value
    .toSorted((a, b) =>
      (cache.peek()[a]?.entity?.num ?? 0) - (cache.peek()[b]?.entity?.num ?? 0)
    )[0]

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

// HOW we're looking at it. The web gives every entity a row of tabs and
// names the choice in `?v=`; the terminal reached none of it, so an
// entity always painted through whichever renderer scored highest and
// the Inbox — among others — was unreachable here. Keyed by eid so
// stepping back out and in again returns you to the view you were in;
// persisted beside the trail for the same reason it is.
export let views = signal<Record<string, string>>({})

// WHERE in the pane we are reading: the cursor's LINE, keyed by eid beside
// the trail and persisted with it, so stepping out and back in returns you
// to the line you left. One number is the whole scroll state — the window
// derives from it in the painter (win()), which alone knows how tall the
// window and the content came out.
//
// A line cursor rather than a bare offset because it answers `l` too: the
// lines already carry the hrefs the web navigates, so an Inbox row is
// enterable without Inbox, List and Comments — shared with the web — each
// growing a terminal-only selection to paint.
export let spots = signal<Record<string, number>>({})

// -1 at the board: its j/k move a cursor over the QUERY (sel), which is a
// different thing — a query cursor can be entered, a line can only be read.
export let spot = () =>
  trail.value.length ? spots.value[trail.value.at(-1)!] ?? 0 : -1

let jump = (to: number) => {
  let here = trail.value.at(-1)
  to = Math.max(0, to)
  if (!here || spot() == to) return
  spots.value = { ...spots.value, [here]: to }
  touch() // a scroll moves no nodes; the screen changed anyway
}

// The painter measured: a cursor past the end — the content shrank, the
// window grew, the terminal was resized — comes back to the last line.
export let fit = (lines: number) => jump(Math.min(spot(), lines - 1))

// The views this entity offers: the SAME curated tabs the web screens
// `?v=` against, so the two doors can't drift apart as views are added.
// No terminal-only allowlist — the TUI overrides Board and Full and lets
// the rest render through the shared registry into the fake DOM, which
// is the seam working as intended rather than a gap to paper over.
let tabsFor = (eid: string) => applicable(ent(eid))

// The view a pane is SHOWING when none was picked. Not tabs[0] — the
// tab ORDER and the renderer SCORES are different rankings and they
// disagree: a project tabs Inbox first but paints Full, so seeding the
// cycle with tabs[0] made the first ⇥ a visible no-op. Ask the registry
// the same question <Entity> asks when it gets no view prop.
let viewOf = (eid: string) => views.value[eid] ?? resolve(ent(eid)).view

// ⇥ walks the row forward, ⇧⇥ back, both wrapping.
let cycle = (d: number) => {
  let here = trail.value.at(-1)
  if (!here) return
  let tabs = tabsFor(here)
  if (tabs.length < 2) return
  let at = tabs.indexOf(viewOf(here))
  views.value = {
    ...views.value,
    [here]: tabs[(at + d + tabs.length) % tabs.length],
  }
  jump(0) // another view is other content — land at its top, not mid-pane
}

// What the cursor line points at: the entity its link names. Absent on a
// line that is only prose, which is why `l` there does nothing.
let pointed = () => {
  let href = link(root, spot())
  return href?.startsWith('/') ? eidOf(href.slice(1)) : undefined
}

let enter = (): boolean => {
  let s = trail.value.length ? pointed() : selected()
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
  // `was` is what the commit diffs against, so editing a body this client
  // was never shipped would send the typing over the stored text. Wait for
  // it — asking is what brings it (live.ts `pending`).
  if (prop == 'body' && pending(ent(eid))) {
    msg.value = 'body still loading'
    return
  }
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

// j/k walk a pane's lines, but the board's rows are a QUERY's, so there
// they walk `sel` — which is also why the board itself doesn't scroll: its
// cursor isn't a line, so the window has nothing to follow. Vertically the
// board reads as ONE list: j past the bottom of a column continues into
// the next column's first row, k mirrors it back up.
let vert = (d: number) => {
  if (trail.value.length) return jump(spot() + d)
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
      <Dot status={e.task!.status} gated={gated(e)} live={crewed(e)} />
      <span class='Task_Title'>{e.doc?.title}</span>
      <span class='Task_Prio'>{formatProp(priority, e.task!.priority)}</span>
      {e.claim && (
        <span class='Task_Claim'>
          ⚑ {viaName(e.claim.session)}
        </span>
      )}
      <Id e={e} />
    </div>
    {
      /* An unshipped body is not an empty one: the wait paints, and asking
        is what ends it (live.ts `pending`). */
    }
    {pending(e)
      ? <p class='Task_Body'>…</p>
      : e.doc?.body && (
        <p class='Task_Body'>
          <Md text={e.doc.body} repo={repoUrl(e)} />
        </p>
      )}
    {e.refs.map((r) => (
      <Entity key={r.child} eid={r.child} view='Dependency' type={r.type} />
    ))}
    {useCommentsOn(e.eid).map((c) => (
      <div class='TComment'>
        <span class='Comments_Who'>{byline(c)}</span> {c.review && (
          <span
            class={`Comments_Verdict-${c.review.verdict.replaceAll('_', '-')}`}
          >
            [{verdictName(c.review.verdict)}]{' '}
          </span>
        )}
        <Md
          text={pending(c) ? '…' : c.doc?.body ?? ''}
          repo={repoUrl(c)}
        />
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
// at" rule the web reads off its URL. A terminal has a filesystem, so
// `:set .body=@file` reads it here exactly as it does from the shell.
let ctx = (): Ctx => ({
  eid: trail.value.at(-1) ?? selected(),
  rows: graph(),
  read: inflate,
})

// Quitting is the one verb a browser has no answer for; the rest of the
// language is shared (commands.ts).
let bye: Command = {
  args: [],
  about: 'leave',
  run: () => {
    quit.value = true
    return {}
  },
}
let local: Record<string, Command> = { q: bye, quit: bye }

// :fix in the TUI spawns through the SAME unified catalog the web and CLI use:
// the default model once, its transport chosen by readiness (graph-native Codex
// when signed in, else the CLI fallback). No canvas here, so the session is a
// lone graph write — created(session) validates and launches it.
let spawn = async (intent: string | SpawnIntent) => {
  if (!providers.value.length) await load()
  let wanted = typeof intent == 'string' ? {} : intent
  let task = spawnTask(intent)
  // The one precedence every door shares (spawnPlan): explicit ask > the
  // task's spawn hint > table default. Transports judged by live readiness.
  let plan = spawnPlan(graph(), providers.value, {
    task,
    ask: wanted,
    blocked: await liveBlocked(),
  })
  if (!plan.provider || !plan.model) {
    throw new Error('no matching provider/model')
  }
  // Medium effort by default when the model has the axis — the Run form's rule.
  let axis = catalog(providers.value).find((p) => p.model == plan.model)
    ?.efforts ?? []
  let effort = plan.effort ??
    (axis.length ? (axis.includes('medium') ? 'medium' : axis[0]) : undefined)
  let eid = uuid()
  let comp = {
    id: uuid(),
    provider: plan.provider,
    model: plan.model,
    ...(effort ? { effort } : {}),
    ...(task ? { requested_task: task } : {}),
    ...(plan.persona ? { persona: plan.persona } : {}),
  }
  // Canonical `spawn` rides only when the server advertises it; otherwise the
  // legacy session frame alone, which the server materializes into spawn.
  mutate(
    ...(capable('spawn')
      ? sessionFrames(eid, comp)
      : [{ eid, name: 'session', comp }]),
    ...(wanted.prompt
      ? [{ eid, name: 'doc', comp: { title: '', body: wanted.prompt } }]
      : []),
  )
}

let exec = (line: string) => {
  try {
    let r = run(line, ctx(), local)
    if (r.changes?.length) mutate(...r.changes)
    if (r.go) trail.value = [...trail.value, r.go]
    if (r.card) trail.value = [...trail.value, r.card]
    msg.value = r.msg ?? ''
    if (r.spawn) {
      spawn(r.spawn).catch((e) => {
        msg.value = e instanceof Error ? e.message : String(e)
      })
    }
  } catch (e) {
    msg.value = e instanceof Error ? e.message : String(e)
  }
}

// The Codex login/logout/browser/device ceremony, unchanged and reached when the
// Codex row is the selection inside Configuration. Device login leads because a
// browser on another box cannot reach app-server's localhost callback; neither
// flow shells out or turns a provider URL into an OSC link.
let codexKey = (k: string, control: AccountControl) => {
  let view = control.view.peek()
  if (view.busy) return
  let state = view.status?.state
  let login = state == 'signed_out' || state == 'error' ||
    state == 'unavailable'
  if (k == 'l' && login) control.login('device')
  else if (k == 'b' && login) control.login('browser')
  else if (
    k == 'p' && state == 'pending' && view.status?.login == 'browser'
  ) accountCallback.value = ''
  else if (k == 'c' && state == 'pending') control.cancel()
  else if (k == 'o' && view.status?.ready) control.logout()
  else if (k == 'r') control.read()
}

// The flat, selectable rows the Configuration panel walks: every non-secret
// setting and secret credential in the catalog's group order (settings first,
// then their credentials, so Ollama's URL and key sit together), then the Codex
// account as the last row. TConfig paints this same order, so the cursor index
// and the painted list can never disagree.
type ConfigRow =
  | { kind: 'setting'; row: SettingRow }
  | { kind: 'cred'; status: CredStatus }
  | { kind: 'codex' }

let configRows = (control: ConfigControl): ConfigRow[] => {
  let view = control.view.value
  let groups: string[] = []
  for (let s of settingCatalog) {
    if (!groups.includes(s.group)) groups.push(s.group)
  }
  let out: ConfigRow[] = []
  for (let g of groups) {
    for (let r of (view.settings ?? []).filter((r) => r.group == g)) {
      out.push({ kind: 'setting', row: r })
    }
    for (
      let c of (view.creds ?? []).filter((c) => settingSpec(c.key)?.group == g)
    ) out.push({ kind: 'cred', status: c })
  }
  out.push({ kind: 'codex' })
  return out
}

export let openConfig = (
  control: ConfigControl = configControl,
  codex: AccountControl = codexAccount,
) => {
  accountCallback.value = null
  configEdit.value = null
  configSel.value = 0
  configOpen.value = true
  control.read()
  codex.read()
}

// Closing cancels an owned Codex ceremony and stops the config controller's
// polls — the same courtesy the account dialog paid on close.
export let dismissConfig = (
  control: ConfigControl = configControl,
  codex: AccountControl = codexAccount,
) => {
  accountCallback.value = null
  configEdit.value = null
  configOpen.value = false
  control.close()
  codex.dismiss()
}

// A committed field: a setting rides an ordinary graph write (targeting the
// row's own `setting` eid, which apply() validates); a secret goes to the
// credential store as a local value or an op:// binding — its bytes never echo
// back and never enter the graph.
let commitConfigEdit = (control: ConfigControl) => {
  let e = configEdit.value
  if (!e) return
  let text = e.text
  configEdit.value = null
  if (e.kind == 'setting') control.saveSetting(e.key, text)
  else if (!text.trim()) return
  else if (e.kind == 'op') control.bindCred(e.key, text)
  else control.saveCred(e.key, text)
}

// The panel owns the keyboard while open. A cursor (j/k) walks the rows; the
// selected row's own keys act on it. A field edit or the Codex callback paste
// captures every key while active; Escape or q closes.
export let configKey = (
  k: string,
  control: ConfigControl = configControl,
  codex: AccountControl = codexAccount,
): boolean => {
  if (!configOpen.value) return false

  // The Codex browser callback paste captures every key until it submits or is
  // cancelled. It is masked on paint, so its length never leaks into the panel.
  if (accountCallback.value != null) {
    if (k == '\x1b') accountCallback.value = null
    else if (k == '\r') {
      let callback = accountCallback.value
      accountCallback.value = null
      if (callback) codex.complete(callback)
    } else if (k == '\x7f') {
      accountCallback.value = accountCallback.value.slice(0, -1)
    } else if (k >= ' ' && accountCallback.value.length < 4096) {
      accountCallback.value += k
    }
    return true
  }

  // A field edit owns the keyboard: Escape cancels, Enter commits, the rest
  // types. A secret value is masked only on PAINT — its bytes live here until it
  // is saved and cleared, and reach the wire only as a credential write.
  let e = configEdit.value
  if (e) {
    if (k == '\x1b') configEdit.value = null
    else if (k == '\r') commitConfigEdit(control)
    else if (k == '\x7f') configEdit.value = { ...e, text: e.text.slice(0, -1) }
    else if (k >= ' ') configEdit.value = { ...e, text: e.text + k }
    return true
  }

  let rows = configRows(control)
  let at = Math.max(0, Math.min(configSel.value, rows.length - 1))
  if (k == 'q' || k == '\x1b') {
    dismissConfig(control, codex)
    return true
  }
  if (k == 'j') configSel.value = (at + 1) % rows.length
  else if (k == 'k') configSel.value = (at + rows.length - 1) % rows.length
  else {
    let sel = rows[at]
    if (sel?.kind == 'setting') {
      let row = sel.row
      if (k == 'i' || k == '\r') {
        configEdit.value = {
          kind: 'setting',
          key: row.key,
          text: row.value ?? '',
        }
      } else if (k == 'x' && row.source == 'graph') {
        control.resetSetting(row.key)
      }
    } else if (sel?.kind == 'cred') {
      let key = sel.status.key
      let mode = credBackend.value[key] ?? 'value'
      if (k == 'i' || k == '\r') {
        configEdit.value = { kind: mode, key, text: '' }
      } else if (k == 'm') {
        credBackend.value = {
          ...credBackend.value,
          [key]: mode == 'value' ? 'op' : 'value',
        }
      } else if (k == 'x' && sel.status.state != 'missing') {
        control.resetCred(key)
      } else if (k == 'f') control.refreshCred(key)
      else if (k == 't') control.testCred(key)
    } else if (sel?.kind == 'codex') codexKey(k, codex)
  }
  return true
}

// The favorites for the navigation panel, read through the query door rather
// than a whole-cache scan (T-18099) — the SAME query TNavigation renders with
// `useQuery(navigationQuery)`, so this handler and that list agree on order and
// the pick index lands on the row shown. A key handler is not a render, so we
// read the shared signal's current value; the panel holds the query while it is
// open (this only fires then), and refreshQueries keeps the set live regardless.
let favoriteEids = () =>
  queryEids(resolveRefs(parseQuery(navigationQuery), findEid)).value

export let navigationKey = (
  k: string,
  codex: AccountControl = codexAccount,
  cfg: ConfigControl = configControl,
) => {
  if (!navigationOpen.value) {
    if (mode.value != 'normal' || k != 'n') return false
    help.value = false
    navigationPick.value = 0
    navigationOpen.value = true
    return true
  }
  let favorites = favoriteEids()
  let size = favorites.length + 1 // Configuration is the anchored last row.
  if (k == 'n' || k == 'q' || k == '\x1b' || k == 'h') {
    navigationOpen.value = false
  } else if (k == 'j') {
    navigationPick.value = (navigationPick.value + 1) % size
  } else if (k == 'k') {
    navigationPick.value = (navigationPick.value + size - 1) % size
  } else if (k == 'l' || k == '\r') {
    if (navigationPick.value == favorites.length) {
      navigationOpen.value = false
      openConfig(cfg, codex)
    } else {
      let eid = favorites[navigationPick.value]
      if (eid) trail.value = [...trail.value, eid]
      navigationOpen.value = false
    }
  }
  return true
}

// Raw stdin, one key at a time. Normal mode is vim; : opens the command
// line, which owns every key until Enter or Escape. Ctrl-d backs out of
// the current entity from ANY mode; everything else is per-mode.
export let key = (k: string) => {
  if (configOpen.value) {
    configKey(k)
    return
  }
  if (help.value) {
    if (k == '?' || k == '\x1b' || k == 'q') help.value = false
    return
  }
  if (navigationKey(k)) return
  if (k == '\x04') {
    if (mode.value == 'insert') endEdit() // commit, then out — no data loss
    return back()
  }
  if (mode.value == 'command') {
    if (k == '\r') {
      exec(buf.value)
      buf.value = ''
      mode.value = 'normal'
    } else if (k == '\n') buf.value += '\n' // ⇧⏎ adds a line; ⏎ runs the command
    else if (k == '\x1b') {
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
  } else if (k == '?') help.value = true
  else if (k == 'j') vert(1)
  else if (k == 'k') vert(-1)
  else if (k == 'l') enter()
  else if (k == 'i') startEdit()
  else if (k == '\r') {
    if (enter()) startEdit()
  } else if (k == 'h') back()
  else if (k == '\t') cycle(1)
  else if (k == '\x1b[Z') cycle(-1) // ⇧⇥, delivered whole by the key loop
  else if (k == 'y') yank()
  else if (k == 'q' || k == '\x03') quit.value = true
  else if (k == '\x1b') msg.value = ''
}

export let TKeys = () => (
  <div class='TKeys'>
    <div class='TKeys_Title'>Keybindings</div>
    {tuiKeys.map((binding) => (
      <div class='TKeys_Row' key={binding.keys.join('-')}>
        <span class='TKeys_Key'>{binding.keys.join(' / ')}</span>
        <span>{binding.about}</span>
      </div>
    ))}
    <div class='TKeys_Hint'>press ? or Esc to close</div>
  </div>
)

export let TNavigation = () => {
  let favorites = useQuery(navigationQuery)
  let pick = Math.min(navigationPick.value, favorites.length)
  return (
    <div class='TNavigation'>
      <div class='TNavigation_Title'>Navigation</div>
      {favorites.map((e, i) => (
        <div
          class={`TNavigation_Row${i == pick ? ' TNavigation_Row-on' : ''}`}
          key={e.eid}
        >
          <Entity eid={e.eid} view={navigationView} />
        </div>
      ))}
      {!favorites.length && (
        <div class='TNavigation_Empty'>No favorites yet.</div>
      )}
      <div
        class={`TNavigation_Account${
          pick == favorites.length ? ' TNavigation_Account-on' : ''
        }`}
      >
        Configuration
      </div>
      <div class='TNavigation_Hint'>
        j/k choose · l/Enter open · n/Esc close
      </div>
    </div>
  )
}

export let TAccount = (
  { view = codexAccount.view.value, on = false }: {
    view?: AccountView
    on?: boolean
  },
) => {
  let status = view.status
  let busy = view.busy
  let state = busy == 'login'
    ? 'asking Codex to start login…'
    : busy == 'complete'
    ? 'delivering the callback and checking the Codex account…'
    : busy == 'cancel'
    ? 'asking Codex to cancel login…'
    : busy == 'logout'
    ? 'asking Codex to sign out…'
    : busy == 'read'
    ? 'checking Codex account status…'
    : status?.ready
    ? 'ready'
    : status?.state == 'pending'
    ? `${status.login ?? 'Codex'} login pending`
    : status?.state == 'error'
    ? 'last login failed'
    : status?.state.replace('_', ' ') ?? 'not checked'
  let error = view.error ?? status?.error
  let ceremony = view.ceremony
  let login = !busy && status &&
    ['signed_out', 'error', 'unavailable'].includes(status.state)
  return (
    <div class='TAccount'>
      <div class={on ? 'TAccount_Title TAccount_Title-on' : 'TAccount_Title'}>
        Codex account
      </div>
      <div
        class={`TAccount_State TAccount_State-${status?.state ?? 'unknown'}`}
      >
        {state}
      </div>
      {status?.ready && (
        <div class='TAccount_Detail'>
          {status.auth == 'chatgpt' ? 'ChatGPT' : 'API key'}
          {status.plan && ` · ${status.plan}`}
        </div>
      )}
      {error && <div class='TAccount_Error'>{error.code} — {error.message}
      </div>}
      {ceremony?.method == 'device' && (
        <div class='TAccount_Ceremony'>
          <span class='TAccount_Url'>{ceremony.verificationUrl}</span>
          <span class='TAccount_Code'>{ceremony.userCode}</span>
          <div class='TAccount_Hint'>enter the code in the page above</div>
          <div class='TAccount_Hint'>
            device login must be enabled in ChatGPT settings or workspace
            permissions
          </div>
        </div>
      )}
      {ceremony?.method == 'browser' && (
        <div class='TAccount_Ceremony'>
          <span class='TAccount_Url'>{ceremony.authorizationUrl}</span>
          <div class='TAccount_Hint'>
            paste the localhost callback when this daemon is remote
          </div>
        </div>
      )}
      {status?.state == 'pending' && !ceremony && (
        <div class='TAccount_Hint'>login began in another Tasks client</div>
      )}
      {accountCallback.value != null && (
        <div class='TAccount_Input'>
          paste callback URL:{' '}
          {'•'.repeat(Math.min(accountCallback.value.length, 32))}█
          <div class='TAccount_Hint'>Enter submit · Esc cancel input</div>
        </div>
      )}
      <div class='TAccount_Actions'>
        {login && (
          <>
            <span class='TAccount_Key'>l</span> device login ·{' '}
            <span class='TAccount_Key'>b</span> browser login
          </>
        )}
        {!busy && status?.state == 'pending' && (
          <>
            {status.login == 'browser' && (
              <>
                <span class='TAccount_Key'>p</span> paste callback ·{' '}
              </>
            )}
            <span class='TAccount_Key'>c</span> cancel login
          </>
        )}
        {!busy && status?.ready && (
          <>
            <span class='TAccount_Key'>o</span> log out
          </>
        )}
        {status && (
          <>
            · <span class='TAccount_Key'>r</span> refresh
          </>
        )}
      </div>
      <div class='TAccount_Hint'>j/k move · q / Esc close</div>
    </div>
  )
}

// The Configuration panel, painted as terminal lines: the same shape the web
// panel has (Config.tsx) over the same controllers. A non-secret setting shows
// its effective value and which plane answered, edited through an ordinary graph
// write; a secret shows only its STATE and backend, never a value; the Codex
// ceremony rides along as the last section. The selected row is inverse (the
// terminal cursor is hidden, so the bar is the only mark of where j/k are), and
// its keys are named beneath it.
let sourceText = (source: SettingRow['source']) =>
  source == 'graph'
    ? 'saved here'
    : source == 'environment'
    ? 'from environment'
    : 'default'

let credStateText = (status: CredStatus) =>
  status.state == 'configured'
    ? `configured${status.source ? ` · ${status.source}` : ''}`
    : status.state == 'unavailable'
    ? 'unavailable'
    : 'not configured'

let groupOf = (item: ConfigRow): string =>
  item.kind == 'setting'
    ? item.row.group
    : item.kind == 'cred'
    ? settingSpec(item.status.key)?.group ?? ''
    : 'Codex account'

export let TConfig = (
  { control = configControl, codex = codexAccount }: {
    control?: ConfigControl
    codex?: AccountControl
  },
) => {
  let view = control.view.value
  let rows = configRows(control)
  let at = Math.max(0, Math.min(configSel.value, rows.length - 1))
  let e = configEdit.value

  // The draft on its own line while editing: a secret VALUE shows dots (never
  // its bytes, and the count is capped so a long paste can't be measured); a
  // setting draft and an op:// reference are plain — neither is a secret.
  let editLine = (label: string, mask: boolean) => (
    <div class='TConfig_Edit'>
      <span>
        {`${label}: ${
          mask ? '•'.repeat(Math.min(e!.text.length, 32)) : e!.text
        }█`}
      </span>
      <span class='TConfig_Hint'>· Enter save · Esc cancel</span>
    </div>
  )

  return (
    <div class='TConfig'>
      <div class='TConfig_Title'>Configuration</div>
      {view.error && <div class='TConfig_Error'>{view.error}</div>}
      {rows.map((item, i) => {
        let on = i == at
        if (item.kind == 'codex') {
          return <TAccount key='codex' view={codex.view.value} on={on} />
        }
        let key = item.kind == 'setting' ? item.row.key : item.status.key
        let header = groupOf(item) != (i > 0 ? groupOf(rows[i - 1]) : null)
        let editing = !!e && e.key == key
        let error = view.rowError[key]
        return (
          <div key={key}>
            {header && <div class='TConfig_Group'>{groupOf(item)}</div>}
            {item.kind == 'setting'
              ? (
                <>
                  <div
                    class={on ? 'TConfig_Row TConfig_Row-on' : 'TConfig_Row'}
                  >
                    <span class='TConfig_Label'>{`${item.row.label}: `}</span>
                    <span class='TConfig_Value'>
                      {item.row.value ?? '(unset)'}
                    </span>
                    <span
                      class={`TConfig_Source TConfig_Source-${item.row.source}`}
                    >
                      {` [${sourceText(item.row.source)}]`}
                    </span>
                  </div>
                  {editing && editLine('value', false)}
                  {on && !editing && (
                    <div class='TConfig_Help'>{item.row.help}</div>
                  )}
                  {on && !editing && (
                    <div class='TConfig_Hint'>
                      i set{item.row.source == 'graph'
                        ? ' · x reset to default'
                        : ''}
                    </div>
                  )}
                  {error && <div class='TConfig_Error'>{error}</div>}
                </>
              )
              : (
                <>
                  <div
                    class={on ? 'TConfig_Row TConfig_Row-on' : 'TConfig_Row'}
                  >
                    <span class='TConfig_Label'>
                      {`${
                        settingSpec(item.status.key)?.label ?? item.status.key
                      }: `}
                    </span>
                    <span
                      class={`TConfig_State TConfig_State-${item.status.state}`}
                    >
                      {credStateText(item.status)}
                    </span>
                  </div>
                  {item.status.detail && (
                    <div class='TConfig_Error'>{item.status.detail}</div>
                  )}
                  {editing &&
                    editLine(
                      (credBackend.value[item.status.key] ?? 'value') == 'op'
                        ? 'op reference'
                        : 'secret',
                      (credBackend.value[item.status.key] ?? 'value') ==
                        'value',
                    )}
                  {on && !editing && settingSpec(item.status.key)?.help && (
                    <div class='TConfig_Help'>
                      {settingSpec(item.status.key)!.help}
                    </div>
                  )}
                  {on && !editing && (
                    <div class='TConfig_Hint'>
                      i set · m backend ({(credBackend.value[item.status.key] ??
                          'value') == 'op'
                        ? '1Password op://'
                        : 'secret value'}){item.status.state != 'missing'
                        ? ' · x reset'
                        : ''} · f refresh · t test
                    </div>
                  )}
                  {error && <div class='TConfig_Error'>{error}</div>}
                </>
              )}
          </div>
        )
      })}
      <div class='TConfig_Hint'>j/k choose · q / Esc close</div>
    </div>
  )
}

export let TStatus = () => {
  // the verb greens once it names a command — the web bar does the same
  let [, pre, verb, rest] = buf.value.match(/^(\s*)(\S+)(.*)$/s) ?? []
  // A ⇧⏎ newline lives in the buffer (commands read a first-line/body split),
  // but the command line is one painted row — show each break as a glyph so it
  // stays on that row instead of splitting the pane.
  let nl = (t: string) => t.replaceAll('\n', '⏎')
  return (
    <footer class='TStatus'>
      {mode.value == 'command'
        ? (
          <span class='TStatus_Cmd'>
            :{verb
              ? (
                <>
                  {nl(pre)}
                  {(commands[verb] ?? local[verb])
                    ? <span class='TStatus_Verb'>{verb}</span>
                    : verb}
                  {nl(rest)}
                </>
              )
              : nl(buf.value)}█
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
              j/k browse · l in · h out · ⇥ view · i edit · y yank · : cmd · q
              quit · ? keys
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
    // the view rides the breadcrumb when it isn't the one the pane would
    // paint anyway, the way `?v=` rides the URL — otherwise there is no
    // way to tell which of two look-alike panes you are on
    ...trail.value.map((eid) => {
      let e = ent(eid)
      let v = views.value[eid]
      return idOf(e) + (v && v != resolve(e).view ? ` · ${v}` : '')
    }),
  ]
  return (
    <div class='TApp'>
      <div class='TTitle'>{['tasks', ...crumbs].join(' · ')}</div>
      {configOpen.value
        ? <TConfig />
        : help.value
        ? <TKeys />
        : navigationOpen.value
        ? <TNavigation />
        : here
        ? <Entity eid={here} view={views.value[here]} />
        : p && (
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

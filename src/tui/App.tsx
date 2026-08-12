// The TUI app: browse the first board with vim keys. Everything
// below this file is shared with the web — same cache, same registry, same
// mode signal. Only Board and the task Full are overridden (columns become
// a nested list, the body reads as raw markdown); Dot, Id, Dependency and
// Debug.Tile render through the very same components the browser uses,
// painted as lines instead of CSS.
import { signal } from '@preact/signals'
import { useBoardSub } from '../components/subscriptions.ts'
import { tuiKeys } from '../keybindings.ts'
import { formatProp, propAt } from '../props.ts'
import { type Ent, idOf, verdictName } from '../types.ts'
import {
  applyLocal,
  boardTasks,
  byPriority,
  cache,
  commentsOn,
  crewed,
  ent,
  gated,
  mode,
  mutate,
  pending,
  problem,
  repoUrl,
  rows as graph,
  send,
  statuses,
  uuid,
} from '../live.ts'
import { type Command, commands, type Ctx, run } from '../commands.ts'
import { inflate } from '../client.ts'
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
import { catalog } from '../providers.ts'
import { choose, load, providers } from '../components/Run.tsx'

export let sel = signal({ col: 0, row: 0 })
export let quit = signal(false)
let msg = signal('')
let buf = signal('') // the : command line
export let help = signal(false)
export let accountOpen = signal(false)
export let accountCallback = signal<string | null>(null)
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
    {commentsOn(e.eid).map((c) => (
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
  args: '',
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
let spawn = async (task: string) => {
  if (!providers.value.length) await load()
  let m = catalog(providers.value)[0]
  if (!m) throw new Error('no providers')
  let provider = await choose(m)
  mutate({
    eid: uuid(),
    name: 'session',
    comp: {
      id: uuid(),
      provider,
      model: m.model,
      ...(m.efforts.length
        ? { effort: m.efforts.includes('medium') ? 'medium' : m.efforts[0] }
        : {}),
      requested_task: task,
    },
  })
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

// The account panel is terminal-native: keys are its buttons. Device login
// leads because a browser on another box cannot reach app-server's localhost
// callback; neither flow shells out or turns provider URLs into OSC links.
export let accountKey = (
  k: string,
  control: AccountControl = codexAccount,
) => {
  if (!accountOpen.value) {
    if (mode.value != 'normal' || k != 'a') return false
    help.value = false
    accountCallback.value = null
    accountOpen.value = true
    control.read()
    return true
  }
  if (accountCallback.value != null) {
    if (k == '\x1b') accountCallback.value = null
    else if (k == '\r') {
      let callback = accountCallback.value
      accountCallback.value = null
      if (callback) control.complete(callback)
    } else if (k == '\x7f') {
      accountCallback.value = accountCallback.value.slice(0, -1)
    } else if (k >= ' ' && accountCallback.value.length < 4096) {
      accountCallback.value += k
    }
    return true
  }
  if (k == 'a' || k == 'q' || k == '\x1b') {
    accountCallback.value = null
    accountOpen.value = false
    control.dismiss()
    return true
  }
  let view = control.view.peek()
  if (view.busy) return true
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
  return true
}

// Raw stdin, one key at a time. Normal mode is vim; : opens the command
// line, which owns every key until Enter or Escape. Ctrl-d backs out of
// the current entity from ANY mode; everything else is per-mode.
export let key = (k: string) => {
  if (accountOpen.value) {
    accountKey(k)
    return
  }
  if (help.value) {
    if (k == '?' || k == '\x1b' || k == 'q') help.value = false
    return
  }
  if (accountKey(k)) return
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

export let TAccount = (
  { view = codexAccount.view.value }: { view?: AccountView },
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
      <div class='TAccount_Title'>Codex account</div>
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
      <div class='TAccount_Hint'>a / q / Esc close</div>
    </div>
  )
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
      {accountOpen.value
        ? <TAccount />
        : help.value
        ? <TKeys />
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

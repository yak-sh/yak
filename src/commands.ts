// The `:` command line's grammar — one vocabulary for both faces. A verb
// is a pure function from (line, context) to INTENT: changes to land, an
// entity to open, a line for the status bar. Nothing here touches the
// wire, a signal, or a DOM — Status.tsx and the TUI run the result through
// mutate()/navigate — which is why every verb below is a table test.
//
//   :new <title>     a task where you're standing (a board's query rides
//                    along, so it lands ON the board you made it on)
//   :done :wip       status moves on the focused entity
//   :open            …and back to open — but
//   :open T-42       an ARGUMENT means navigate. Shape is the whole rule.
//   :claim [session] lease the focused entity
//   :set .prop=v …   the write grammar (client.ts param); a value rides
//                    the door's own convention (Ctx.read) — @file and @-
//                    where the door has a filesystem, literal elsewhere
//
// A bad command throws; the bar shows the message, exactly as a malformed
// board query does (query.ts). Platform-local verbs (the TUI's :q, the
// web's :zoom) ride in run()'s `local` table — the shared list is the
// language both faces speak, and each adds only what the other can't do.
import { type Change, idOf, uuid } from './types.ts'
import {
  cascade,
  claimChanges,
  commentChanges,
  derefChanges,
  DESK,
  dreamChanges,
  find,
  mailChanges,
  need,
  type Param,
  param,
  patches,
  replyChanges,
  type Row,
  spawnChanges,
  spec,
  type Stdin,
  taskChanges,
} from './client.ts'
import { adopt, parseQuery } from './query.ts'
import { instant } from './time.ts'
import { type Arg, id, slotsOf, text } from './verb.ts'

// A `:` command's argument, built terse: `a('id', 'T-42', { kind: id })`. The
// default kind is free text; `eg` is the concrete sample the palette ghosts,
// `need: false` marks it optional, `rest: true` a trailing catch-all. The
// slots ARE the ghost — one per typed word — replacing the old prose regex.
let a = (name: string, eg?: string, opts: Partial<Arg> = {}): Arg => ({
  name,
  kind: text,
  ...(eg ? { eg } : {}),
  ...opts,
})

// Where the typist is standing: the focused entity (the web's root card,
// the TUI's trail head), the graph to resolve names against, and the
// session speaking — a browser has none, so :claim must name one there.
//
// `read` is the door's VALUE convention for a dot-param — client.ts
// inflate(), so `.body=@file` is the file and `.body=@-` is stdin, the
// same reading `task set` and `task new` give it. It rides the context
// because it is a fact about the door, not about the verb: this module
// touches no filesystem, so the doors that HAVE one (the shell, the TUI)
// hand it in and the doors that don't (the web bar, MCP over /mcp) leave
// it absent and every value stays literal. Reading a path named by an
// MCP caller would be the SERVER's filesystem, so that door stays shut.
export type Ctx = {
  eid?: string
  rows: Row[]
  session?: string
  // `as` is the token the typist actually reached for — an error must
  // never name `.body=` at a door where the body is bare words.
  read?: (p: Param, io?: Stdin, as?: string) => Param
}

export type Result = {
  changes?: Change[]
  go?: string // an eid to open — the platform picks the form (url, trail)
  card?: string // a minted entity to place on a canvas, or open elsewhere
  spawn?: string | SpawnIntent // a launch platforms spend with their catalog
  msg?: string
}

export type SpawnIntent = {
  prompt?: string
  provider?: string
  model?: string
  effort?: string
  persona?: string
}

export let spawnTask = (spawn: Result['spawn']) =>
  typeof spawn == 'string' ? spawn : undefined

export let spawnSpec = (
  spawn: NonNullable<Result['spawn']>,
): SpawnIntent & { task?: string } =>
  typeof spawn == 'string' ? { task: spawn } : spawn

export type Verb = (rest: string, ctx: Ctx) => Result

// Where a HEADLESS caller stands: its session's single claim. The shell
// door resolves focus through this — one lease is an unambiguous
// "here"; none or several mean the line must lead with an id.
export let focusOf = (rows: Row[], session?: string): string | undefined => {
  if (!session) return undefined
  let me = rows.find((r) => String(r.comps.session?.id ?? '') == session)
  if (!me) return undefined
  let mine = rows.filter((r) => r.comps.claim?.session == me.eid)
  return mine.length == 1 ? mine[0].eid : undefined
}

let here = (ctx: Ctx): Row => {
  let r = ctx.rows.find((x) => x.eid == ctx.eid)
  if (!r) throw new Error('nothing focused')
  return r
}

// A letter's page, through the door's own @ convention (T-10461). `read`
// is the same seam the dot-params use, so a door with no filesystem —
// the web bar, MCP — leaves it absent and every page stays literal. It
// reads only when the page IS a reference: one token, no whitespace, so
// prose that opens `@someone` keeps its words either way. @@ escapes,
// and a missing file throws before the mail is minted.
let page = (body: string, ctx: Ctx) =>
  ctx.read && /^@\S+$/.test(body)
    ? String(
      ctx.read({ comp: 'doc', prop: 'body', value: body }, undefined, body)
        .value,
    )
    : body

let move = (status: string): Verb => (_rest, ctx) => {
  let r = here(ctx)
  if (!r.comps.task) throw new Error(`${idOf(r)} is not a task`)
  return {
    changes: [{ eid: r.eid, name: 'task', comp: { status } }],
    msg: `${idOf(r)} → ${status}`,
  }
}
let reopen = move('open')

let go = (id: string, ctx: Ctx): Result => {
  let r = find(ctx.rows, id)
  if (!r) throw new Error(`no such entity: ${id}`)
  return { go: r.eid }
}

// What a new task inherits from where you're standing: a board hands over
// its query's scalar equalities — the same adopt() a board drop uses, so
// the task JOINS the board — a project hands over itself, and a task the
// project it belongs to.
let inherit = (ctx: Ctx): Record<string, unknown> => {
  let r = ctx.rows.find((x) => x.eid == ctx.eid)
  if (!r) return {}
  if (r.comps.board) {
    return adopt(parseQuery(String(r.comps.board.query ?? '')), 'task')
  }
  if (r.comps.project) return { project: r.eid }
  let p = r.comps.task?.project
  return p ? { project: p } : {}
}

// :delete tombstones the focused entity — or the one the line names. The one
// warm verb that REMOVES, so the graph can shrink and not only grow. Death
// CASCADES (db.ts apply()): comments aimed at it, cards and knocks/wakes
// viewing it die with it. A leaf goes quietly; a target with dependents
// REFUSES without --cascade, naming what it would take, so the blast radius is
// never a surprise. `:forget` is the same verb, said the way a memory wants to
// hear it. This pass sees only the rows in hand (a palette is wire-free); the
// shell's `task delete` queries the graph for the authoritative set.
let del: Verb = (rest, ctx) => {
  let words = rest.trim().split(/\s+/).filter(Boolean)
  let ok = words.some((w) => w == '--cascade' || w == '--force')
  let named = words.find((w) => !w.startsWith('--'))
  let r = named ? need(ctx.rows, named) : here(ctx)
  let victims = cascade(ctx.rows, r.eid)
  if (victims.length && !ok) {
    throw new Error(
      `${idOf(r)} would also delete ${victims.length} dependent${
        victims.length == 1 ? '' : 's'
      } (${victims.map(idOf).join(', ')}) — add --cascade to take them too`,
    )
  }
  return {
    changes: [{ eid: r.eid, name: 'entity', comp: null }],
    msg: `deleted ${idOf(r)}${
      victims.length
        ? ` (+${victims.length} dependent${victims.length == 1 ? '' : 's'})`
        : ''
    }`,
  }
}

// A command carries its own manual and any finite word count, so every
// renderer and dispatcher shares both the prompt and the refusal.
export type Command = {
  // The positional slots, as data — usage renders `<name>` from each, the
  // palette ghosts `eg ?? name` (one slot per typed word). Was an example
  // string the ghost recovered by regex; now the slots are given (T-12929).
  args: Arg[]
  about: string
  run: Verb
  words?: [min: number, max: number]
  // This verb reads dot-params (`.prop=value`) — the write/spec commands
  // (new/fix/set, the card mints, chat). Every other colon verb takes
  // positional words, so an unknown dot-param at it is a mistake to refuse by
  // name, not text to absorb (T-14291) — the same guard the CLI verbs carry.
  dots?: boolean
}

// Blank cards are the canvas's scratch paper: mint the smallest sound entity
// and let its own title/editor take the next words. Curated on purpose — most
// components are facets or machinery, not things that stand alone.
export let cardCommands = ['task', 'session', 'doc', 'memory'] as const

let readParams = (args: string[], ctx: Ctx) => {
  let read = ctx.read ?? ((p: Param) => p)
  return args.map((arg) => {
    let p = param(arg)
    if (!p) throw new Error(`not a param: ${arg}`)
    return read(p)
  })
}

// A session card is a continuation recipe, not a copy of the run. Only the
// configuration that makes another run usable rides forward; pid, transcript,
// status, and the other lifecycle facts belong to the session that earned
// them. The focused session is what a browser can name, while headless doors
// name their calling session in the context.
let sessionDefaults = (ctx: Ctx) => {
  let source = ctx.rows.find((r) => r.eid == ctx.eid && r.comps.session) ??
    ctx.rows.find((r) =>
      String(r.comps.session?.id ?? '') == String(ctx.session ?? '')
    )
  let session = source?.comps.session
  if (!session) return {}
  let keys = [
    'cwd',
    'provider',
    'model',
    'effort',
    'requested_task',
    'role',
    'persona',
    'actor',
  ]
  return Object.fromEntries(
    keys.filter((key) => session[key] != null).map((
      key,
    ) => [key, session[key]]),
  )
}

let card = (kind: typeof cardCommands[number]): Command => ({
  args: [a(
    kind == 'task' ? 'title' : 'params',
    {
      task: 'P1 .domain=Eng title…',
      session: '.id=review',
      doc: '.title=Notes .body=…',
      memory: '.title=Lesson .memory.scope=home',
    }[kind],
    { rest: true, need: false },
  )],
  about: `add a ${kind} card`,
  dots: true,
  run: (rest, ctx) => {
    let [line, ...lines] = rest.split('\n')
    // A leading doc setter is the card property's explicit spelling; its
    // value may contain spaces. Otherwise a task speaks the typed-task
    // grammar: first line title, following lines body.
    let explicit = kind == 'task' && /^\s*\./.test(line) &&
      /(?:^|\s)\.(?:doc\.)?(?:title|body)=/.test(line)
    let typed = kind == 'task' && !explicit ? spec(rest, ctx.read) : undefined
    let text = kind == 'task' && explicit ? line : rest.trim()
    let args = typed || !text ? [] : text.split(/\s+(?=\.)/)
    let ps = readParams(args, ctx)
    let grouped = typed?.grouped ?? patches(ps)
    let allowed = kind == 'task'
      ? ['doc', 'task']
      : kind == 'memory'
      ? ['doc', 'memory']
      : [kind]
    for (let p of ps) {
      if (!allowed.includes(p.comp)) {
        throw new Error(`${kind}: cannot set ${p.comp}.${p.prop}`)
      }
    }
    for (let name of Object.keys(typed?.grouped ?? {})) {
      if (!allowed.includes(name)) {
        throw new Error(`${kind}: cannot set ${name}`)
      }
    }
    let eid = uuid()
    let changes: Change[] = kind == 'session'
      ? [{
        eid,
        name: 'session',
        comp: { id: uuid(), ...sessionDefaults(ctx), ...grouped.session },
      }]
      : [
        {
          eid,
          name: 'doc',
          comp: {
            title: typed?.title ?? '',
            body: typed?.body ?? (explicit ? lines.join('\n').trim() : ''),
            ...grouped.doc,
          },
        },
        ...(kind == 'doc' ? [] : [{
          eid,
          name: kind,
          comp: kind == 'task'
            ? { status: 'open', ...grouped.task }
            : { scope: null, ...grouped.memory },
        }]),
      ]
    return { changes, card: eid, msg: `new ${kind}` }
  },
})

export let commands: Record<string, Command> = {
  // :new speaks the spec grammar (client.ts): 'P1 .domain=Eng Ship it'
  // — typed setters win over what the context hands down.
  new: {
    dots: true,
    args: [a('title', 'P1 .domain=Eng title…', { rest: true })],
    about: 'file a task where you stand',
    run: (rest, ctx) => {
      let { title, body, grouped } = spec(rest, ctx.read)
      if (!title) throw new Error('new: needs a title')
      return {
        changes: taskChanges(uuid(), {
          ...grouped,
          doc: { title, body, ...grouped.doc },
          task: { ...inherit(ctx), ...grouped.task },
        }),
        msg: `new: ${title}`,
      }
    },
  },
  open: {
    args: [a('id', 'T-42', { kind: id, need: false })],
    about: 'reopen the task — or go to T-42',
    words: [0, 1],
    run: (rest, ctx) => rest.trim() ? go(rest.trim(), ctx) : reopen(rest, ctx),
  },
  // :fix is capture-to-agent in one line: a bare id runs an agent on
  // that task; anything else is a spec line that FILES the task first.
  // A fix without a named task is a fix for the TOOL you're typing into
  // — whatever card you're looking at — so it routes to the deployment's
  // own project (venture alias `tasks`; the sole repo-bearing project when no
  // alias stands). Explicit .project= always wins. The spawn is an
  // INTENT like go: this module never touches the wire.
  fix: {
    dots: true,
    args: [a('task', 'T-42 | the toolbar clips at small widths', {
      rest: true,
      need: false,
    })],
    about: 'run a fix agent — here, on T-42, or on a task your words file',
    run: (rest, ctx) => {
      let text = rest.trim()
      // Bare :fix means HERE — said on a task's card (or in its
      // comments, once those run commands), the target is understood.
      if (!text) {
        let r = here(ctx)
        if (!r.comps.task) throw new Error(`${idOf(r)} is not a task`)
        return { spawn: r.eid, msg: `${idOf(r)} → agent` }
      }
      if (/^[A-Za-z]+-\d+$/.test(text)) {
        let r = find(ctx.rows, text)
        if (!r?.comps.task) throw new Error(`no such task: ${text}`)
        return { spawn: r.eid, msg: `${idOf(r)} → agent` }
      }
      let { title, body, grouped } = spec(text, ctx.read)
      if (!title) throw new Error('fix: needs a title')
      let task = { ...grouped.task }
      if (!task.project) {
        let tasks = find(ctx.rows, 'tasks')
        if (tasks?.comps.project) task.project = tasks.eid
        else {
          let repos = ctx.rows.filter((r) => r.comps.repo && r.comps.project)
          if (repos.length == 1) task.project = repos[0].eid
        }
      }
      let eid = uuid()
      return {
        changes: taskChanges(eid, {
          ...grouped,
          doc: { title, body, ...grouped.doc },
          task,
        }),
        spawn: eid,
        msg: `fix: ${title}`,
      }
    },
  },
  chat: {
    dots: true,
    args: [a('prompt', '.provider=codex .model=gpt-5.6-sol prompt…', {
      rest: true,
      need: false,
    })],
    about: 'start a taskless chat in the tray',
    run: (rest, ctx) => {
      let { title, body, grouped } = spec(rest, ctx.read)
      for (let name of Object.keys(grouped)) {
        if (!['doc', 'session', 'spawn'].includes(name)) {
          throw new Error(`chat: cannot set ${name}`)
        }
      }
      for (let name of Object.keys(grouped.session ?? {})) {
        if (!['provider', 'model', 'effort', 'persona'].includes(name)) {
          throw new Error(`chat: cannot set session.${name}`)
        }
      }
      let prompt = [title, body].filter(Boolean).join('\n')
      let launch: SpawnIntent = { ...grouped.session, ...grouped.spawn }
      if (launch.persona) {
        let persona = find(ctx.rows, launch.persona)
        if (!persona) throw new Error(`no entity: ${launch.persona}`)
        launch.persona = persona.eid
      }
      return {
        spawn: {
          ...(prompt ? { prompt } : {}),
          ...launch,
        },
        msg: 'chat → agent',
      }
    },
  },
  done: {
    args: [],
    about:
      'move the focused task to done (shell: `task done T-3 [comment]` names one explicitly)',
    words: [0, 0],
    run: move('done'),
  },
  wip: {
    args: [],
    about: 'move the focused task to wip',
    words: [0, 0],
    run: move('wip'),
  },
  cancel: {
    args: [a('reason', 'reason', { rest: true, need: false })],
    about: 'call off the focused task; the words become a comment ' +
      '(shell: `task cancel T-3 [reason]` names one explicitly)',
    run: (rest, ctx) => {
      let r = here(ctx)
      if (!r.comps.task) throw new Error(`${idOf(r)} is not a task`)
      let reason = rest.trim()
      return {
        changes: [
          { eid: r.eid, name: 'task', comp: { status: 'cancelled' } },
          // the why rides the same atomic batch — as plain commentary,
          // never a machine trail (the journal records the change)
          ...(reason
            ? commentChanges(ctx.rows, r.eid, reason, ctx.session)
            : []),
        ],
        msg: `${idOf(r)} → cancelled${reason ? ` — ${reason}` : ''}`,
      }
    },
  },
  // :meta leaves a quiet transcript memo — a comment TAGGED `meta`, anchored
  // at the caller session's newest MESSAGE entry, for the dream (T-12800) to
  // harvest at consolidation. The tag is the whole point: channel.ts excludes
  // a meta comment from live delivery, so the note never knocks the doer —
  // read later, never injected live (contrast a bare comment on a session,
  // which IS a live message to that agent). A fresh session with no message
  // yet anchors on the session entity, so a memo never fails for want of a
  // transcript position.
  meta: {
    args: [a('observation', 'the observation to leave for the dream', {
      rest: true,
    })],
    about:
      'leave a quiet meta memo in the transcript (harvested by the dream, not live)',
    run: (rest, ctx) => {
      let text = page(rest.trim(), ctx)
      if (!text) throw new Error('meta: needs words (:meta the observation)')
      let me = ctx.rows.find(
        (r) => String(r.comps.session?.id ?? '') == ctx.session,
      )
      if (!me) throw new Error('meta: run under a session')
      let anchor = ctx.rows
        .filter((r) => r.comps.entry?.session == me.eid && r.comps.message)
        .sort((a, b) =>
          Number(a.comps.entry!.seq ?? 0) - Number(b.comps.entry!.seq ?? 0)
        )
        .at(-1) ?? me
      let made = commentChanges(ctx.rows, anchor.eid, text, ctx.session)
      let eid = made.find((c) => c.name == 'comment')!.eid
      return {
        changes: [...made, { eid, name: 'meta', comp: {} }],
        msg: `meta → ${idOf(anchor)}`,
      }
    },
  },
  // :dream starts a venture's consolidation cycle (T-12800) — mint the
  // per-venture `dream` cursor and arm its first cadence wake. A named project
  // wins; otherwise the focused entity, which must be a project. Idempotent: a
  // second dream on the same venture is refused by dreamChanges.
  dream: {
    args: [a('project', 'P-19', { kind: id, need: false })],
    about: 'start a venture dreaming — the graph-native consolidation cycle',
    run: (rest, ctx) => {
      let first = rest.trim().split(/\s+/).filter(Boolean)[0]
      let r = first ? find(ctx.rows, first) : here(ctx)
      if (!r) throw new Error(`dream: no such project: ${first}`)
      let made = dreamChanges(ctx.rows, { project: r.eid })
      return { changes: made.changes, msg: `dreaming ${idOf(r)}` }
    },
  },
  // :knock is the attention lever: bring the focused entity to someone's
  // attention NOW. The first word IS the recipient (alias, id) and must
  // resolve; the rest ride as a plain comment on the target — the knock
  // artifact itself never carries prose. Delivery is the server's
  // ladder (knock.ts); the stamp on the K-entity says what happened.
  //
  // A BARE `:knock` still asks the entity's own project — no word was
  // said, so nothing can be mistaken. But a first word that fails to
  // resolve used to fall through to that same default while folding the
  // word into the BODY (T-10905), and nothing looked wrong: the receipt
  // read `→ knock project`, delivery happened, an operator woke — and the
  // message they read opened with a stray token while the recipient it
  // named was never asked. Those two cases are indistinguishable from the
  // inside, so any word given must NAME someone: an unresolved address
  // must never become content. `:wake`, the same sentence with a clock,
  // has always refused an unresolvable first word — the siblings agree now.
  knock: {
    args: [
      a('to', 'homelab', { kind: id, need: false }),
      a('words', 'need the key today', { rest: true, need: false }),
    ],
    about: "someone's attention, now — on the focused entity",
    run: (rest, ctx) => {
      let r = here(ctx)
      let [first, ...more] = rest.trim().split(/\s+/).filter(Boolean)
      let to = first ? find(ctx.rows, first) : undefined
      if (first && !to) {
        throw new Error(
          `knock: no such recipient: ${first} — name an alias or id ` +
            `(:knock homelab …, :knock P-19 …)`,
        )
      }
      let words = more.filter(Boolean).join(' ')
      let toEid = to?.eid ?? (r.comps.task?.project as string | undefined)
      if (!toEid) {
        throw new Error('knock: name a recipient (:knock homelab …)')
      }
      let k = uuid()
      return {
        changes: [
          { eid: k, name: 'knock', comp: { target: r.eid } },
          { eid: k, name: 'deliver', comp: { to: toEid } },
          ...(words ? commentChanges(ctx.rows, r.eid, words, ctx.session) : []),
        ],
        msg: `${idOf(r)} → knock ${to ? first : 'project'}`,
      }
    },
  },
  // :wake is :knock with a clock: the same sentence, said later. First
  // word is who; the rest is WHEN ('in 60m', 'after 8 hours', '9am
  // tomorrow', an ISO stamp) — unless its last word names an entity,
  // which is what to look at (else: where you stand). The phrase
  // resolves HERE, at mint, and the line says the moment it landed on,
  // so a time already past is visible rather than a silent knock now.
  wake: {
    args: [
      a('to', 'homelab', { kind: id }),
      a('when', 'in 60m'),
      a('target', 'T-42', { kind: id, need: false }),
      a('note', '-- what I was mid-doing', { rest: true, need: false }),
    ],
    about: 'a knock on a timer — wake someone at a time, with an optional note',
    run: (rest, ctx) => {
      // `-- note` folds a note onto the wake (like :mail's `-- body`): what the
      // setter was mid-doing, relayed into the knock's words when it fires so a
      // resumed session reconstitutes. The head before it is the ordinary
      // who / when / target sentence.
      let m = rest.match(/^([\s\S]*?)\s+--\s+([\s\S]+)$/)
      let head = m ? m[1] : rest
      let note = m ? m[2].trim() : ''
      let words = head.trim().split(/\s+/).filter(Boolean)
      let to = words[0] ? find(ctx.rows, words[0]) : undefined
      // A present-but-unresolved first word is a lookup miss, not a missing
      // argument — say so (the sibling of knock's "no such recipient"), so the
      // reader isn't sent hunting for a syntax error that isn't there (T-13972).
      if (words[0] && !to) {
        throw new Error(
          `wake: no such recipient: ${words[0]} — name an alias or id ` +
            `(:wake homelab in 60m, :wake P-19 in 1h)`,
        )
      }
      if (!to) throw new Error('wake: name who to wake (:wake homelab in 60m)')
      let more = words.slice(1)
      let last = more.length > 1
        ? find(ctx.rows, more[more.length - 1])
        : undefined
      if (last) more = more.slice(0, -1)
      let when = more.join(' ')
      let at = instant(when)
      if (at == null) {
        throw new Error(
          `wake: when is "${when}"? (in 60m, 9am tomorrow, 2026-07-25T09:00)`,
        )
      }
      let about = last ?? ctx.rows.find((x) => x.eid == ctx.eid)
      let w = uuid()
      return {
        changes: [
          {
            eid: w,
            name: 'wake',
            comp: {
              at: new Date(at).toISOString(),
              ...(about ? { target: about.eid } : {}),
              ...(note ? { note } : {}),
            },
          },
          { eid: w, name: 'deliver', comp: { to: to.eid } },
        ],
        msg: `wake ${idOf(to)}${about ? ` → ${idOf(about)}` : ''} at ${
          new Date(at).toString().slice(0, 21)
        }`,
      }
    },
  },
  // :mail is the letter in one line — to, subject, then `--` folds the
  // envelope open into the page. Minting doc+mail IS the send request
  // (the mailer effect delivers and stamps the receipt); the verb mints
  // PROSE only — a letter is words an agent wrote.
  // `to` stays as given: raw address or graph reference, the address
  // book resolves at delivery.
  mail: {
    args: [
      a('to', 'jeff', { kind: id }),
      a('subject', 'subject…'),
      a('body', '-- body…', { rest: true }),
    ],
    about: 'send a letter: to, subject, -- body',
    run: (rest, ctx) => {
      let [, head, body] = rest.match(/^([\s\S]*?)\s+--\s+([\s\S]+)$/) ?? []
      let [to, ...subj] = (head ?? '').trim().split(/\s+/).filter(Boolean)
      if (!to || !subj.length || !body?.trim()) {
        throw new Error(
          'mail: to, subject, then -- body (:mail jeff lunch? -- noon?)',
        )
      }
      let subject = subj.join(' ')
      return {
        changes:
          mailChanges({ to, subject, body: page(body.trim(), ctx) }).changes,
        msg: `mail → ${to} — ${subject}`,
      }
    },
  },
  // :reply answers a mail where you stand — or the E-id the line leads
  // with. The words ARE the page (a lone @file is that page — see
  // `page`); replyChanges aims at the far side and records the thread at
  // authoring (reply_to), delivery resolves it to a Message-ID.
  reply: {
    args: [
      a('id', 'E-9', { kind: id, need: false }),
      a('answer', 'the answer…', { rest: true }),
    ],
    about: 'answer the mail — Re: threads at delivery',
    run: (rest, ctx) => {
      let [, first, more] = rest.trim().match(/^(\S+)\s*([\s\S]*)$/) ?? []
      let named = first ? find(ctx.rows, first) : undefined
      let row = named?.comps.mail ? named : here(ctx)
      if (!row.comps.mail) throw new Error(`${idOf(row)} is not a mail`)
      let body = (row == named ? more : rest).trim()
      if (!body) throw new Error('reply: needs words (:reply E-9 on it)')
      let made = replyChanges(row, page(body, ctx))
      return {
        changes: made.changes,
        msg: `${idOf(row)} ← reply → ${made.changes[1].comp?.to}`,
      }
    },
  },
  // :scribe summons the desk for the sessions a final message can't
  // cover — a marathon spanning many tasks and ideas. The ask is a
  // comment on the standing desk task (the desk boots claiming it, so
  // the bus serves the ask); the spawn is the same pinned desk the
  // sweep uses. A desk already at work just gets the ask queued.
  scribe: {
    args: [a('session', 'S-31', { kind: id, need: false })],
    about: "have the scribe write that session's brief",
    words: [0, 1],
    run: (rest, ctx) => {
      let name = rest.trim().split(/\s+/).filter(Boolean)[0]
      let target = name ? find(ctx.rows, name) : here(ctx)
      if (!target?.comps.session) {
        throw new Error('scribe: name a session (:scribe S-31)')
      }
      let desk = find(ctx.rows, DESK.task)
      if (!desk?.comps.task) throw new Error('no scribe-desk task in the graph')
      let busy = ctx.rows.some((r) =>
        r.comps.session?.requested_task == desk.eid &&
        ['starting', 'running'].includes(String(r.comps.session.status))
      )
      return {
        changes: [
          ...commentChanges(
            ctx.rows,
            desk.eid,
            `brief ${idOf(target)} — write its session doc`,
            ctx.session,
          ),
          ...(busy ? [] : spawnChanges(ctx.rows, DESK).changes),
        ],
        msg: busy
          ? `${idOf(target)} → scribe (desk busy, ask queued)`
          : `${idOf(target)} → scribe`,
      }
    },
  },
  claim: {
    args: [a('session', undefined, { need: false })],
    about: 'lease the focused entity',
    words: [0, 1],
    run: (rest, ctx) => {
      let r = here(ctx)
      let session = rest.trim() || ctx.session
      if (!session) throw new Error('claim: name a session (:claim sess-1)')
      return {
        changes: claimChanges(ctx.rows, r.eid, session),
        msg: `${idOf(r)} ⚑ ${session}`,
      }
    },
  },
  // Params start at a dot, which is what lets a value hold spaces
  // (:set .title=two words) without quoting rules the CLI's argv gives
  // it for free. Values ride ctx.read — one @file convention for every
  // door that has a filesystem, the same one `task set` speaks.
  set: {
    dots: true,
    args: [
      a('param', '.prop=value'),
      a('more', '…', { rest: true, need: false }),
    ],
    about: 'patch the focused entity',
    run: (rest, ctx) => {
      let r = here(ctx)
      let args = rest.trim().split(/\s+(?=\.)/).filter(Boolean)
      if (!args.length) throw new Error('set: needs .prop=value')
      let ps = readParams(args, ctx)
      return {
        changes: Object.entries(patches(ps))
          .map(([name, comp]) => ({ eid: r.eid, name, comp })),
        msg: `${idOf(r)} ${args.join(' ')}`,
      }
    },
  },
  delete: {
    args: [
      a('id', 'T-42', { kind: id, need: false }),
      a('--cascade', '--cascade', { need: false }),
    ],
    about: 'tombstone an entity — the cascade takes its dependents (--cascade)',
    run: del,
  },
  forget: {
    args: [
      a('id', 'M-7', { kind: id, need: false }),
      a('--cascade', '--cascade', { need: false }),
    ],
    about: 'tombstone a memory (delete, said for memories)',
    run: del,
  },
  task: card('task'),
  session: card('session'),
  doc: card('doc'),
  memory: card('memory'),
}

export let run = (
  line: string,
  ctx: Ctx,
  local: Record<string, Command> = {},
): Result => {
  let [, name, rest] = line.trim().match(/^(\S+)\s*(.*)$/s) ?? []
  if (!name) return {}
  let v = { ...commands, ...local }[name]
  if (!v) throw new Error(`not a command: ${name}`)
  let words = (rest ?? '').trim().split(/\s+/).filter(Boolean).length
  if (v.words && (words < v.words[0] || words > v.words[1])) {
    throw new Error(
      `${name}: usage :${`${name} ${slotsOf(v.args)}`.trim()} ` +
        `(got ${words} argument${words == 1 ? '' : 's'})`,
    )
  }
  return v.run(rest ?? '', ctx)
}

// The order in a piece of writing: only the FIRST line commands, and the
// rest rides as prose, so `:fix` plus a paragraph of context is both the
// order and the note. A leading space escapes it — prose that opens with
// a colon is rare, and never indented by accident. The rule lives with
// the vocabulary because both ends need it: the effect that RUNS a
// comment's order, and the composer that completes one as it's typed.
export let orderIn = (body: string) => {
  let [first = ''] = body.split('\n')
  return /^:\S/.test(first) ? first.trim() : ''
}

// What ONE input box means, where filing is the common case: a line that
// opens with ':' is the verb it names, and anything else is a task —
// the board's quick-add rule, said once so every such box says it the
// same way (the browser extension's, today). Not folded into run(): a
// bare word at a door that only ever takes commands is a typo, and
// `not a command: Read` is the right answer there.
export let filing = (text: string) => {
  let line = text.trim()
  return line.startsWith(':') ? line : `:new ${line}`
}

// The door every non-typing caller enters by: the line with or without
// its colon, and the changes deref'd — any reference a verb produced may
// be a human id (T-3, P-19) or an alias (jeff), and client.ts resolves
// them HERE rather than letting a miss fail as an FK later.
//
// No Ctx.read: this door is MCP over /mcp, where the caller's line is
// spoken to the SERVER's process. `@/etc/passwd` there would read the
// server's disk, not the caller's, so values stay literal — an MCP caller
// passes a long body as a string (task_new/graph_apply take one whole).
export let commandOut = (
  all: Row[],
  line: string,
  eid?: string,
  session?: string,
) => {
  let out = run(line.replace(/^:/, ''), { eid, rows: all, session })
  return out.changes ? { ...out, changes: derefChanges(all, out.changes) } : out
}

// Typeahead over the table: prefix matches lead (`:d` is to the point),
// substring matches trail, both in table order. An empty line lists
// everything — that's the menu.
export let suggest = (
  line: string,
  all: Record<string, Command>,
): [string, Command][] => {
  let name = line.trimStart().split(/\s/)[0] ?? ''
  let rows = Object.entries(all)
  if (!name) return rows
  return [
    ...rows.filter(([n]) => n.startsWith(name)),
    ...rows.filter(([n]) => !n.startsWith(name) && n.includes(name)),
  ]
}

// What one slot paints faded: its concrete sample if it has one, else the
// metavar with a trailing `…` for a catch-all — `eg ?? name`, the teaching
// half of the vocabulary (`jeff` reads faster than `<to>`).
let ghostSlot = (arg: Arg) => arg.eg ?? `${arg.name}${arg.rest ? '…' : ''}`

// What to paint faded past the caret: the best match's remaining letters
// while the verb is still being typed; once it stands, the sample args it
// hasn't been given yet — one Arg slot per typed word (T-12929), no longer
// a regex over a prose example.
export let ghost = (line: string, all: Record<string, Command>): string => {
  let m = line.match(/^(\S+)(\s+(.*))?$/s)
  if (!m) return ''
  let [, name, spaced, rest] = m
  if (!spaced) {
    let best = Object.keys(all).find((n) => n.startsWith(name) && n != name)
    if (best) return best.slice(name.length)
    if (!all[name]) return ''
  }
  let cmd = all[name]
  if (!cmd?.args.length) return ''
  let typed = (rest ?? '').split(/\s+/).filter(Boolean).length
  let left = cmd.args.slice(typed)
  if (!left.length) return ''
  return (/\s$/.test(line) ? '' : ' ') + left.map(ghostSlot).join(' ')
}

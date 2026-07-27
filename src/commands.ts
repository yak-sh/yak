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
//   :set .prop=v …   the write grammar (client.ts param), verbatim
//
// A bad command throws; the bar shows the message, exactly as a malformed
// board query does (query.ts). Platform-local verbs (the TUI's :q, the
// web's :zoom) ride in run()'s `local` table — the shared list is the
// language both faces speak, and each adds only what the other can't do.
import { type Change, idOf, uuid } from './types.ts'
import {
  claimChanges,
  commentChanges,
  DESK,
  find,
  mailChanges,
  param,
  patches,
  replyChanges,
  type Row,
  spawnChanges,
  spec,
  taskChanges,
} from './client.ts'
import { adopt, parseQuery } from './query.ts'
import { instant } from './time.ts'

// Where the typist is standing: the focused entity (the web's root card,
// the TUI's trail head), the graph to resolve names against, and the
// session speaking — a browser has none, so :claim must name one there.
export type Ctx = {
  eid?: string
  rows: Row[]
  session?: string
}

export type Result = {
  changes?: Change[]
  go?: string // an eid to open — the platform picks the form (url, trail)
  spawn?: string // a task eid to start an agent on — platforms that can, do
  msg?: string
}

export type Verb = (rest: string, ctx: Ctx) => Result

// Where a HEADLESS caller stands: its session's single claim. The shell
// door resolves focus through this — one lease is an unambiguous
// "here"; none or several mean the line must lead with an id.
export let focusOf = (rows: Row[], session?: string): string | undefined => {
  if (!session) return undefined
  let me = rows.find((r) => String(r.comps.session?.id ?? '') == session)
  if (!me) return undefined
  let mine = rows.filter((r) => r.comps.claim?.session_eid == me.eid)
  return mine.length == 1 ? mine[0].eid : undefined
}

let here = (ctx: Ctx): Row => {
  let r = ctx.rows.find((x) => x.eid == ctx.eid)
  if (!r) throw new Error('nothing focused')
  return r
}

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
  if (r.comps.project) return { project_eid: r.eid }
  let p = r.comps.task?.project_eid
  return p ? { project_eid: p } : {}
}

// A command carries its own manual and any finite word count, so every
// renderer and dispatcher shares both the prompt and the refusal.
export type Command = {
  args: string
  about: string
  run: Verb
  words?: [min: number, max: number]
}

export let commands: Record<string, Command> = {
  // :new speaks the spec grammar (client.ts): 'P1 .domain=Eng Ship it'
  // — typed setters win over what the context hands down.
  new: {
    args: 'P1 .domain=Eng title…',
    about: 'file a task where you stand',
    run: (rest, ctx) => {
      let { title, body, grouped } = spec(rest)
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
    args: '[T-42]',
    about: 'reopen the task — or go to T-42',
    words: [0, 1],
    run: (rest, ctx) => rest.trim() ? go(rest.trim(), ctx) : reopen(rest, ctx),
  },
  // :fix is capture-to-agent in one line: a bare id runs an agent on
  // that task; anything else is a spec line that FILES the task first.
  // A fix without a named task is a fix for the TOOL you're typing into
  // — whatever card you're looking at — so it routes to the deployment's
  // own project (alias `home`; the sole repo-bearing project when no
  // alias stands). Explicit .project= always wins. The spawn is an
  // INTENT like go: this module never touches the wire.
  fix: {
    args: '[T-42 | the toolbar clips at small widths]',
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
      let { title, body, grouped } = spec(text)
      if (!title) throw new Error('fix: needs a title')
      let task = { ...grouped.task }
      if (!task.project_eid) {
        let home = find(ctx.rows, 'home')
        if (home?.comps.project) task.project_eid = home.eid
        else {
          let repos = ctx.rows.filter((r) => r.comps.repo && r.comps.project)
          if (repos.length == 1) task.project_eid = repos[0].eid
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
  done: {
    args: '',
    about: 'move the focused task to done',
    words: [0, 0],
    run: move('done'),
  },
  wip: {
    args: '',
    about: 'move the focused task to wip',
    words: [0, 0],
    run: move('wip'),
  },
  cancel: {
    args: '[reason]',
    about: 'call off the focused task; the words become a comment',
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
  // :knock is the attention lever: bring the focused entity to someone's
  // attention NOW. The recipient is the first word when it names an
  // entity (alias, id); with none, a task's own project is asked. The
  // rest of the words ride as a plain comment on the target — the knock
  // artifact itself never carries prose. Delivery is the server's
  // ladder (knock.ts); the stamp on the K-entity says what happened.
  knock: {
    args: 'homelab need the key today',
    about: "someone's attention, now — on the focused entity",
    run: (rest, ctx) => {
      let r = here(ctx)
      let [first, ...more] = rest.trim().split(/\s+/).filter(Boolean)
      let to = first ? find(ctx.rows, first) : undefined
      let words = (to ? more : [first, ...more]).filter(Boolean).join(' ')
      let toEid = to?.eid ?? (r.comps.task?.project_eid as string | undefined)
      if (!toEid) {
        throw new Error('knock: name a recipient (:knock homelab …)')
      }
      let k = uuid()
      return {
        changes: [
          {
            eid: k,
            name: 'knock',
            comp: { target_eid: r.eid, to_eid: toEid },
          },
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
    args: 'homelab in 60m T-42',
    about: 'a knock on a timer — wake someone at a time',
    run: (rest, ctx) => {
      let words = rest.trim().split(/\s+/).filter(Boolean)
      let to = words[0] ? find(ctx.rows, words[0]) : undefined
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
          // The doc is what the knock will show when the wake is its own
          // subject — the ask, in the asker's words.
          { eid: w, name: 'doc', comp: { title: `wake ${rest.trim()}` } },
          {
            eid: w,
            name: 'wake',
            comp: {
              at: new Date(at).toISOString(),
              to_eid: to.eid,
              ...(about ? { target_eid: about.eid } : {}),
            },
          },
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
  // PROSE only — machinery speaks through event comments, never mail.
  // `to` stays as given: raw address or graph reference, the address
  // book resolves at delivery.
  mail: {
    args: 'jeff subject… -- body…',
    about: 'send a letter: to, subject, -- body',
    run: (rest) => {
      let [, head, body] = rest.match(/^([\s\S]*?)\s+--\s+([\s\S]+)$/) ?? []
      let [to, ...subj] = (head ?? '').trim().split(/\s+/).filter(Boolean)
      if (!to || !subj.length || !body?.trim()) {
        throw new Error(
          'mail: to, subject, then -- body (:mail jeff lunch? -- noon?)',
        )
      }
      let subject = subj.join(' ')
      return {
        changes: mailChanges({ to, subject, body: body.trim() }).changes,
        msg: `mail → ${to} — ${subject}`,
      }
    },
  },
  // :reply answers a mail where you stand — or the E-id the line leads
  // with. The words are the whole page, verbatim; replyChanges aims at
  // the far side and records the thread at authoring (reply_to_eid),
  // delivery resolves it to a Message-ID.
  reply: {
    args: '[E-9] the answer…',
    about: 'answer the mail — Re: threads at delivery',
    run: (rest, ctx) => {
      let [, first, more] = rest.trim().match(/^(\S+)\s*([\s\S]*)$/) ?? []
      let named = first ? find(ctx.rows, first) : undefined
      let row = named?.comps.mail ? named : here(ctx)
      if (!row.comps.mail) throw new Error(`${idOf(row)} is not a mail`)
      let body = (row == named ? more : rest).trim()
      if (!body) throw new Error('reply: needs words (:reply E-9 on it)')
      let made = replyChanges(row, body)
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
    args: '[S-31]',
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
        r.comps.session?.requested_task_eid == desk.eid &&
        ['starting', 'running'].includes(String(r.comps.session.status))
      )
      return {
        changes: [
          ...commentChanges(
            ctx.rows,
            desk.eid,
            `brief ${idOf(target)} — write its session doc`,
            ctx.session,
            { event: true }, // the command's phrasing, not the caller's — never mailed
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
    args: '[session]',
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
  // it for free.
  set: {
    args: '.prop=value …',
    about: 'patch the focused entity',
    run: (rest, ctx) => {
      let r = here(ctx)
      let args = rest.trim().split(/\s+(?=\.)/).filter(Boolean)
      if (!args.length) throw new Error('set: needs .prop=value')
      let ps = args.map((a) => {
        let p = param(a)
        if (!p) throw new Error(`not a param: ${a}`)
        return p
      })
      return {
        changes: Object.entries(patches(ps))
          .map(([name, comp]) => ({ eid: r.eid, name, comp })),
        msg: `${idOf(r)} ${args.join(' ')}`,
      }
    },
  },
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
      `${name}: usage :${`${name} ${v.args}`.trim()} ` +
        `(got ${words} argument${words == 1 ? '' : 's'})`,
    )
  }
  return v.run(rest ?? '', ctx)
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

// What to paint faded past the caret: the best match's remaining letters
// while the verb is still being typed; once it stands, the example args
// it hasn't been given yet — the example is a list of slots, and each
// typed word consumes one.
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
  if (!cmd?.args) return ''
  let typed = (rest ?? '').split(/\s+/).filter(Boolean).length
  // A bracketed group ([T-42 | words…]) is ONE slot: the bracket names
  // what a single argument may be, so one typed word consumes it whole.
  let left = (cmd.args.match(/\[[^\]]*\]|\S+/g) ?? []).slice(typed)
  if (!left.length) return ''
  return (/\s$/.test(line) ? '' : ' ') + left.join(' ')
}

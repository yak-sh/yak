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
  find,
  param,
  patches,
  type Row,
  spec,
  taskChanges,
} from './client.ts'
import { adopt, parseQuery } from './query.ts'

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
  msg?: string
}

export type Verb = (rest: string, ctx: Ctx) => Result

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

// A command carries its own manual — example args and a one-line
// summary — so the suggest list and the ghost can never drift from what
// run() accepts: they read the same table.
export type Command = { args: string; about: string; run: Verb }

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
    run: (rest, ctx) => rest.trim() ? go(rest.trim(), ctx) : reopen(rest, ctx),
  },
  done: { args: '', about: 'move the focused task to done', run: move('done') },
  wip: { args: '', about: 'move the focused task to wip', run: move('wip') },
  claim: {
    args: '[session]',
    about: 'lease the focused entity',
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
  let left = cmd.args.split(/\s+/).slice(typed)
  if (!left.length) return ''
  return (/\s$/.test(line) ? '' : ' ') + left.join(' ')
}

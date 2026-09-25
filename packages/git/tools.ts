// The implementations behind the `tool: true` declarations in ./vocab.json,
// exported as `@yaks/git/tools`.
//
// All three act on the machine the call runs on as much as on the graph: the
// checkout at the `cwd` of the process that made the call, which on a command
// line is the directory the person ran the command in, because `yak land` and
// `yak cites check` build the graph and call the tool in that same process
// (@yaks/cli local.ts).
//
// A landing refused for the caller's own state is an expected invocation
// failure: a moved base is returned as a divergence, and a worktree that is
// dirty, detached or on the base, shared-checkout changes overlap the landing,
// or a revert the guard caught, is a `LandError`. Both become a `CallError`
// carrying Git's whole account, which the tool runner records as a failed call
// and a command line reports as exit 1. An unexpected Git command failure
// escapes as a plain error, for the runner to report as the fault it is.
//
// `cites check` is a check — a tool whose verb is `check`, which is all a
// doctor is (@yaks/tools ./check.ts) — so a citation that moved is a finding
// in a report, never a refused write. It enforces nothing, on purpose: a
// document whose code moved is work somebody has to do, not a transaction to
// reject. `cites verify` is the only thing that writes the `verified` mark,
// which is what keeps the mark meaning "somebody looked" rather than
// "somebody edited this".
//
// The journal is a seam rather than an import of the log: a citation of an
// entity is graded on what changed about that entity afterwards, which only a
// host with @yaks/journal's tables can answer, and a host without them gets
// `unknown` rather than a wrong answer.

import {
  addressed,
  argsOf,
  type Bundle,
  type Comp,
  detached,
  type Eid,
  Refused,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { and, present, want } from '@yaks/query'
import { human } from '@yaks/id'
import { CallError, checked, type Finding, type Level } from '@yaks/tools'
import type { Driver } from '@yaks/sql'
import { logFor } from '@yaks/journal/rules'
import { land, LandError, run as git } from './land.ts'
import {
  type Changed,
  CITES,
  FILE,
  LINES,
  REVISION,
  type Status,
  status,
  SYMBOL,
  VERIFIED,
} from './cites.ts'

/** What these tools use from the host that opened the graph: the connection
 * the journal is read over, where there is one. */
export type Seams = { sql?: Driver }

let str = (v: unknown): string => v == null ? '' : String(v)
let comp = (b: Bundle, name: string) => b[name] as Comp | undefined
let count = (v: unknown): number | undefined =>
  typeof v == 'number' && Number.isFinite(v) ? v : undefined

let checkout = (call: Bundle, verb: string): string => {
  let cwd = comp(call, 'process')?.cwd
  if (!cwd) {
    throw new CallError(
      'cwd',
      `${verb} reads a checkout, and this graph runs nowhere in particular`,
    )
  }
  return String(cwd)
}

// What the journal recorded about one entity after a moment, one line per
// transaction: its place in the order, and the components it patched. Without
// a connection there is no journal to read, and a citation of an entity says
// so instead of guessing.
let journal = (host: Seams): Changed | undefined => {
  if (!host.sql) return undefined
  let log = logFor({ sql: host.sql })
  return (target: Eid, after: string) =>
    log.entries(target).filter((e) => e.at > after).map((e) =>
      `#${e.seq} ${[...new Set(e.patches.map((p) => p.comp))].join(', ')}`
    )
}

// Where a citation points, in one phrase: the file and the place in it, or the
// entity it names.
let where = (
  cite: Bundle,
  to: Bundle,
  file: Bundle,
  id: (b: Bundle) => string,
): string => {
  let path = str(comp(file, FILE)?.path)
  if (!path) return id(to)
  let name = str(comp(to, SYMBOL)?.name)
  if (name) return `${path}:${name}`
  let start = count(comp(cite, LINES)?.start)
  if (start == null) return path
  return `${path}:${start}-${count(comp(cite, LINES)?.end) ?? start}`
}

// How a state reads in a report. A citation that moved is a measured fact, so
// it fails; one nobody has checked, or one nothing could establish an answer
// for, is a warning — the check could not vouch either way.
let verdict = (
  got: Exclude<Status, { state: 'current' }>,
): [Level, string] =>
  got.state == 'moved'
    ? ['fail', `moved by ${got.changes.join(', ')}`]
    : got.state == 'unverified'
    ? ['warn', 'never checked']
    : ['warn', `no answer: ${got.why}`]

/** The implementations of the tools ./vocab.json declares. */
export let runs = (host: Seams = {}): Runs => ({
  land: async (call): Promise<Bundle[]> => {
    let args = argsOf(call)
    let cwd = checkout(call, 'land')
    // Git's output, exactly as Git wrote it, collected in the order it
    // arrived: what the caller reads is Git's own account, not a summary of
    // it.
    let said: string[] = []
    let outcome
    try {
      outcome = await land({
        cwd,
        allow: str(args['allow-revert']).split(',').filter(Boolean),
        write: (text) => {
          let line = text.trimEnd()
          if (line) said.push(line)
        },
      })
    } catch (error) {
      if (error instanceof LandError) {
        throw new CallError('land', error.message)
      }
      throw error
    }
    if (!('landed' in outcome)) throw new CallError('diverged', said.join('\n'))
    return [{
      entity: { eid: '$landed' },
      content: { body: [...said, `landed ${outcome.landed}`].join('\n') },
    }]
  },

  cites_check: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let cwd = checkout(call, 'checking citations')
    let id = human(graph.vocab)
    let of = str(args.of)
    let [scope] = of ? await addressed(graph, [of]) : []
    let path = str(args.path)
    let cites = await graph.read(and(present(CITES), want('edge')))
    // Both ends of every citation in one read: a finding names who cites what,
    // and an id a person recognizes rather than a uuid.
    let ends = [
      ...new Set(
        cites.flatMap((b) => [comp(b, 'edge')?.from, comp(b, 'edge')?.to])
          .filter((e): e is string => !!e),
      ),
    ]
    let get = async (eids: string[]) =>
      (await detached(graph.storage).get(eids)).map((b) =>
        [b.entity.eid, b] as const
      )
    let at = new Map(await get(ends))
    // A cited definition is read in its module's file: fetch those too.
    let modules = [...at.values()].map((b) => str(comp(b, SYMBOL)?.module))
      .filter((e) => e && !at.has(e))
    for (let [eid, b] of await get([...new Set(modules)])) at.set(eid, b)
    let fileOf = (to: Bundle) =>
      comp(to, SYMBOL) ? at.get(str(comp(to, SYMBOL)?.module)) ?? to : to
    let changed = journal(host)
    let found: Finding[] = []
    for (let cite of cites) {
      let edge = comp(cite, 'edge')
      let from = at.get(str(edge?.from))
      let to = at.get(str(edge?.to))
      if (!from || !to) continue
      if (scope && from.entity.eid != scope) continue
      let file = fileOf(to)
      if (path && str(comp(file, FILE)?.path) != path) continue
      let got = await status(cite, to, { cwd, changed }, file)
      if (got.state == 'current') continue
      let [level, why] = verdict(got)
      found.push({
        level,
        text: `${id(from)} cites ${where(cite, to, file, id)} — ${why}`,
      })
    }
    return checked(call.entity.eid, 'every citation still holds', found)
  },

  cites_verify: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let cwd = checkout(call, 'verifying a citation')
    let cite = str(args.cite)
    let of = str(args.of)
    if (!cite && !of) {
      throw new Refused(
        'verify needs a citation, or an entity whose citations to verify',
      )
    }
    let [asked] = await addressed(graph, [cite || of])
    let found = cite
      ? (await detached(graph.storage).get([asked])).filter((b) => b[CITES])
      : (await graph.read(and(present(CITES), want('edge'))))
        .filter((b) => str(comp(b, 'edge')?.from) == asked)
    if (!found.length) {
      throw new Refused(
        cite
          ? `${cite} is not a citation`
          : `${of} makes no citations to verify`,
      )
    }
    let head = await git(['rev-parse', 'HEAD'], cwd)
    if (!head.ok) {
      throw new CallError(
        'head',
        head.err.trim() || 'this checkout is on no commit',
      )
    }
    let commit = head.out.trim()
    // The mark is written empty: `at`, `by` and `via` are the graph's to
    // stamp, so a citation records who checked it and cannot claim otherwise.
    return found.map((b) => ({
      entity: { eid: b.entity.eid },
      [VERIFIED]: {},
      [REVISION]: { commit },
    }))
  },
})

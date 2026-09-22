// The implementations behind the `tool: true` declarations in ./vocab.json,
// exported as `@yaks/git/tools`.
//
// All three act on the machine the call runs on as much as on the graph: the
// checkout at `ctx.cwd`, which on a command line is the directory the person
// ran the command in, because `yak land` and `yak cites check` build the graph
// and call the tool in that same process (@yaks/cli local.ts).
//
// A diverged base is A failure. Landing ends in one of two ways (./land.ts):
// it landed, or the base moved and the branch was rebased and left waiting for
// its tests to be re-run. The second is not a landing, so it is thrown as a
// `CallError` carrying Git's whole account of it as the message, which the
// tool runner records as a failed call and a command line reports as exit 1.
// Those are the same two exit codes `land` has always had.
//
// `cites check` is a CHECK — a tool whose verb is `check`, which is all a
// doctor is (@yaks/tools ./check.ts) — so a citation that moved is a finding
// in a report, never a refused write. It enforces nothing, on purpose: a
// document whose code moved is work somebody has to do, not a transaction to
// reject. `cites verify` is the only thing that writes the `verified` mark,
// which is what keeps the mark meaning "somebody looked" rather than
// "somebody edited this".
//
// The journal is a SEAM rather than an import of the log: a citation of an
// entity is graded on what changed about that entity afterwards, which only a
// host with @yaks/journal's tables can answer, and a host without them gets
// `unknown` rather than a wrong answer.

import {
  addressed,
  type Bundle,
  type Comp,
  detached,
  type Eid,
  Refused,
  type ToolCtx,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { and, present } from '@yaks/query'
import { human } from '@yaks/id'
import { CallError, checked, type Finding, type Level } from '@yaks/tools'
import type { Driver } from '@yaks/sqlite'
import { logFor } from '@yaks/journal/rules'
import { land, run as git } from './land.ts'
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

let checkout = (ctx: ToolCtx, verb: string): string => {
  if (!ctx.cwd) {
    throw new CallError(
      'cwd',
      `${verb} reads a checkout, and this graph runs nowhere in particular`,
    )
  }
  return ctx.cwd
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
let where = (cite: Bundle, to: Bundle, id: (b: Bundle) => string): string => {
  let path = str(comp(to, FILE)?.path)
  if (!path) return id(to)
  let name = str(comp(cite, SYMBOL)?.name)
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
  land: async (_bundles, ctx: ToolCtx): Promise<Bundle[]> => {
    let cwd = checkout(ctx, 'land')
    // Git's output, exactly as Git wrote it, collected in the order it
    // arrived: what the caller reads is Git's own account, not a summary of
    // it.
    let said: string[] = []
    let outcome = await land({
      cwd,
      allow: str(ctx.args['allow-revert']).split(',').filter(Boolean),
      write: (text) => {
        let line = text.trimEnd()
        if (line) said.push(line)
      },
    })
    if (!('landed' in outcome)) throw new CallError('diverged', said.join('\n'))
    return [{
      entity: { eid: '$landed' },
      content: { body: [...said, `landed ${outcome.landed}`].join('\n') },
    }]
  },

  cites_check: async (_bundles, ctx: ToolCtx): Promise<Bundle[]> => {
    let cwd = checkout(ctx, 'checking citations')
    let id = human(ctx.graph.vocab)
    let of = str(ctx.args.of)
    let [scope] = of ? await addressed(ctx.graph, [of]) : []
    let path = str(ctx.args.path)
    let cites = await ctx.read(and(present(CITES)))
    // Both ends of every citation in one read: a finding names who cites what,
    // and an id a person recognizes rather than a uuid.
    let ends = [
      ...new Set(
        cites.flatMap((b) => [comp(b, 'edge')?.from, comp(b, 'edge')?.to])
          .filter((e): e is string => !!e),
      ),
    ]
    let at = new Map(
      (await detached(ctx.graph.storage).get(ends)).map((b) => [
        b.entity.eid,
        b,
      ]),
    )
    let changed = journal(host)
    let found: Finding[] = []
    for (let cite of cites) {
      let edge = comp(cite, 'edge')
      let from = at.get(str(edge?.from))
      let to = at.get(str(edge?.to))
      if (!from || !to) continue
      if (scope && from.entity.eid != scope) continue
      if (path && str(comp(to, FILE)?.path) != path) continue
      let got = await status(cite, to, { cwd, changed })
      if (got.state == 'current') continue
      let [level, why] = verdict(got)
      found.push({
        level,
        text: `${id(from)} cites ${where(cite, to, id)} — ${why}`,
      })
    }
    return checked(ctx.call, 'every citation still holds', found)
  },

  cites_verify: async (_bundles, ctx: ToolCtx): Promise<Bundle[]> => {
    let cwd = checkout(ctx, 'verifying a citation')
    let cite = str(ctx.args.cite)
    let of = str(ctx.args.of)
    if (!cite && !of) {
      throw new Refused(
        'verify needs a citation, or an entity whose citations to verify',
      )
    }
    let [asked] = await addressed(ctx.graph, [cite || of])
    let found = cite
      ? (await detached(ctx.graph.storage).get([asked])).filter((b) => b[CITES])
      : (await ctx.read(and(present(CITES))))
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

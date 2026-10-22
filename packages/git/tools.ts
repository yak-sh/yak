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
// failure: a moved base is returned as a divergence, which becomes a
// `CallError` carrying Git's whole account, and a worktree that is dirty,
// detached or on the base, shared-checkout changes overlap the landing, or a
// revert the guard caught, is a `LandError`, which is one already. The tool
// runner records either as a failed call and a command line reports it as
// exit 1. An unexpected Git command failure escapes as a plain error, for the
// runner to report as the fault it is.
//
// `cites check` is a check — a tool whose verb is `check`, which is all a
// doctor is (@yaks/tools ./check.ts) — so a citation that moved is a finding
// in a report, never a refused write. It enforces nothing, on purpose: a
// document whose code moved is work somebody has to do, not a transaction to
// reject. `cites verify` is the only thing that writes the `verified` mark,
// which is what keeps the mark meaning "somebody looked" rather than
// "somebody edited this".
//
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { argsOf } from '@yaks/graph/call'
import { Refused } from '@yaks/graph/errors'
import type { Runs } from '@yaks/graph/tools'
import { and, present, want } from '@yaks/query'
import { human } from '@yaks/id'
import { verify as entityVerify } from '@yaks/kernel'
import { once } from '@yaks/fp'
import type { Finding, Level } from '@yaks/tools'
import { CallError } from '@yaks/tools/errors'
import { checked } from '@yaks/tools/check'
import { land, run as git } from './land.ts'
import { localFilesystem, locate, repositoryEid } from './host.ts'
import {
  type Checkout,
  CITES,
  FILE,
  LINES,
  REVISION,
  type Status,
  status,
  SYMBOL,
  tracked,
  VERIFIED,
  within,
} from './cites.ts'

let str = (v: unknown): string => v == null ? '' : String(v)
let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined
let count = (v: unknown): number | undefined =>
  typeof v == 'number' && Number.isFinite(v) ? v : undefined

// Every citation, with the marks its state is derived from: a read names each
// component it wants, so one left out reads as never written.
let citations = async (graph: Graph): Promise<Bundle[]> =>
  await graph.read(
    and(present(CITES), want('edge'), want(VERIFIED), want(REVISION)),
  )

// Every entity the citations reach: both ends, the file a cited symbol or
// place is in, and the root each file is read in.
let reach = async (graph: Graph, cites: Bundle[]) => {
  let at = new Map<string, Bundle>()
  let add = async (eids: unknown[]) => {
    let more = [...new Set(eids.map(str))].filter((eid) => eid && !at.has(eid))
    if (!more.length) return
    for (let b of await graph.get(more)) at.set(b.entity.eid, b)
  }
  await add(cites.flatMap((b) => [comp(b, 'edge')?.from, comp(b, 'edge')?.to]))
  await add([...at.values()].map(within))
  await add([...at.values()].map((b) => comp(b, FILE)?.root))
  return at
}

let cwdOf = (call: Bundle, verb: string): string => {
  let cwd = comp(call, 'process')?.cwd
  if (!cwd) {
    throw new CallError(
      'cwd',
      `${verb} reads a checkout, and this graph runs nowhere in particular`,
    )
  }
  return String(cwd)
}

// The checkout holding `cwd`, at its top, and the repository it is a checkout
// of on this computer's filesystem. Nothing when `cwd` is in no checkout.
let checkoutOf = async (
  graph: Graph,
  cwd: string,
): Promise<Checkout | undefined> => {
  let found = await locate(cwd)
  if (!found) return undefined
  let workspace = (await localFilesystem(graph)).entity.eid
  return { cwd: found.path, repository: repositoryEid(found.common, workspace) }
}

// Where a citation points, in one phrase: the file and the place in it, or the
// entity it names.
let where = (
  to: Bundle,
  file: Bundle | undefined,
  id: (b: Bundle) => string,
): string => {
  let path = str(comp(file, FILE)?.path)
  if (!path) return id(to)
  let name = str(comp(to, SYMBOL)?.name)
  if (name) return `${path}:${name}`
  let start = count(comp(to, LINES)?.start)
  if (start == null) return path
  return `${path}:${start}-${count(comp(to, LINES)?.end) ?? start}`
}

// How a state reads in a report. A citation that moved is a measured fact, so
// it fails; one nobody has checked, or one nothing could establish an answer
// for, is a warning — the check could not vouch either way.
let verdict = (
  got: Exclude<Status, { state: 'current' }>,
): [Level, string] =>
  got.state == 'moved'
    ? [
      'fail',
      got.changes?.length
        ? `moved by ${got.changes.join(', ')}`
        : 'cited content changed',
    ]
    : got.state == 'unverified'
    ? ['warn', 'never checked']
    : ['warn', `no answer: ${got.why}`]

/** The implementations of the tools ./vocab.json declares. */
export let runs = (): Runs => ({
  land: async (call): Promise<Bundle[]> => {
    let args = argsOf(call)
    let cwd = cwdOf(call, 'land')
    // Git's output, exactly as Git wrote it, collected in the order it
    // arrived: what the caller reads is Git's own account, not a summary of
    // it.
    let said: string[] = []
    let outcome = await land({
      cwd,
      allow: str(args['allow-revert']).split(',').filter(Boolean),
      write: (text) => {
        let line = text.trimEnd()
        if (line) said.push(line)
      },
    })
    if (!('landed' in outcome)) {
      throw new CallError('diverged', said.join('\n'))
    }
    return [{
      entity: { eid: '$landed' },
      content: { body: [...said, `landed ${outcome.landed}`].join('\n') },
      output: { source: call.entity.eid },
    }]
  },

  cites_check: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let cwd = str(comp(call, 'process')?.cwd) || undefined
    let id = human(graph.vocab)
    let of = str(args.of)
    let scope = of || undefined
    let path = str(args.path)
    let cites = await citations(graph)
    let at = await reach(graph, cites)
    // The checkout the call was made in: asked once, and only when a citation
    // of a file needs it.
    let ours = once(async () => cwd ? await checkoutOf(graph, cwd) : undefined)
    // The path names a file of this checkout's repository, when there is one.
    let named = async (file: Bundle | undefined) => {
      if (str(comp(file, FILE)?.path) != path) return false
      let repository = (await ours())?.repository
      return !repository || str(comp(file, FILE)?.root) == repository
    }
    let found: Finding[] = []
    for (let cite of cites) {
      let edge = comp(cite, 'edge')
      let from = at.get(str(edge?.from))
      let to = at.get(str(edge?.to))
      if (!from) continue
      if (scope && from.entity.eid != scope) continue
      if (!to) {
        if (path) continue
        found.push({
          level: 'fail',
          text: `${id(from)} cites ${str(edge?.to)} — cited entity is gone`,
        })
        continue
      }
      let file = tracked(to, (eid) => at.get(eid))
      if (path && !await named(file)) continue
      let checkout = file ? await ours() : undefined
      let got = await status(cite, to, { checkout, vocab: graph.vocab }, file)
      if (got.state == 'current') continue
      let [level, why] = verdict(got)
      found.push({
        level,
        text: `${id(from)} cites ${where(to, file, id)} — ${why}`,
      })
    }
    return checked(call.entity.eid, 'every citation still holds', found)
  },

  cites_verify: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let cite = str(args.cite)
    let of = str(args.of)
    if (!cite && !of) {
      throw new Refused(
        'verify needs a citation, or an entity whose citations to verify',
      )
    }
    let asked = cite || of
    let found = cite
      ? (await graph.get([asked])).filter((b) => b[CITES])
      : (await citations(graph))
        .filter((b) => str(comp(b, 'edge')?.from) == asked)
    if (!found.length) {
      throw new Refused(
        cite
          ? `${cite} is not a citation`
          : `${of} makes no citations to verify`,
      )
    }
    let at = await reach(graph, found)
    let toOf = (b: Bundle) => at.get(str(comp(b, 'edge')?.to))
    // The file of a repository a citation is checked against in Git, if any.
    let gitFile = (b: Bundle) => {
      let to = toOf(b)
      return to && tracked(to, (eid) => at.get(eid))
    }
    for (let b of found) {
      let to = toOf(b)
      if (to && comp(to, SYMBOL) && !gitFile(b)) {
        throw new Refused(
          `the cited symbol ${to.entity.eid} has no file to check`,
        )
      }
    }
    let files = found.map(gitFile).filter((f): f is Bundle => !!f)
    let commit = ''
    if (files.length) {
      let cwd = cwdOf(call, 'verifying a file citation')
      let checkout = await checkoutOf(graph, cwd)
      if (!checkout) throw new CallError('cwd', `${cwd} is in no checkout`)
      let other = files.find((f) =>
        str(comp(f, FILE)?.root) != checkout.repository
      )
      if (other) {
        throw new CallError(
          'cwd',
          `${str(comp(other, FILE)?.path)} is a file of another repository ` +
            'than this checkout; verify it in a checkout of its own',
        )
      }
      let head = await git(['rev-parse', 'HEAD'], checkout.cwd)
      if (!head.ok) {
        throw new CallError(
          'head',
          head.err.trim() || 'this checkout is on no commit',
        )
      }
      commit = head.out.trim()
    }
    return found.map((b) => {
      let to = toOf(b)
      if (!to) throw new Refused(`citation ${b.entity.eid} names no entity`)
      return gitFile(b)
        ? {
          entity: { eid: b.entity.eid },
          [VERIFIED]: {},
          [REVISION]: { commit },
        }
        : entityVerify(b, to, graph.vocab)
    })
  },
})

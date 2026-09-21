// What anybody may ask of a transcript: the `tools` facet a host takes
// (`@yaks/session/tools`) — the runs behind the `tool: true` declarations in
// ./vocab.json.
//
// Two things live here. The LEASE is the pair every worker types: take the
// lock on the thing you are about to work on, let it go when you are done. The
// INJECTION LOOP is the other, and it is the same idea one level up — a
// session starts by reading back what it was in the middle of, and ends by
// saying what it did and releasing what it held. `hooks install` is what makes
// a harness run those two at the right moments (./hooks.ts).
//
// WHAT A SESSION SHOULD BE TOLD IS UNDECIDED. `session_context` answers what
// a hook needs and nothing else: the transcript becomes an entity under the
// harness's own name for it, and what comes back is that entity's id and the
// work it holds a lock on. There was a composed digest here — the owner's
// turns, a handoff, recalled memories, the standing goals — and it is gone
// (T-37707): the owner's word is that the existing system never worked well
// and none of it is worth porting until there is a design. Leave it so.
//
// A hook hands its event over as JSON on stdin, which reaches a tool as the
// `hook` argument (`yak session context --hook -`). Parsing it here is what
// keeps the harness's dialect out of everything else: one field is read from
// it, the session's own id, and a payload that is not JSON at all is no
// reason to fail — a hook that fails is a session that will not start.
//
// The third thing here is the two CHECKS — tools whose verb is `check`, which
// is the whole of what a "doctor" is (@yaks/tools ./check.ts).
//
// A LOCK OUTLIVES ITS HOLDER. ./effects.ts frees the locks whose holder is not
// a session in this graph, at the one moment there is an honest answer — this
// process starting — so one
// found here appeared since, and the board is lying about who is working. The
// other half is the lock held by a transcript that ENDED: `stopped` or
// `failed` is a run nothing will resume, and its lock is a document nobody is
// editing that nobody else may edit. Neither is corruption, so both are
// `warn`; and a `settled` transcript is NOT one of them — a run between turns
// still holds what it holds (./reap.ts).
//
// A TRANSCRIPT STALLS. `pending` is the model owed a turn and `running` is a
// model or a tool owed an answer; both are moments, not states to live in. One
// that has been owed for hours means the daemon died mid-turn, or the answer
// came back to a process that was gone — the transcript just stops, and
// nothing anywhere says so. Both read the same rule everything else reads,
// ./status.ts `statusOf` over the entries, rather than a second copy of it.

import {
  addressed,
  type Bundle,
  type Comp,
  detached,
  TOMBSTONE,
  type ToolCtx,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { human } from '@yaks/id'
import { and, eq, present } from '@yaks/query'
import { checked, type Finding } from '@yaks/tools'
import type { Vocab } from '@yaks/vocab'
import { CLAIM, SESSION } from './comp.ts'
import { sessionFor } from './who.ts'
import { ENTRY } from './native.ts'
import { ordered, statusOf } from './status.ts'
import { install, settingsPath } from './hooks.ts'

/** What a config says to `@yaks/session`'s checks. */
export type Options = {
  /** how long a transcript may be owed a turn or an answer before that is a
   * stall rather than work in progress (default 2 hours) */
  hours?: number
}

let HOURS = 2

// A run nothing will resume. `settled` is left out on purpose: it means
// nothing is owed, not that the session is over.
let ENDED = ['stopped', 'failed']

let str = (v: unknown): string => v == null ? '' : String(v)

/** The session id a hook payload names, where the line did not say one. A
 * payload that will not parse says nothing, and says it quietly. */
export let hookSession = (hook: unknown): string => {
  try {
    let said = JSON.parse(str(hook)) as { session_id?: unknown }
    return str(said.session_id)
  } catch {
    return ''
  }
}

// The session this call is about, as the caller SAID it: the line's word,
// else the one in the hook payload. What it means is ./who.ts's to answer —
// an eid, a human id, or the harness's own name for the run, which is the
// only one of the three that may not exist yet.
let idIn = (ctx: ToolCtx): string =>
  str(ctx.args.session) || hookSession(ctx.args.hook)

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

/** One entity as a person reads it: its id, and its title where it has one. */
export let line = (vocab: Vocab, b: Bundle): string => {
  let id = human(vocab)(b)
  let title = str(comp(b, 'doc').title)
  return title ? `${id} — ${title}` : id
}

// An eid a query may name: a `$alias` is a bundle the batch has yet to mint,
// and nothing in the graph refers to it.
let minted = (eid: string) => !eid.startsWith('$')

// The transcript a word names, however the caller says it (./who.ts).
let sessionOf = (ctx: ToolCtx, id: string): Promise<Bundle | undefined> =>
  sessionFor(ctx, id)

// A session's own account of itself, as the patch that records it.
let briefed = (eid: string, text: unknown): Bundle => ({
  entity: { eid },
  brief: { text: str(text) },
})

/** The session a lock names. */
let holderOf = (b: Bundle): string => str(comp(b, CLAIM).session)

// One transcript's entries. Few sessions hold a lock, so this is asked per
// holder rather than by reading every entry in the graph.
let transcript = (ctx: Pick<ToolCtx, 'read'>, session: string) =>
  ctx.read(and(eq(`${ENTRY}.session`, session)))

// When an entry was written, as the kernel stamps it. A graph that stamps
// nothing has no clock to judge a stall by, which the check says out loud
// rather than passing.
let writtenAt = (b: Bundle): number => Date.parse(str(comp(b, 'created').at))

/** The runs behind the tools ./vocab.json declares. The host's vocabulary is
 * what the checks name an entity with, and its options are what they judge a
 * stall by. */
export let runs = (
  host: { vocab: Vocab },
  options: Options = {},
): Runs => ({
  claim_take: async (_bundles, ctx): Promise<Bundle[]> => {
    let [on] = await addressed(ctx.graph, [str(ctx.args.target)])
    let said = str(ctx.args.session)
    // Whoever is asking, where the line named nobody: the actor a door signed
    // this call with says which run it came through.
    let holder = said
      ? (await sessionOf(ctx, said))?.entity.eid
      : str(ctx.actor?.via || ctx.actor?.by)
    if (!holder) {
      throw new Error(
        said
          ? `no session answers to ${said}`
          : 'nobody is asking — say --session',
      )
    }
    return [{ entity: { eid: on }, [CLAIM]: { session: holder } }]
  },

  claim_release: async (_bundles, ctx): Promise<Bundle[]> => {
    let [on] = await addressed(ctx.graph, [str(ctx.args.target)])
    return [{ entity: { eid: on }, [CLAIM]: null }]
  },

  session_brief: async (_bundles, ctx): Promise<Bundle[]> => {
    let id = idIn(ctx)
    if (!id) throw new Error('which session? say --session')
    let s = await sessionOf(ctx, id)
    // A transcript nobody has reified yet is reified HERE, wearing its own
    // name, the way `session_context` reifies one. Never on the word the
    // caller typed: `--session S-37703` is a human id, not an eid, and taking
    // it for one mints an entity whose eid IS `S-37703` (./who.ts is what
    // tells the two apart).
    return [
      s ? briefed(s.entity.eid, ctx.args.text) : {
        ...briefed('$session', ctx.args.text),
        [SESSION]: { id },
      },
    ]
  },

  // The start of the loop: the transcript becomes an entity, and what it
  // holds comes back as the prose the harness injects. Its own id and its
  // locks, and deliberately nothing else — see the head of this file.
  session_context: async (_bundles, ctx): Promise<Bundle[]> => {
    let id = idIn(ctx)
    if (!id) return []
    let found = await sessionOf(ctx, id)
    let [actor] = ctx.args.actor
      ? await addressed(ctx.graph, [str(ctx.args.actor)])
      : []
    let eid = found?.entity.eid ?? '$session'
    // A fresh transcript holds nothing: it has no entity yet, so nothing in
    // the graph can name it as a holder.
    let held = minted(eid)
      ? await ctx.read(`.${CLAIM}.session=${JSON.stringify(eid)}`)
      : []
    return [
      // Only the difference is written back — a transcript's own columns are
      // not this tool's to restate.
      {
        entity: found?.entity ?? { eid },
        [SESSION]: { id, ...(actor ? { actor } : {}) },
      },
      {
        entity: { eid: '$context' },
        content: {
          body: [
            `# ${found ? line(host.vocab, found) : id}`,
            ...(held.length
              ? [
                '',
                '## claimed',
                ...held.map((b) => `- ${line(host.vocab, b)}`),
              ]
              : []),
          ].join('\n'),
        },
      },
    ]
  },

  // The end of it: what the session did, and everything it was holding let go.
  session_wrap: async (_bundles, ctx): Promise<Bundle[]> => {
    let id = idIn(ctx)
    let s = id ? await sessionOf(ctx, id) : undefined
    if (!s) return []
    let eid = s.entity.eid
    let held = await ctx.read(`.${CLAIM}.session=${JSON.stringify(eid)}`)
    return [
      ...(ctx.args.brief == null ? [] : [briefed(eid, ctx.args.brief)]),
      ...held.map((b): Bundle => ({
        entity: { eid: b.entity.eid },
        [CLAIM]: null,
      })),
    ]
  },

  hooks_install: (_bundles, ctx): Bundle[] => [{
    entity: { eid: '$said' },
    content: {
      body: `${ctx.args.remove ? 'removed from' : 'wrote'} ${
        install(str(ctx.args.path) || settingsPath(), {
          yak: str(ctx.args.yak) || undefined,
          remove: !!ctx.args.remove,
        })
      }`,
    },
  }],

  claim_check: async (_bundles, ctx) => {
    let id = human(host.vocab)
    let locks = await ctx.read(and(present(`${CLAIM}.session`)))
    let holders = [...new Set(locks.map(holderOf))]
    let rows = holders.length
      ? await detached(ctx.graph.storage).get(holders)
      : []
    // A tombstoned holder is a holder that is gone: `claim.session` dies by
    // release, so a lock still naming one is the same leak.
    let held = new Map(
      rows.filter((b) => b[TOMBSTONE] == null && b[SESSION] != null)
        .map((b) => [b.entity.eid, b]),
    )
    let over = new Map<string, string>()
    for (let eid of held.keys()) {
      let state = statusOf(await transcript(ctx, eid))
      if (ENDED.includes(state)) over.set(eid, state)
    }
    let found = locks.flatMap((b): Finding[] => {
      let eid = holderOf(b)
      let holder = held.get(eid)
      if (!holder) {
        return [{
          level: 'warn',
          text: `${id(b)} is locked by ${eid}, which this graph has no ` +
            `session for — start-up frees these, so this one went since`,
        }]
      }
      let state = over.get(eid)
      return state
        ? [{
          level: 'warn',
          text: `${id(b)} is locked by ${id(holder)}, whose transcript ` +
            `${state} — nothing will resume it, and nobody else may write`,
        }]
        : []
    })
    return checked(
      ctx.call,
      'no entity is locked by a session that is over',
      found,
    )
  },

  session_check: async (_bundles, ctx) => {
    let id = human(host.vocab)
    let hours = options.hours ?? HOURS
    let cutoff = Date.now() - hours * 3_600_000
    let sessions = await ctx.read(and(present(SESSION)))
    if (!sessions.length) {
      return checked(ctx.call, 'no transcript has stalled', [])
    }
    // One read of the entries, grouped here: a transcript is only readable as
    // a whole, and asking per session would be one query per session.
    let lines = new Map<string, Bundle[]>()
    let stamped = false
    for (let b of await ctx.read(and(present(ENTRY)))) {
      let of = str(comp(b, ENTRY).session)
      lines.set(of, [...lines.get(of) ?? [], b])
      if (!isNaN(writtenAt(b))) stamped = true
    }
    if (!stamped) {
      return checked(ctx.call, 'no transcript has stalled', [{
        level: 'warn',
        text: 'this graph stamps no time on an entry, so a transcript that ' +
          'stalled cannot be told from one that is merely quiet — UNVERIFIED',
      }])
    }
    let found = sessions.flatMap((s): Finding[] => {
      let entries = lines.get(s.entity.eid) ?? []
      let state = statusOf(entries)
      if (state != 'pending' && state != 'running') return []
      let newest = ordered(entries).at(-1)
      let at = newest ? writtenAt(newest) : NaN
      if (isNaN(at) || at > cutoff) return []
      return [{
        level: 'warn',
        text: `${id(s)} has been ${state} since ${
          new Date(at).toISOString()
        } — over ${hours}h owed ${
          state == 'pending' ? 'a turn' : 'an answer'
        }, with nothing appended since`,
      }]
    })
    return checked(ctx.call, 'no transcript has stalled', found)
  },
})

// What anybody may ask of a transcript: the tool implementations exported as
// `@yaks/session/tools` — the code behind the `tool: true` declarations in
// ./vocab.json.
//
// Two things live here. The lease is the pair every worker calls: take the lock
// on the thing you are about to work on, release it when you are done. The
// injection loop is the other, and it is the same idea one level up — a session
// starts by reading back what it was in the middle of, and ends by recording
// what it did and releasing what it held. `hooks install` is what makes a
// harness run those two at the right moments (./hooks.ts); the turns in
// between, the package's duty reads from the harness's own transcript file
// (./service.ts).
//
// What A session should be told is undecided. `session_context` returns what a
// hook needs and nothing else: the transcript becomes an entity under the
// harness's own id for it, and what comes back is that entity's id and the work
// it holds a lock on. There was a composed digest here — the owner's turns, a
// handoff, recalled memories, the standing goals — and it is gone (T-37707):
// the owner's word is that the existing system never worked well and none of it
// is worth porting until there is a design. Leave it so.
//
// A harness hands its event over as JSON on stdin, which reaches a tool as the
// `hook` argument (`yak session context --hook -`). Parsing it here is what
// keeps the harness's own JSON format out of everything else: one field is read
// from it, the session's own id, and a payload that is not JSON at all is no
// reason to fail — a hook that fails is a session that will not start.
//
// The third thing here is the two checks — tools whose verb is `check`, which
// is all a "doctor" command is (@yaks/tools ./check.ts).
//
// A lock outlives its holder. The duty (./service.ts) frees the locks whose
// holder is not a session in this graph, at the one moment there is a reliable
// answer — its process starting — so any lock the check finds appeared since then, and the
// board is misreporting who is working. The other half is the lock held by a
// transcript that ENDED: `stopped` or `failed` is a run nothing will resume,
// and its lock is a document nobody is editing that nobody else may edit.
// Neither is corruption, so both are `warn`; and a `settled` transcript is NOT
// one of them — a run between turns still holds what it holds (./reap.ts).
//
// A transcript stalls. `pending` means the model owes a turn and `running`
// means a model or a tool owes an answer; both are moments, not states to live
// in. One that has been waiting for hours means the daemon died mid-turn, or
// the answer came back to a process that was gone — the transcript just stops,
// and nothing anywhere reports it. Both checks read the same rule everything
// else reads, ./status.ts `statusOf` over the entries, rather than a second
// copy of it.

import {
  addressed,
  argsOf,
  type Bundle,
  type Comp,
  detached,
  type Graph,
  TOMBSTONE,
  who,
} from '@yaks/graph'
import type { Runs } from '@yaks/graph/tools'
import { human } from '@yaks/id'
import { and, eq, every, present } from '@yaks/query'
import { checked, type Finding } from '@yaks/tools'
import type { Vocab } from '@yaks/vocab'
import { CLAIM, SESSION } from './comp.ts'
import { sessionFor } from './who.ts'
import { ENTRY } from './native.ts'
import { ordered, statusOf } from './status.ts'
import { install, settingsPath } from './hooks.ts'
import type { Options as Reading } from './service.ts'
import { listen } from './listen.ts'

/** What a config file can set for this package: the checks' patience, and how
 * the duty reads transcripts (./service.ts). */
export type Options = Reading & {
  /** how long a transcript may be waiting on a turn or an answer before that
   * counts as a stall rather than work in progress (default 2 hours) */
  hours?: number
}

let HOURS = 2

// A run nothing will resume. `settled` is left out on purpose: it means
// nothing is outstanding, not that the session is over.
let ENDED = ['stopped', 'failed']

let str = (v: unknown): string => v == null ? '' : String(v)

/** The session id a hook payload names, where the command line did not give
 * one. A payload that will not parse returns an empty string, and does so
 * quietly. */
export let hookSession = (hook: unknown): string => {
  try {
    let said = JSON.parse(str(hook)) as { session_id?: unknown }
    return str(said.session_id)
  } catch {
    return ''
  }
}

// The session this call is about, exactly as the caller wrote it: the command
// line's argument, else the one in the hook payload. Resolving it is ./who.ts's
// job — an eid, a human-readable id, or the harness's own id for the run, which
// is the only one of the three that may not exist yet.
let idIn = (args: Record<string, unknown>): string =>
  str(args.session) || hookSession(args.hook)

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

// A session's own account of itself, as the patch that records it.
let briefed = (eid: string, text: unknown): Bundle => ({
  entity: { eid },
  brief: { text: str(text) },
})

/** The session a lock names. */
let holderOf = (b: Bundle): string => str(comp(b, CLAIM).session)

// One transcript's entries. Few sessions hold a lock, so this is queried per
// holder rather than by reading every entry in the graph.
let transcript = (graph: Pick<Graph, 'read'>, session: string) =>
  graph.read(and(eq(`${ENTRY}.session`, session), every()))

// When an entry was written, as the kernel stamps it. A graph that stamps
// nothing has no timestamp to judge a stall by, which the check reports rather
// than passing silently.
let writtenAt = (b: Bundle): number => Date.parse(str(comp(b, 'created').at))

// The session a call speaks for: the one `--session` names, else whoever is
// asking — the actor the caller was authenticated as records which run the
// call came through.
let asking = async (call: Bundle, graph: Graph): Promise<string> => {
  let said = str(argsOf(call).session)
  let session = said
    ? (await sessionFor(graph, said))?.entity.eid
    : str(who(call)?.via || who(call)?.by)
  if (!session) {
    throw new Error(
      said
        ? `no session answers to ${said}`
        : 'nobody is asking — say --session',
    )
  }
  return session
}

/** The implementations behind the tools ./vocab.json declares. The calling
 * application's vocabulary is what the checks name an entity with, and its
 * options are what they judge a stall by. */
export let runs = (
  host: {
    vocab: Vocab
    stopping?: AbortSignal
    config?: { db?: string }
  },
  options: Options = {},
): Runs => ({
  claim_take: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let [on] = await addressed(graph, [str(args.target)])
    return [{
      entity: { eid: on },
      [CLAIM]: { session: await asking(call, graph) },
    }]
  },

  // Stays up until its process stops, so the call is `running` for as long as
  // somebody is listening — the way `serve` is while it answers.
  session_listen: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    // A command run in-process writes as its process, not as the transcript
    // that ran it, so "whoever is asking" may be no session at all — and a
    // listener for nobody is silent, which reads as nothing to hear.
    let session = await asking(call, graph)
    let [row] = await detached(graph.storage).get([session])
    if (!row?.[SESSION]) {
      throw new Error(
        'no session is asking — say --session, for example ' +
          '--session "$CLAUDE_CODE_SESSION_ID"',
      )
    }
    await listen(graph, who(call), session, {
      out: (line) => console.log(line),
      every: 1000 * (Number(args.every) || 2),
      stop: host.stopping,
    })
    return []
  },

  claim_release: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let [on] = await addressed(graph, [str(args.target)])
    return [{ entity: { eid: on }, [CLAIM]: null }]
  },

  session_brief: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let id = idIn(args)
    if (!id) throw new Error('which session? say --session')
    let s = await sessionFor(graph, id)
    // A transcript nobody has created yet is created here, carrying its own
    // name, the way `session_context` reifies one. Never on the word the
    // caller typed: `--session S-37703` is a human id, not an eid, and taking
    // it for one mints an entity whose eid is `S-37703` (./who.ts is what
    // tells the two apart).
    return [
      s ? briefed(s.entity.eid, args.text) : {
        ...briefed('$session', args.text),
        [SESSION]: { id },
      },
    ]
  },

  // The start of the loop: the transcript becomes an entity, and what it
  // holds comes back as the prose the harness injects. Its own id and its
  // locks, and deliberately nothing else — see the head of this file.
  session_context: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let id = idIn(args)
    if (!id) return []
    let found = await sessionFor(graph, id)
    let [actor] = args.actor ? await addressed(graph, [str(args.actor)]) : []
    let eid = found?.entity.eid ?? '$session'
    // A fresh transcript holds nothing: it has no entity yet, so nothing in
    // the graph can name it as a holder.
    let held = minted(eid)
      ? await graph.read(`.${CLAIM}.session=${JSON.stringify(eid)}&*`)
      : []
    return [
      // Only the difference is written back — a transcript's own properties are
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
  session_wrap: async (call, graph): Promise<Bundle[]> => {
    let args = argsOf(call)
    let id = idIn(args)
    let s = id ? await sessionFor(graph, id) : undefined
    if (!s) return []
    let eid = s.entity.eid
    let held = await graph.read(`.${CLAIM}.session=${JSON.stringify(eid)}`)
    return [
      ...(args.brief == null ? [] : [briefed(eid, args.brief)]),
      ...held.map((b): Bundle => ({
        entity: { eid: b.entity.eid },
        [CLAIM]: null,
      })),
    ]
  },

  hooks_install: (call): Bundle[] => {
    let args = argsOf(call)
    return [{
      entity: { eid: '$said' },
      content: {
        body: `${args.remove ? 'removed from' : 'wrote'} ${
          install(str(args.path) || settingsPath(), {
            yak: str(args.yak) || undefined,
            remove: !!args.remove,
          })
        }`,
      },
    }]
  },

  claim_check: async (call, graph) => {
    let id = human(host.vocab)
    // Whole, since a lock is shown by the id its entity's kind gives it.
    let locks = await graph.read(and(present(`${CLAIM}.session`), every()))
    let holders = [...new Set(locks.map(holderOf))]
    let rows = holders.length ? await detached(graph.storage).get(holders) : []
    // A tombstoned holder is a holder that is gone: `claim.session` is declared
    // `death: 'release'`, so a lock still naming one is the same leak.
    let held = new Map(
      rows.filter((b) => b[TOMBSTONE] == null && b[SESSION] != null)
        .map((b) => [b.entity.eid, b]),
    )
    let over = new Map<string, string>()
    for (let eid of held.keys()) {
      let state = statusOf(await transcript(graph, eid))
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
      call.entity.eid,
      'no entity is locked by a session that is over',
      found,
    )
  },

  session_check: async (call, graph) => {
    let id = human(host.vocab)
    let hours = options.hours ?? HOURS
    let cutoff = Date.now() - hours * 3_600_000
    let sessions = await graph.read(and(present(SESSION), every()))
    if (!sessions.length) {
      return checked(call.entity.eid, 'no transcript has stalled', [])
    }
    // One read of the entries, grouped here: a transcript is only readable as
    // a whole, and asking per session would be one query per session.
    let lines = new Map<string, Bundle[]>()
    let stamped = false
    for (let b of await graph.read(and(present(ENTRY), every()))) {
      let of = str(comp(b, ENTRY).session)
      lines.set(of, [...lines.get(of) ?? [], b])
      if (!isNaN(writtenAt(b))) stamped = true
    }
    if (!stamped) {
      return checked(call.entity.eid, 'no transcript has stalled', [{
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
    return checked(call.entity.eid, 'no transcript has stalled', found)
  },
})

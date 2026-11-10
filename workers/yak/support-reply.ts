// The platform's answer in a support thread (support.ts), carried to whoever
// the thread is for (D-152906), so nobody forwards an answer by hand.
//
// An answer TaskMaster writes owes `support_reply`, a run of the platform
// store's pool (facets/directory-vocab.ts), so it is carried after the write
// commits and again until it is taken. Each place it goes keeps it once,
// under an id derived from the message, however often it is sent:
//
//   - the person's Updates in the space the thread was said in, or their own
//     space (directory.ts `own`) where it was said in none: a
//     notification{about: thread} for them, its words linking the thread's
//     page (support-page.ts);
//   - the Operator conversation it came from, when its session is one of
//     that space's Operator sessions and the person's own: a note attributed
//     to TaskMaster, which starts no turn and is there for the next one, as
//     an escalation's answer is (operator-escalate.ts `escalationAnswer`);
//   - otherwise the connector agent it was said through (support.agent): the
//     person's Wire holds it for that agent alone, and its next tool result
//     carries it (stream.ts `Reply`), across reconnects.
//
// A thread said signed out has nobody to carry it to.
import { derivedEid } from '@yaks/graph/identity'
import type { Bundle, Comp } from '@yaks/graph'
import type { Env } from './env.ts'
import type { Meta } from './meta.ts'
import { ownOf, type Row, seatsLine } from './directory.ts'
import { type Message, noted, read, type Thread, told } from './support.ts'
import type { Telling } from './operator-updates.ts'
import type { operatorStore } from './operator-store.ts'

type Store = ReturnType<typeof operatorStore>

/** What a space's Builder is handed to keep: the note for the Operator
 * conversation `session` names, if it is `person`'s, and their Update. */
export type Carried = {
  person: string
  session: string | null
  note: { eid: string; body: string; by: string | null; via: string | null }
  update: Telling
}

/**
 * What `eid` gives the thread's person to hear: a platform message (`m`), a
 * completion said with no message of its own (`{}`), or nothing. A
 * completion written with an answer is told by that answer.
 */
export let carrying = (t: Thread, eid: string): { m?: Message } | null => {
  if (!t.person) return null
  if (eid != t.eid) {
    let m = t.messages.find((m) => m.eid == eid && m.from == 'platform')
    return m ? { m } : null
  }
  let done = t.completed?.at
  if (!done) return null
  return t.messages.some((m) => m.from == 'platform' && (m.at ?? '') >= done)
    ? null
    : {}
}

// The rows of what the Builder is handed, as carrying `eid` makes them.
export let carried = (
  t: Thread,
  eid: string,
  m: Message | undefined,
  env: Env,
): Carried => ({
  person: t.person!,
  session: t.session,
  note: {
    eid,
    body: noted(t, m, env),
    by: m?.by ?? t.completed?.by ?? null,
    via: m?.via ?? null,
  },
  update: {
    to: t.person!,
    words: told(t, m, env),
    about: t.eid,
    ...m?.by ? { by: m.by } : {},
    id: `support|${eid}`,
  },
})

/**
 * Carry what `eid`, a platform message or a completed thread, owes its
 * person. It throws when a place it goes did not take it, so the pool runs
 * it again.
 */
export let carry = async (
  env: Env,
  store: Pick<Meta, 'query'>,
  eid: string,
): Promise<void> => {
  let [row] = await store.query(`.entity.eid=${eid}&?comment`)
  let target = (row?.comment as Comp | undefined)?.target
  let t = await read(store, typeof target == 'string' ? target : eid)
  let what = t && carrying(t, eid)
  if (!t || !what) return
  let c = carried(t, eid, what.m, env)
  let space = t.space ?? await own(store, c.person)
  let heard = space ? await builder(env, space, c) : null
  if (heard) return
  let { owe } = await import('./stream.ts')
  await owe(env, c.person, {
    agent: t.agent ?? '',
    id: eid,
    line: c.note.body,
  })
}

// The person's own space (directory.ts `own`), where a thread said in no
// space tells them, or null for someone with none: never one it mints.
let own = async (store: Pick<Meta, 'query'>, person: string) =>
  ownOf(await store.query(seatsLine(person)) as Row[], person)?.eid ?? null

// The space's Builder, keeping the Update and, where the thread came from
// an Operator conversation of the person's, the note: that conversation's
// session, or null when it came from elsewhere.
let builder = async (env: Env, space: string, c: Carried) => {
  let { builderOf, SPACE } = await import('./build-door.ts')
  let r = await builderOf(env, space)(() =>
    new Request('https://builder/operator/support', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yak-kernel': '1',
        [SPACE]: space,
      },
      body: JSON.stringify(c),
    })
  )
  if (!r.ok) {
    await r.body?.cancel()
    throw new Error(`the Builder did not take the reply (${r.status})`)
  }
  return (await r.json() as { session: string | null }).session
}

// The conversation a session of the person's works for, or null where it is
// no Operator session here, or somebody else's.
let conversation = async (store: Store, session: string, person: string) => {
  let [row] = await store.g.get([session], ['operator_session'])
  let o = row?.operator_session as Comp | undefined
  if (!o || o.person != person) return null
  let { topOf } = await import('./operator.ts')
  return await topOf(store, session)
}

/** The Builder's half: keep the person's Update and, where `session` is an
 * Operator conversation of theirs here, the note in it. */
export let heard = async (
  store: Store,
  c: Carried,
): Promise<{ session: string | null }> => {
  let { notification } = await import('./operator-updates.ts')
  let session = c.session
    ? await conversation(store, c.session, c.person)
    : null
  let rows: Bundle[] = [notification(c.update)]
  if (session) {
    rows.push({
      entity: { eid: derivedEid(`support-note|${c.note.eid}`) },
      entry: { session, from: 'TaskMaster' },
      content: { body: c.note.body },
      // TaskMaster's words, said in one quiet line under where they came
      // from (operator-draw.ts `VIA`), starting no turn.
      notice: {},
      system: {},
      operator_channel: { channel: 'support' },
      ...c.note.by
        ? {
          $actor: { by: c.note.by, ...c.note.via ? { via: c.note.via } : {} },
        }
        : {},
    })
  }
  await store.g.apply(rows, { trusted: true })
  return { session }
}

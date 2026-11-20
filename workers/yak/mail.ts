// Platform letters are rows, as every letter is (@yaks/mail): `mail` writes
// each address its own letter into the directory (mail-config.ts
// `toPlatform`), and the directory's pool sends it once the write commits,
// through the platform's own sender (config.ts, graph.ts `senders`), waiting
// out a mail outage rather than losing the letter. The commit arms the pool
// at once, so a sign-in code leaves as soon as it is written; whoever needs
// to know what became of it reads the letter back (`bounce`).
//
// The write goes through `meta`, which is the directory's own graph when the
// caller runs inside the directory object (a job, meta.ts) and its door from
// anywhere else, never a call to its own stub.
import { line } from '@yaks/query'
import { mint } from '@yaks/graph'
import { type Clock, system } from '@yaks/fp'
import { replyTo } from '@yaks/platform/host'
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import type { Owed } from './operator-channels.ts'
import { FROM, toPlatform } from './mail-config.ts'
import { KERNEL, type Meta, meta } from './meta.ts'
import { type Delivery, transport } from './post.ts'
import { posts } from './config.ts'
export { FROM, INTERNAL, REPLY_TO } from './mail-config.ts'

export type Letter = {
  to: string | string[]
  subject: string
  body: string
  replyTo?: string
  // Who the reader sees it from, where not the platform (signin.ts
  // `codeLetter`, the Operator's).
  name?: string
  // The address it leaves from, where not the platform's: a space's own,
  // whose Operator it is from (@yaks/platform/letters `envelope`). A reply
  // goes there unless `replyTo` says otherwise.
  from?: string
  /** the entity it concerns */
  about?: string
}

type Posting = Pick<Env, 'STORE'> & Partial<Pick<Env, 'META' | 'APEX'>>

/** Whether the platform's sender can send here: the directory's pool sends
 * through the same transport. */
export let mailable = async (env: Delivery) =>
  !!(await transport(env, posts.platform)).sender

/** The rows a letter writes: an address and a letter for each reader, for a
 * caller that writes them beside rows of its own, in one transaction. */
export let letterRows = (
  l: Letter,
  env: Pick<Env, 'APEX'>,
  at = new Date().toISOString(),
) =>
  [...new Set([l.to].flat())].flatMap((to) =>
    toPlatform(to, mint(), {
      subject: l.subject,
      body: l.body,
      about: l.about,
      name: l.name ?? 'yaks.app',
      reply: l.replyTo ?? (l.from ? undefined : replyTo(env)),
      from: l.from ?? FROM,
      at,
    })
  )

/** Write a letter, one for each address it is to; the letters' eids. */
export let mail = (env: Posting) => async (l: Letter): Promise<string[]> => {
  let rows = letterRows(l, env)
  await meta(env).apply(rows, KERNEL)
  return rows.filter((b) => b.deliver).map((b) => b.entity.eid)
}

/** Why a letter bounced, and whether the provider refused its address. */
export type Bounce = { reason: string; refused: boolean }

// How long each look back at a letter waits after the last: about six seconds
// in all, the first at once, since the pool sends as the write commits.
let LOOKS = [0, 25, 50, 100, 200, 400, 800, 1600, 3200]

/** What became of a letter, read back for a few seconds: its bounce, or null
 * once it left, or while it is still on its way. */
export let bounce = async (
  store: Meta,
  eid: string,
  clock: Clock = system,
): Promise<Bounce | null> => {
  for (let wait of LOOKS) {
    await new Promise<void>((done) => clock.after(wait, done))
    let [row] = await store.query(
      line`.entity.eid=${eid}&.mail ?delivered ?bounced`,
    ) as { delivered?: object; bounced?: Partial<Bounce> }[]
    if (row?.bounced) {
      return {
        reason: String(row.bounced.reason ?? ''),
        refused: !!row.bounced.refused,
      }
    }
    if (!row || row.delivered) return null
  }
  return null
}

/**
 * A letter yaks.app owes a person (an invitation, a contact code), written
 * by the Operator of the space it concerns into its own store, whose pool
 * sends it from the space's address, uncounted (operator-channels.ts
 * `owedRows`). A reply to it from anyone reaches the Operator, which a
 * letter only the directory kept could not offer someone who is not yet a
 * member (inbox.ts `replied`). The letter's eid.
 */
export let owe = async (
  env: Env,
  space: Pick<Space, 'eid'>,
  owed: Owed,
): Promise<string> => {
  let { builderOf, SPACE } = await import('./build-door.ts')
  let r = await builderOf(env, space.eid)(() =>
    new Request('https://builder/operator/write', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yak-kernel': '1',
        [SPACE]: space.eid,
      },
      body: JSON.stringify(owed),
    })
  )
  if (!r.ok) {
    throw new Error(`the Operator did not write the letter: ${await r.text()}`)
  }
  return (await r.json() as { letter: string }).letter
}

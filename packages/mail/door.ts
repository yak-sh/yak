/** Inbox email policy and rendering. The graph keeps each queued snapshot;
 * transports and clocks are supplied at the boundary. */
import { type Bundle, type Comp, derivedEid, type Tx } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { readerAt, type Row, type Thread, threads } from '@yaks/inbox'
import {
  candidates,
  dependents,
  discussion,
  requirements,
  words,
} from '@yaks/inbox/queries'
import type { Decision } from '@yaks/task'
import type { Inbox } from './options.ts'

let str = (v: unknown): string => String(v ?? '')
let comp = (b: Bundle, name: string): Comp => b[name] as Comp ?? {}
let rows = (bundles: Bundle[]): Row[] =>
  bundles.map((b) => ({
    eid: b.entity.eid,
    comps: Object.fromEntries(
      Object.entries(b).filter(([k, v]) =>
        k != 'entity' && v && typeof v == 'object'
      ),
    ) as Row['comps'],
  }))
let link = (options: Inbox, eid: string) =>
  `${options.base.replace(/\/$/, '')}/${encodeURIComponent(eid)}`
let reply = (options: Inbox, eid: string) =>
  `${eid}@${options.from.split('@')[1]}`

/** Each door reads the same policy, including mute, archive and blockers. */
export let inboxAt = async (
  tx: Pick<Tx, 'get' | 'read'>,
  vocab: Vocab,
  who: string,
): Promise<Thread[]> => {
  let has = words(vocab)
  let person = rows(await tx.get([who]))
  let subs = has('subscription')
    ? rows(await tx.read(`.subscription.actor=${JSON.stringify(who)}&*`))
    : []
  let reader = readerAt([...person, ...subs], who)
  let read = async (query: string) => query ? rows(await tx.read(query)) : []
  let first = await read(candidates(reader, has))
  let second = await read(discussion(first, has))
  let edges = await read(requirements([...first, ...second], has))
  let tasks = await read(dependents(edges, has))
  return threads([...first, ...second, ...edges, ...tasks], reader)
}

/** Only outstanding needs and replies cross this door by default. */
export let eligible = (thread: Thread, options: Inbox): boolean =>
  thread.unread &&
  (thread.reason == 'alert'
    ? options.alerts == true
    : thread.lane == 'Updates'
    ? options.updates == true
    : thread.lane == 'Needs you' || thread.lane == 'Replies')

/** A thread's question, numbered choices and latest words, in mail-safe markdown. */
export let rendered = (thread: Thread, options: Inbox): string => {
  let root = thread.row.comps
  let d = root.decision as Decision | undefined
  let latest = thread.latest.comps
  let choices = d?.choices.map((c, i) =>
    `${i + 1}. ${c.label}: ${c.description}${
      c.label == d.recommended ? ' (recommended)' : ''
    }`
  ).join('\n')
  return [
    d?.question || str(root.doc?.title) || 'Inbox thread',
    choices,
    d ? 'Reply with a choice number or your own answer.' : '',
    str(latest.doc?.body || latest.content?.body || root.doc?.body),
    `Open thread: ${link(options, thread.eid)}`,
    `Reply to this thread: ${
      reply(
        options,
        thread.latest.comps.comment ? thread.latest.eid : thread.eid,
      )
    }`,
  ].filter(Boolean).join('\n\n')
}

let letter = (
  eid: string,
  options: Inbox,
  at: string,
  title: string,
  body: string,
): Bundle => ({
  entity: { eid },
  doc: { title, body },
  mail: { from: options.from, at },
  deliver: { to: options.person },
  mail_notice: { activity: at },
})

/** Pure queue plan. Notices are snapshots of activity, never new inbox activity.
 * The queued letter, not a second cursor, is the durable deduplication record. */
export let planned = (
  inbox: Thread[],
  notices: Bundle[],
  options: Inbox,
  now: string,
  daily = false,
): Bundle[] => {
  let pending = inbox.filter((t) => eligible(t, options))
  let through = (target: string) =>
    notices.filter((n) =>
      comp(n, 'deliver').to == options.person &&
      (comp(n, 'mail').target == target ||
        comp(n, 'mail_notice').thread == target)
    ).map((n) => str(comp(n, 'mail_notice').activity)).sort().at(-1) ?? ''
  let out = pending.filter((t) =>
    t.blocking && t.row.comps.decision &&
    !notices.some((n) =>
      comp(n, 'mail').target == t.eid &&
      comp(n, 'mail_notice').activity == t.at
    )
  ).map(
    (t) => {
      let eid = derivedEid(`mail-inbox|${options.person}|${t.eid}|${t.at}`)
      let previous = notices.filter((n) =>
        comp(n, 'deliver').to == options.person &&
        comp(n, 'mail').target == t.eid
      ).sort((a, b) =>
        str(comp(a, 'mail').at).localeCompare(str(comp(b, 'mail').at))
      )
        .at(-1)
      let b = letter(
        eid,
        options,
        t.at,
        str(t.row.comps.doc?.title) ||
          'Decision needed',
        rendered(t, options),
      )
      b.mail = {
        ...comp(b, 'mail'),
        target: t.eid,
        ...(previous ? { reply_to: previous.entity.eid } : {}),
      }
      b.mail_notice = {
        activity: t.at,
        ...(t.latest.comps.comment ? { comment: t.latest.eid } : {}),
      }
      return b
    },
  )
  let day = now.slice(0, 10)
  let digest = derivedEid(`mail-digest|${options.person}|${day}`)
  let others = pending.filter((t) =>
    t.at > through(t.eid) &&
    !(t.blocking && t.row.comps.decision)
  )
  if (daily && others.length && !notices.some((n) => n.entity.eid == digest)) {
    out.push(
      letter(
        digest,
        options,
        now,
        'Your inbox',
        others.map((t) =>
          `## ${str(t.row.comps.doc?.title) || 'Inbox thread'}\n\n${
            rendered(t, options)
          }`
        ).join('\n\n---\n\n') +
          '\n\nUse each thread’s reply address above; replying to this digest ' +
          'does not choose a thread.',
      ),
    )
    out.push(...others.map((t) => ({
      entity: { eid: derivedEid(`mail-digest-thread|${digest}|${t.eid}`) },
      mail_notice: { activity: t.at, thread: t.eid, letter: digest },
      deliver: { to: options.person },
    })))
  }
  return out
}

/** Read and write at the boundary. Replays find the same queued letters. */
export let queue = async (
  tx: Pick<Tx, 'get' | 'read'>,
  vocab: Vocab,
  options: Inbox,
  write: (bundles: Bundle[]) => unknown,
  now: string = new Date().toISOString(),
  daily = false,
): Promise<void> => {
  let inbox = await inboxAt(tx, vocab, options.person)
  let notices = await tx.read(
    `.mail_notice&.deliver.to=${JSON.stringify(options.person)}&*`,
  )
  let bundles = planned(inbox, notices, options, now, daily)
  let existing = new Set((await tx.get(bundles.map((b) => b.entity.eid)))
    .map((b) => b.entity.eid))
  let fresh = bundles.filter((b) => !existing.has(b.entity.eid))
  if (fresh.length) await write(fresh)
}

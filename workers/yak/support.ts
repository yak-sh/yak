// A support thread: what somebody told yaks.app through `feedback`, kept as a
// conversation TaskMaster answers in the same place (D-152906).
//
// The thread is one entity in the platform's store: conversation{} marks it,
// doc{title, body} holds the words that opened it, report{app, space, version,
// release, at} where they stood, and support{person, session, call} whose it
// is and the run it came from, as the caller's credential said. Every later
// message is a comment{target, reply_to} on it with its words in doc{body}. A
// message from the thread's side wears support{} too; one without it is the
// platform's answer, which may link the fix it names by an about edge. The
// fix is an entity in the box's graph, which this store cannot read, so the
// answer keeps beside the edge, at the fix's own eid, what a person reads of
// it as the box said it: commit{message} for a commit, whose eid is its sha,
// and doc{title} for anything else. An explicit outcome is
// completed{at, by, via} on the thread.
//
// Each message from the thread's side owes TaskMaster a letter, written in
// the same batch as the words: @yaks/mail's mail_post sends it after the write
// commits, from the platform's own sender (config.ts), and marks it delivered
// only once the sender took it. So a mail outage leaves the letter waiting
// beside words that were never at risk. A thread or message said in a recorded
// tool call takes its eid from that call, and its letter from it, so the same
// call run again lands on the same rows and owes no second letter.
//
// The bundles are made here as values; `open`, `say` (and `adding`, a
// person's words with their letter), `answer` and `read` are the only doors
// to the store, and `opens` the one decision about who reads. The feedback
// tool and the thread's page (support-page.ts) both go through them, and
// each platform answer is carried to whoever the thread is for
// (support-reply.ts).
import { type Bundle, mint } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { link as linked } from '@yaks/edge'
import { KERNEL, type Meta } from './meta.ts'
import { toPlatform } from './mail-config.ts'
import { type Host, replyTo, url as hostUrl } from '@yaks/platform/host'
import { isTestAddress } from '@yaks/platform/bots'
import { REPO } from '@yaks/platform/names'
import type { Directory } from './directory.ts'
import { admin } from './tool.ts'
import { caught } from './defects.ts'
import { VERSION } from './running.ts'

/** Where a thread is read in a browser: `link`. */
export let SUPPORT = '/support'

/** What was said, by whom and from where: the caller's credential, never
 * anything they typed, fills `person`, `session`, `call` and `agent`. */
export type Said = {
  words: string
  person?: string | null
  session?: string | null
  call?: string | null
  /** the connector client it was said through, by the name it gave at
   * connect: whose next tool result carries the platform's answers */
  agent?: string | null
}

/** Where they stood when they opened a thread. */
export type Standing = {
  space?: string | null
  app?: string | null
  version?: number | null
  release: string
  at: string
}

/** One message in a thread. `from` says which side wrote it. */
export type Message = {
  eid: string
  words: string
  from: 'person' | 'platform'
  by: string | null
  via: string | null
  at: string | null
  reply_to: string | null
  person: string | null
  session: string | null
  call: string | null
  fixes: Fix[]
}

/** A fix one answer links, as a person reads it: its title, and the page of
 * the commit in the public repository where it is a commit. A fix linked with
 * nothing kept of it has no title, and is said by its id. */
export type Fix = { eid: string; title: string | null; href: string | null }

/** A thread as read: its opening words and context, every message after them
 * oldest first, and its outcome. */
export type Thread = {
  eid: string
  title: string
  words: string
  person: string | null
  session: string | null
  call: string | null
  agent: string | null
  space: string | null
  app: string | null
  version: number | null
  release: string | null
  at: string | null
  completed: { at: string | null; by: string | null } | null
  messages: Message[]
}

/** The letter a message owes TaskMaster: its subject and the lines under the
 * words. */
export type Letter = { subject: string; lines: string[] }

type Row = Record<string, unknown>

// A reference as a store answers it: its eid, or an object naming one.
let ref = (v: unknown): string | null =>
  typeof v == 'string'
    ? v
    : v && typeof v == 'object' && typeof (v as Row).eid == 'string'
    ? (v as Row).eid as string
    : null
let comp = (b: Bundle, name: string): Row => (b[name] ?? {}) as Row
let str = (v: unknown) => typeof v == 'string' ? v : null

let derived = (kind: string, of: string) =>
  derivedEid(JSON.stringify([`support-${kind}`, of]))

/// title('The board scrolls sideways.\nAnd more.') -> 'The board scrolls sideways.'
/** A thread's title: the first line of what opened it. */
export let title = (words: string) => words.trim().split('\n')[0].slice(0, 80)

/** Where a person reads a thread. */
export let link = (env: Host, thread: string) =>
  hostUrl(env, `${SUPPORT}/${thread}`)

let supportOf = (said: Said) => ({
  person: said.person ?? null,
  session: said.session ?? null,
  call: said.call ?? null,
  agent: said.agent ?? null,
})

// The letter a message owes, its eid following the message's, ending with
// the thread and how TaskMaster answers in it.
let letterRows = (
  env: Host,
  thread: string,
  about: string,
  words: string,
  letter: Letter,
): Bundle[] => {
  let lines = [
    ...letter.lines,
    `thread ${thread}`,
    `answer: yak admin support ${thread} '<reply>' [--fix <id>] [--complete]`,
  ]
  return toPlatform(replyTo(env), derived('letter', about), {
    subject: letter.subject,
    body: `${words.trim()}\n\n—\n${lines.join('\n')}`,
    about,
  })
}

/** The rows that open a thread, and the letter it owes unless `letter` is
 * null (a test account's words go nowhere). */
export let opening = (
  env: Host,
  said: Said,
  where: Standing,
  letter: Letter | null,
): Bundle[] => {
  let eid = said.call ? derived('thread', said.call) : mint()
  let thread: Bundle = {
    entity: { eid },
    conversation: {},
    doc: { title: title(said.words), body: said.words },
    report: {
      app: where.app ?? null,
      space: where.space ?? null,
      version: where.version ?? null,
      release: where.release,
      at: where.at,
    },
    support: supportOf(said),
  }
  return [
    thread,
    ...letter ? letterRows(env, eid, eid, said.words, letter) : [],
  ]
}

/** The rows that add a message from the thread's side, and its letter. The
 * message reopens a thread the platform completed: whoever writes again is
 * not done, so it waits for TaskMaster again (`waiting`, T-153274). */
export let saying = (
  env: Host,
  thread: string,
  said: Said,
  letter: Letter | null,
): Bundle[] => {
  let eid = said.call ? derived('message', said.call) : mint()
  return [
    {
      entity: { eid },
      comment: { target: thread },
      doc: { body: said.words },
      support: supportOf(said),
    },
    { entity: { eid: thread }, completed: null },
    ...letter ? letterRows(env, thread, eid, said.words, letter) : [],
  ]
}

/** The fix an answer links, as the box's graph holds it: a commit's whole
 * message, or any other entity's title. */
export type Fixing = {
  eid: string
  message?: string | null
  title?: string | null
}

/** What the platform answers: its words, the message it answers, the fix it
 * names and whether the thread is done. */
export type Answer = {
  words?: string
  reply_to?: string | null
  fix?: Fixing | null
  complete?: boolean
}

/// subject('T-1 Wrap the board\n\nAnd why.') -> 'T-1 Wrap the board'
/** A commit's title: the first line of its message. */
export let subject = (message: string) => message.trim().split('\n')[0]

/** A fix as a person reads it, out of its row in this store, if one is
 * kept. */
export let fixOf = (eid: string, row: Bundle = { entity: { eid } }): Fix => {
  let message = str(comp(row, 'commit').message)
  return {
    eid,
    title: message != null ? subject(message) : str(comp(row, 'doc').title),
    href: row.commit ? `${REPO}/commit/${eid}` : null,
  }
}

/// named({ eid: 'f', title: 'Wrap', href: null }) -> 'Wrap'
/// named({ eid: 'f', title: null, href: null }) -> 'f'
/** A fix in words: its title, or its id where nothing is kept of it. */
export let named = (f: Fix) => f.title ?? f.eid

/** A fix in words with where it is read, for a reader with no links. */
export let spelled = (f: Fix) => f.href ? `${named(f)} (${f.href})` : named(f)

/** A fix in Markdown: its title, linked to its commit. */
export let marked = (f: Fix) => f.href ? `[${named(f)}](${f.href})` : named(f)

/** The rows of the platform's answer, `eid` the message's: a message
 * without support{}, an about edge from it to the fix, and the thread's
 * completed mark. Words or a fix make a message; completing alone does not. */
export let answering = (
  thread: string,
  a: Answer,
  eid: string = mint(),
): Bundle[] => {
  let words = a.words?.trim() ?? '', fix = a.fix
  let kept: Bundle | undefined = !fix
    ? undefined
    : fix.message
    ? { entity: { eid: fix.eid }, commit: { message: fix.message } }
    : fix.title
    ? { entity: { eid: fix.eid }, doc: { title: fix.title } }
    : undefined
  return [
    ...words || fix
      ? [{
        entity: { eid },
        comment: { target: thread, reply_to: a.reply_to ?? null },
        doc: { body: words || `Fixed: ${named(fixOf(fix!.eid, kept))}` },
      }]
      : [],
    ...fix ? [linked(eid, 'about', fix.eid)] : [],
    ...kept ? [kept] : [],
    ...a.complete ? [{ entity: { eid: thread }, completed: {} }] : [],
  ]
}

/** A thread and its messages as rows read them, with the about edges from
 * its messages and the rows kept of their fixes. */
export let threadOf = (
  row: Bundle,
  messages: Bundle[],
  edges: Bundle[],
  kept: Bundle[] = [],
): Thread => {
  let doc = comp(row, 'doc'), report = comp(row, 'report')
  let support = comp(row, 'support'), done = row.completed as Row | undefined
  let fixes = (eid: string) =>
    edges.filter((e) => ref(comp(e, 'edge').from) == eid)
      .flatMap((e) => ref(comp(e, 'edge').to) ?? [])
      .map((to) => fixOf(to, kept.find((k) => k.entity.eid == to)))
  return {
    eid: row.entity.eid,
    title: str(doc.title) ?? '',
    words: str(doc.body) ?? '',
    person: ref(support.person),
    session: ref(support.session),
    call: ref(support.call),
    agent: str(support.agent),
    space: ref(report.space),
    app: ref(report.app),
    version: typeof report.version == 'number' ? report.version : null,
    release: str(report.release),
    at: str(report.at),
    completed: done ? { at: str(done.at), by: ref(done.by) } : null,
    messages: messages.map((m) => {
      let said = m.support as Row | undefined
      return {
        eid: m.entity.eid,
        words: str(comp(m, 'doc').body) ?? '',
        from: said ? 'person' : 'platform',
        by: ref(comp(m, 'created').by),
        via: ref(comp(m, 'created').via),
        at: str(comp(m, 'created').at),
        reply_to: ref(comp(m, 'comment').reply_to),
        person: ref(said?.person),
        session: ref(said?.session),
        call: ref(said?.call),
        fixes: fixes(m.entity.eid),
      }
    }),
  }
}

/** Who asks to read a thread: the person their credential names (empty
 * signed out), the one space a narrowed credential opens, and the
 * directory's answers about them. */
export type Asking = {
  person: string
  narrowed?: string | null
  member: (space: string) => Promise<boolean>
  admin: () => Promise<boolean>
}

/**
 * Whether a thread opens to this caller: the person it is theirs, a member of
 * the space it was said in today, or the platform's admin; never anybody
 * signed out, and a credential narrowed to one space reaches only that
 * space's threads, admin or not.
 */
export let opens = async (t: Thread, a: Asking): Promise<boolean> => {
  if (!a.person) return false
  if (a.narrowed && a.narrowed != t.space) return false
  if (t.person && t.person == a.person) return true
  if (t.space && await a.member(t.space)) return true
  return await a.admin()
}

let THREAD = '.conversation&.report&?doc&?support&?completed&?created'

/** A thread by its eid, or null where there is none. */
export let read = async (
  store: Pick<Meta, 'query'>,
  eid: string,
): Promise<Thread | null> => {
  let [row] = await store.query(`.entity.eid=${eid}&${THREAD}`)
  if (!row) return null
  let messages = await store.query(
    `.comment.target=${eid}&?doc&?support&?created&.order=created.at`,
  )
  let edges = messages.length
    ? await store.query(
      `.about&.edge.from=${messages.map((m) => m.entity.eid).join(',')}`,
    )
    : []
  let to = [...new Set(edges.flatMap((e) => ref(comp(e, 'edge').to) ?? []))]
  let kept = to.length
    ? await store.query(`.entity.eid=${to.join(',')}&?commit&?doc`)
    : []
  return threadOf(row, messages, edges, kept)
}

/** The threads the platform has not completed, newest first. */
export let waiting = async (store: Meta, limit = 20): Promise<Thread[]> =>
  (await store.query(
    `${THREAD}&!completed&.order=-created.at&.limit=${limit}`,
  )).map((row) => threadOf(row, [], []))

// The batch written as the platform about its own words: support{} is
// server-owned, so only this door writes it.
let write = (store: Meta, rows: Bundle[], headers: Record<string, string>) =>
  store.apply(rows, { ...headers, ...KERNEL })

/** Open a thread; its eid. `headers` vouch for the writer. */
export let open = async (
  store: Meta,
  env: Host,
  said: Said,
  where: Standing,
  letter: Letter | null,
  headers: Record<string, string>,
): Promise<string> => {
  let rows = opening(env, said, where, letter)
  await write(store, rows, headers)
  return rows[0].entity.eid
}

/** Add a message from the thread's side; its eid. */
export let say = async (
  store: Meta,
  env: Host,
  thread: string,
  said: Said,
  letter: Letter | null,
  headers: Record<string, string>,
): Promise<string> => {
  let rows = saying(env, thread, said, letter)
  await write(store, rows, headers)
  return rows[0].entity.eid
}

/** Write the platform's answer; the new message's eid, if it wrote one. */
export let answer = async (
  store: Meta,
  thread: string,
  a: Answer,
  headers: Record<string, string>,
): Promise<string | null> => {
  let rows = answering(thread, a)
  if (rows.length) await write(store, rows, headers)
  return rows[0]?.comment ? rows[0].entity.eid : null
}

/** A thread as words: what opened it, each message after it, and how it
 * stands. `me` is the person reading, whose own words read as theirs; the
 * platform reads every message's id, which its answer names in reply_to. */
export let transcript = (
  t: Thread,
  me?: string | null,
  ids = false,
): string => {
  let who = (m: { from: string; person: string | null }) =>
    m.from == 'platform'
      ? 'yaks.app'
      : m.person && m.person == me
      ? 'you'
      : 'they'
  let when = (at: string | null) => at ? ` (${at})` : ''
  let id = (eid: string) => ids ? ` [${eid}]` : ''
  return [
    `Thread ${t.eid}: ${t.title}`,
    `${who({ from: 'person', person: t.person })}${when(t.at)}: ${t.words}`,
    ...t.messages.map((m) =>
      `${who(m)}${when(m.at)}${id(m.eid)}: ${m.words}` +
      (m.fixes.length
        ? `\n  fix: ${
          m.fixes.map((f) => ids ? `${spelled(f)} [${f.eid}]` : spelled(f))
            .join(', ')
        }`
        : '')
    ),
    t.completed
      ? `Completed${when(t.completed.at)}.`
      : t.messages.some((m) => m.from == 'platform')
      ? 'Open: answered, not yet completed.'
      : 'Open: not answered yet.',
  ].join('\n\n')
}

/** Where a thread came from, as the platform reads it: whose, which space
 * and app at which versions, and the run and call it was said in. */
export let context = (t: Thread): string =>
  [
    ['person', t.person ?? 'signed out'],
    ['space', t.space],
    ['app', t.app && `${t.app}${t.version ? ` v${t.version}` : ''}`],
    ['release', t.release],
    ['session', t.session],
    ['agent', t.agent],
    ['call', t.call],
  ].flatMap(([k, v]) => v ? [`${k} ${v}`] : []).join(' · ')

/** A thread as data, as a tool's value carries it. */
export let valueOf = (t: Thread, env: Host) => ({
  thread: t.eid,
  link: link(env, t.eid),
  title: t.title,
  words: t.words,
  at: t.at,
  completed: t.completed,
  messages: t.messages.map((m) => ({
    message: m.eid,
    from: m.from,
    words: m.words,
    at: m.at,
    reply_to: m.reply_to,
    fixes: m.fixes.map((f) => f.eid),
  })),
})

/** The platform's answer `m` (none: the thread was only marked completed),
 * as the agent the thread came from hears it: its Operator, as a note, or a
 * connector, beside its next tool result (support-reply.ts). */
export let noted = (t: Thread, m: Message | undefined, env: Host): string =>
  [
    m
      ? `TaskMaster answered for yaks.app in the support thread “${t.title}” (thread ${t.eid}), opened with feedback: ${m.words}`
      : `TaskMaster marked the support thread “${t.title}” (thread ${t.eid}) completed.`,
    ...m?.fixes.length ? [`Fix: ${m.fixes.map(spelled).join(', ')}.`] : [],
    ...m ? [t.completed ? 'It is marked completed.' : 'It is still open.'] : [],
    `Read the whole thread with feedback(thread: '${t.eid}'), or at ${
      link(env, t.eid)
    }.`,
  ].join(' ')

/** The same, as the person reads it in their Updates: in Markdown, with
 * the way to the whole thread and how it stands. */
export let told = (t: Thread, m: Message | undefined, env: Host): string =>
  [
    m
      ? `yaks.app answered your feedback “${t.title}”: ${m.words}`
      : `yaks.app marked your feedback “${t.title}” done.`,
    [
      ...m?.fixes.length ? [`Fix: ${m.fixes.map(marked).join(', ')}.`] : [],
      ...m && t.completed ? ['It is marked done.'] : [],
      `[Read the thread](${link(env, t.eid)})`,
    ].join(' '),
  ].join('\n\n')

/** Who asks to read a thread, as a door that holds the directory asks it:
 * `person` signed in, narrowed to one space or none. */
export let asking = (
  dir: Directory,
  person: string,
  narrowed: string | null = null,
): Asking => ({
  person,
  narrowed,
  member: async (space) => {
    let at = await dir.at(space)
    return !!at && !!await dir.role(at, person)
  },
  admin: () => admin({ dir, person }),
})

/** How many messages one person adds to threads in an hour. A conversation
 * needs more turns than reports need openings, and each one still mails a
 * person. */
export let SAYS = 12

/** What `person` has added to threads this hour, out of the store itself.
 * A store that cannot answer counts nothing: a limit is never the reason
 * words are lost. */
export let lately = async (store: Meta, person: string): Promise<number> => {
  try {
    return (await store.query(
      `.comment&.support.person=${person}&.created.at>=1-hour-ago`,
    )).length
  } catch (e) {
    caught(e, { request: 'support lately' })
    return 0
  }
}

/** Who said it, on the letter, and whether a letter goes at all: a test
 * account's words are kept and go nowhere (@yaks/platform/bots), since a
 * letter is a thing a person has to read. Nobody signed in is said plainly,
 * so a reader knows there is no address to answer. */
export let signer = async (
  dir: Pick<Directory, 'nameAt' | 'emailAt'>,
  person: string | null | undefined,
) => {
  let by = person ? await dir.nameAt(person) : null
  let email = person ? await dir.emailAt(person) : null
  return {
    email,
    test: isTestAddress(email ?? ''),
    from: person
      ? `${by ?? 'someone'}${email ? ` <${email}>` : ''}`
      : 'someone, signed out',
  }
}

/** Add a person's words to a thread, as the feedback tool and the thread's
 * page both do, with the letter TaskMaster is owed; the message's eid. */
export let adding = async (
  store: Meta,
  env: Host,
  dir: Pick<Directory, 'nameAt' | 'emailAt'>,
  t: Thread,
  said: Said,
  headers: Record<string, string>,
): Promise<string> => {
  let me = await signer(dir, said.person)
  return await say(
    store,
    env,
    t.eid,
    said,
    me.test ? null : {
      subject: `feedback: ${t.title}`,
      lines: [me.from, `yaks.app ${VERSION} · ${new Date().toISOString()}`],
    },
    headers,
  )
}

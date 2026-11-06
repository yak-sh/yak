import { updating } from './operator-updates.ts'
import type { Bundle, Graph } from '@yaks/graph'
import { draftEid } from '@yaks/draft'
import { enqueue } from '@yaks/effects'
import { derivedEid } from '@yaks/graph/identity'
import { ownerOf, owns } from './operator-access.ts'
import type { Held } from './build-door.ts'
import { type Operator, readOperator } from './operator.ts'
import {
  letterOf,
  receive,
  type Request,
  rootOf,
  textOf,
} from './operator-channels.ts'
import { phoneTexts } from './phone-move.ts'
import { channeled } from './channel-move.ts'
import type { operatorStore } from './operator-store.ts'
import { transcript } from '@yaks/session'
import { stepOf } from '@yaks/tools/title'
import type { Tool } from '@yaks/model'
import {
  type Changed,
  changed,
  frame,
  type Helper,
  helperFrame,
  type Names,
  type Offers,
  type Seen,
  stateOf,
  talk,
  type Worked,
} from './operator-view.ts'

type Store = ReturnType<typeof operatorStore>
let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Record<string, unknown> | undefined

/** What to call a person: directory `nameAt`. */
export type Named = (person: string) => Promise<string | null>

// Nobody known by name: a call says its step without one.
let nameless: Named = () => Promise.resolve(null)

// The person a transcript's sessions work for, by what they are called.
let personOf = async (store: Store, entries: Bundle[], named: Named) => {
  let sessions = await store.g.get([
    ...new Set(entries.map((b) => String(comp(b, 'entry')?.session ?? ''))),
  ].filter(Boolean))
  let person = sessions.map((b) => comp(b, 'operator_session')?.person)
    .find(Boolean)
  return person ? await named(String(person)) : null
}

// How each call in a transcript reads to the person it works for, by its
// tool's step (`call.to` is a tool's eid).
let namesOf = async (
  store: Store,
  entries: Bundle[],
  named: Named,
): Promise<Names> => {
  let tools = await store.g.get([
    ...new Set(
      entries.flatMap((b) => b.call ? [String(comp(b, 'call')!.to)] : []),
    ),
  ])
  let held = new Map(
    tools.filter(Boolean).map((b) => [b.entity.eid, comp(b, 'tool') ?? {}]),
  )
  let person = await personOf(store, entries, named)
  let known = person ? { person } : undefined
  return (tool, args) =>
    stepOf(held.get(tool) ?? { title: 'Use a tool' }, args, known)
}

// A task's sessions, oldest first.
let sessionsOf = async (store: Store, task: string) => {
  let links = await store.g.read(`.contains .edge.from=${task}`)
  return (await store.g.get(links.map((b) => String(comp(b, 'edge')!.to))))
    .filter((b) => b?.session)
    .sort((a, b) =>
      String(comp(a, 'created')?.at).localeCompare(
        String(comp(b, 'created')?.at),
      )
    )
}

let entriesOf = async (store: Store, sessions: Bundle[]) =>
  (await Promise.all(sessions.map((b) => transcript(store.g, b.entity.eid))))
    .flat()

// The helpers these sessions started, each with the call that started it and
// its own lines (a fork's, without the conversation it was forked from).
// `calls`, when given, keeps only the helpers started by the calls drawn.
let helpersOf = async (
  store: Store,
  sessions: Bundle[],
  calls?: Set<string>,
): Promise<Helper[]> => {
  let children = (await Promise.all(
    sessions.map((b) => store.g.read(`.spawned.parent=${b.entity.eid}`)),
  )).flat().filter((b) => !calls || calls.has(String(comp(b, 'spawned')?.call)))
  return await Promise.all(children.map(async (b) => ({
    call: comp(b, 'spawned')?.call as string | undefined,
    entries: await linesOf(store, b.entity.eid, SHOWN),
  })))
}

// A session's own newest lines, oldest first: never the conversation a fork
// was forked from, and never the whole of one that has run for weeks.
let linesOf = async (store: Store, session: string, most: number) =>
  (await store.g.read(
    `.entry.session=${session}&.order=-entry.seq&.limit=${most}&*`,
  )).reverse()
// The helpers these calls started, each with its own lines.
let helpersBy = async (store: Store, calls: Set<string>): Promise<Helper[]> =>
  calls.size
    ? await Promise.all(
      (await store.g.read(`.spawned.call=${[...calls].join(',')}`)).map(
        async (b) => ({
          call: comp(b, 'spawned')?.call as string | undefined,
          entries: await linesOf(store, b.entity.eid, SHOWN),
        }),
      ),
    )
    : []
// What a helper was started with: its first lines.
let openingOf = (store: Store, session: string) =>
  store.g.read(`.entry.session=${session}&.order=entry.seq&.limit=3&*`)
// The newest lines a conversation draws: a long one is read from its end.
let SHOWN = 300
// The newest lines that say what a session is doing, and what a step changed.
let TAIL = 60

// The tool offers these transcripts' asks name, by their sha.
let offersOf = async (store: Store, entries: Bundle[]): Promise<Offers> => {
  let named = new Set(
    entries.flatMap((b) => {
      let offer = comp(b, 'sending')?.offer
      return b.ask && typeof offer == 'string' ? [offer] : []
    }),
  )
  let rows = await store.g.get([...named])
  return new Map(
    rows.filter((b) => b?.offer).map((b) => [
      b.entity.eid,
      comp(b, 'offer')!.tools as Tool[],
    ]),
  )
}

// What a conversation draws beside its sessions' transcripts.
let seenOf = async (
  store: Store,
  sessions: Bundle[],
  entries: Bundle[],
  calls?: Set<string>,
) => {
  let helpers = await helpersOf(store, sessions, calls)
  return {
    helpers,
    offers: await offersOf(store, [
      ...entries,
      ...helpers.flatMap((h) => h.entries),
    ]),
  }
}

// The apps a conversation changed: in its own lines and its helpers'.
let changedIn = (entries: Bundle[], seen: Seen) =>
  changed([...entries, ...(seen.helpers ?? []).flatMap((h) => h.entries)])

// The task holding a session, by the link a task keeps to it.
let holding = async (store: Store, session: string) => {
  let [link] = await store.g.read(`.contains .edge.to=${session}`)
  return String(comp(link, 'edge')?.from ?? '')
}

let REQUESTS =
  '.operator_request ?doc ?failed ?created .order=-created.at .limit=100'

/** Requests with the newest answer each was given, and whether that answer
 * reached them, as one row each: an answer is its own row
 * (`operator_answer{request}`), or, from before, kept on its request. One
 * carried by another (`with`) reached them as that one did. */
export let answering = async (store: Store, requests: Bundle[]) => {
  if (!requests.length) return requests
  let read = await store.g.read(
    `.operator_answer.request=${
      requests.map((r) => r.entity.eid).join(',')
    } ?delivered ?bounced .order=created.at`,
  )
  let carriers = new Map(
    (await store.g.get([
      ...new Set(read.flatMap((a) => {
        let w = comp(a, 'operator_answer')!.with
        return w ? [String(w)] : []
      })),
    ])).filter(Boolean).map((b) => [b.entity.eid, b]),
  )
  let answers = read.map((a) => {
    let c = carriers.get(String(comp(a, 'operator_answer')!.with))
    return c
      ? {
        ...a,
        ...c.delivered ? { delivered: c.delivered } : {},
        ...c.bounced ? { bounced: c.bounced } : {},
      }
      : a
  })
  let newest = new Map(
    answers.map((a) => [String(comp(a, 'operator_answer')!.request), a]),
  )
  let kept = await store.g.get(
    requests.filter((r) => !newest.has(r.entity.eid)).map((r) => r.entity.eid),
  )
  let own = new Map(kept.filter(Boolean).map((b) => [b.entity.eid, b]))
  return requests.map((r) => {
    let a = newest.get(r.entity.eid) ?? own.get(r.entity.eid)
    return a?.operator_answer
      ? {
        ...r,
        operator_answer: a.operator_answer,
        ...a.delivered ? { delivered: a.delivered } : {},
        ...a.bounced ? { bounced: a.bounced } : {},
      }
      : r
  })
}
let requested = async (store: Store, query = REQUESTS) =>
  answering(store, await store.g.read(query))

// What the chat app opens a session by: the task holding it, or the session
// itself when it is a person's conversation or a helper of one.
let keyOf = async (store: Store, session: string) =>
  await holding(store, session) || session

// The conversation a request was taken up by: the task its answer names, or
// the task or conversation holding the session it went to.
let taskOf = async (store: Store, request: Bundle) => {
  let named = comp(request, 'operator_answer')?.task
  if (named) return String(named)
  let session = comp(request, 'operator_request')?.session
  return session ? await keyOf(store, String(session)) : ''
}

// A request no task has taken yet, named by its first line.
let firstLine = (request: Bundle) =>
  String(comp(request, 'doc')?.body ?? '').split('\n')[0].slice(0, 80) ||
  'A request'

let taken = (requests: Bundle[]) =>
  requests.filter((r) =>
    !comp(r, 'operator_request')?.session && !comp(r, 'operator_answer')?.task
  )

// What a helper was asked, in a line: the words it was started with.
let askedOf = (entries: Bundle[]) =>
  String(
    comp(entries.find((b) => !b.prompt && b.content), 'content')?.body ?? '',
  ).split('\n')[0].slice(0, 80) || 'A piece of work'

/** What the chat app calls a person's conversation with the Operator. */
export let CONVERSATION = 'Conversation'

let busy = (state: string) =>
  state == 'Working on it' || state == 'Waiting to start'

// The conversations these list: `person`'s own, or, for the platform's admin
// (`everyone`), every person's with this space's Operator, each called by
// whose it is.
let conversationsOf = async (
  store: Store,
  space: string,
  person: string,
  everyone?: Named,
) => {
  if (!everyone) {
    let root = rootOf(space, person)
    let [held] = await store.g.get([root])
    return held?.session && await owns(store, root, { person, space })
      ? [{ root, title: CONVERSATION }]
      : []
  }
  let held = (await store.g.read('.operator_session ?spawned')).filter((b) =>
    !b.spawned &&
    b.entity.eid == rootOf(space, String(comp(b, 'operator_session')!.person))
  )
  return await Promise.all(held.map(async (b) => ({
    root: b.entity.eid,
    title: await whose(b, everyone),
  })))
}

// What the admin calls a person's conversation: whose it is.
let whose = async (session: Bundle, named: Named) =>
  `Conversation with ${
    await named(String(comp(session, 'operator_session')?.person ?? '')) ??
      'someone'
  }`

/**
 * The Operator's work for `person`, as its conversations are listed
 * (operator-view.ts `worked`, `talks`): their conversation first, then,
 * newest first, the pieces of work it started, the requests no session has
 * taken yet, the tasks it worked on before a person had one conversation,
 * and the breaks it took up itself. Given `everyone`, what to call a person,
 * it lists every person's conversation and the work each started, as the
 * platform's admin inspects them.
 */
export let workOf = async (
  store: Store,
  space: string,
  person: string,
  everyone?: Named,
): Promise<Worked[]> => {
  let conversations = await conversationsOf(store, space, person, everyone)
  let [tasks, requests, helpers] = await Promise.all([
    store.g.read('.task ?doc ?created ?updated .order=-created.at .limit=50'),
    requested(store),
    conversations.length
      ? store.g.read(
        `.spawned.parent=${
          conversations.map((c) => c.root).join(',')
        } ?created .order=-created.at .limit=50`,
      )
      : [],
  ])
  let own = async (rows: Bundle[]) => {
    if (everyone) return rows
    let allowed = await Promise.all(
      rows.map((b) => owns(store, b.entity.eid, { person, space })),
    )
    return rows.filter((_, i) => allowed[i])
  }
  let drawn = await Promise.all((await own(tasks)).map(async (task) => {
    let entries = await entriesOf(
      store,
      (await sessionsOf(store, task.entity.eid)).slice(-1),
    )
    let state = stateOf(entries, comp(task, 'task')?.status == 'done')
    return {
      open: task.entity.eid,
      title: String(comp(task, 'doc')?.title ?? 'A request'),
      state,
      at: String(comp(task, 'updated')?.at ?? comp(task, 'created')?.at ?? ''),
      busy: busy(state),
    }
  }))
  let work = await Promise.all(helpers.map(async (helper) => {
    let eid = helper.entity.eid
    let lines = await linesOf(store, eid, TAIL)
    let state = stateOf(lines, true)
    return {
      open: eid,
      title: askedOf(await openingOf(store, eid)),
      state,
      at: String(
        comp(lines.at(-1), 'created')?.at ?? comp(helper, 'created')?.at ?? '',
      ),
      busy: busy(state),
    }
  }))
  let waiting = taken(await own(requests)).map((r) => {
    let failed = r.failed ?? r.bounced
    return {
      open: r.entity.eid,
      title: firstLine(r),
      state: failed ? 'Could not finish' : 'Waiting to start',
      at: String(comp(r, 'created')?.at ?? ''),
      busy: !failed,
    }
  })
  let talking = await Promise.all(conversations.map(async ({ root, title }) => {
    let entries = await linesOf(store, root, TAIL)
    let state = stateOf(entries, false)
    return {
      open: root,
      title,
      state,
      at: String(comp(entries.at(-1), 'created')?.at ?? ''),
      busy: busy(state),
    }
  }))
  return [
    ...talking,
    ...[...waiting, ...work, ...drawn].sort((a, b) => b.at.localeCompare(a.at)),
  ]
}

// The files sent with each request, to link beside the conversation.
let filesOf = (asked: Bundle[]) =>
  asked.flatMap((r) =>
    ((comp(r, 'operator_request')?.files ?? []) as { name: string }[])
      .map((f, index) => ({ request: r.entity.eid, name: f.name, index }))
  )

/**
 * One conversation in the Operator's chat app, opened by a person's
 * conversation, a piece of work it started, a task, or a request: its title
 * and its lines drawn (operator-view.ts `talk`), or the request alone while
 * no session has taken it, for the page to draw as it always has. `task` is
 * what the page keys the conversation by (a task, or the session), and
 * `begun` the request it began with, the same before and after a session
 * takes it up (the key, for one no request began). `called` is what its
 * Operator is called.
 */
export let conversationOf = async (
  store: Store,
  at: string,
  open: string,
  named: Named = nameless,
  everyone?: Named,
  called?: string,
): Promise<{
  task: string
  begun: string
  title: string
  html: string
  waiting: Bundle[]
  // the apps its lines and its helpers' changed, oldest first
  changed: Changed[]
}> => {
  let [row] = await store.g.get([open])
  if (row?.session) {
    let helper = !!row.spawned
    let entries = await linesOf(store, open, SHOWN)
    let asked = helper ? [] : await requested(
      store,
      `.operator_request.session=${open} ?doc .order=created.at .limit=100`,
    )
    let calls = new Set(
      entries.flatMap((b) => b.call ? [b.entity.eid] : []),
    )
    let seen = { ...await seenOf(store, [row], entries, calls), called }
    return {
      task: open,
      begun: open,
      title: helper
        ? askedOf(await openingOf(store, open))
        : everyone
        ? await whose(row, everyone)
        : CONVERSATION,
      html: talk(
        { entity: { eid: open } } as Bundle,
        entries,
        await namesOf(store, entries, named),
        filesOf(asked),
        at,
        seen,
      ),
      waiting: [],
      changed: changedIn(entries, seen),
    }
  }
  let task = row?.task
    ? open
    : row?.operator_request
    ? await taskOf(store, (await answering(store, [row]))[0])
    : ''
  if (task && task != open) {
    let [held] = await store.g.get([task])
    if (held?.session) {
      return {
        ...await conversationOf(store, at, task, named, undefined, called),
        begun: open,
      }
    }
  }
  let [held] = task ? await store.g.get([task]) : []
  if (!held?.task) {
    return row?.operator_request
      ? {
        task: '',
        begun: open,
        title: firstLine(row),
        html: '',
        waiting: await answering(store, [row]),
        changed: [],
      }
      : { task: '', begun: '', title: '', html: '', waiting: [], changed: [] }
  }
  let requests = await requested(store)
  let sessions = await sessionsOf(store, task)
  let ids = new Set(sessions.map((b) => b.entity.eid))
  let entries = await entriesOf(store, sessions)
  // The requests this conversation was asked in, first to last.
  let asked = requests.filter((r) =>
    ids.has(String(comp(r, 'operator_request')?.session)) ||
    comp(r, 'operator_answer')?.task == task
  ).sort((a, b) =>
    String(comp(a, 'created')?.at ?? '').localeCompare(
      String(comp(b, 'created')?.at ?? ''),
    )
  )
  let seen = { ...await seenOf(store, sessions, entries), called }
  return {
    task,
    begun: asked[0]?.entity.eid ?? task,
    title: String(comp(held, 'doc')?.title ?? 'A request'),
    html: talk(
      held,
      entries,
      await namesOf(store, entries, named),
      filesOf(asked),
      at,
      seen,
    ),
    waiting: [],
    changed: changedIn(entries, seen),
  }
}

/**
 * What a session's step changed, as its conversation's frame for the page's
 * socket: the lines past `from` (by `entry.seq`, the last 30 when unknown),
 * and the newest seq it covers, to start the next from. A helper's step
 * shows in the conversation that started it.
 */
export let frameOf = async (
  store: Store,
  session: string,
  from?: number,
  named: Named = nameless,
  called?: string,
) => {
  let [row] = await store.g.get([session])
  if (!row?.session) return null
  // A task's session is short; a person's conversation and its helpers are
  // read from their own newest lines.
  let read = async (session: string) =>
    await holding(store, session)
      ? await transcript(store.g, session)
      : await linesOf(store, session, TAIL)
  let entries = await read(session)
  let seq = Math.max(
    0,
    ...entries.map((b) => Number(comp(b, 'entry')?.seq ?? 0)),
  )
  let parent = String(comp(row, 'spawned')?.parent ?? '')
  if (!parent) {
    let since = from ?? seq - 30
    // The steps it changed that started helpers are drawn with what each was
    // told inside.
    let calls = new Set(
      entries.filter((b) => Number(comp(b, 'entry')?.seq ?? 0) > since)
        .flatMap((b) =>
          b.call
            ? [b.entity.eid]
            : b.result
            ? [String(comp(b, 'result')!.call)]
            : []
        ),
    )
    let helpers = await helpersBy(store, calls)
    return {
      seq,
      frame: frame(
        await keyOf(store, session),
        entries,
        await namesOf(store, entries, named),
        since,
        {
          helpers,
          offers: await offersOf(store, [
            ...entries,
            ...helpers.flatMap((h) => h.entries),
          ]),
          called,
        },
      ),
    }
  }
  let call = comp(row, 'spawned')?.call as string | undefined
  // What a helper was told changes only at an ask: only then is the step
  // that started it drawn again, from as many of its lines as a
  // conversation draws.
  let told = from == null ||
    entries.some((b) =>
      (b.ask || b.prompt) && Number(comp(b, 'entry')?.seq ?? 0) > from
    )
  let helper = {
    call,
    entries: told && call ? await linesOf(store, session, SHOWN) : entries,
  }
  let started = await read(parent)
  return {
    seq,
    frame: helperFrame(
      await keyOf(store, parent),
      helper,
      started,
      await namesOf(store, started, named),
      from ?? 0,
      { offers: await offersOf(store, helper.entries), called },
    ),
  }
}

export type Listener = {
  send: (data: string) => void
  deserializeAttachment: () => unknown
}

/** Frames for the pages watching this Operator, with each session's cursor. */
export let operatorFrames = (
  store: Store,
  sockets: () => Listener[],
  named: Named = nameless,
) => {
  let told = new Map<string, number>()
  let tasks = new Map<string, string>()
  // The pages one person has open on this Operator.
  let pagesOf = (owner: Pick<Held, 'person' | 'space'>) =>
    sockets().filter((ws) => {
      let held = ws.deserializeAttachment() as
        | (Held & { operator?: boolean })
        | null
      return held?.operator && held.person == owner.person &&
        held.space == owner.space
    })
  let watching = async (session: string) => {
    let owner = await ownerOf(store, session)
    return owner ? pagesOf(owner) : []
  }
  let send = (watching: Listener[], frame: unknown) => {
    let sent = JSON.stringify(frame)
    for (let ws of watching) {
      try {
        ws.send(sent)
      } catch {
        // A page that has gone away hears nothing more.
      }
    }
  }
  return {
    /** A person's drafts as they now stand, to every page they have open, so
     * words typed on one show on the others as they land. */
    drafts: (owner: Pick<Held, 'person' | 'space'>, bundles: Bundle[]) =>
      send(pagesOf(owner), { drafts: bundles }),
    tell: async (session: string) => {
      let pages = await watching(session)
      if (!pages.length) return
      let { called } = pages[0].deserializeAttachment() as Held
      let made = await frameOf(
        store,
        session,
        told.get(session),
        named,
        called,
      )
      if (!made) return
      told.set(session, made.seq)
      send(pages, made.frame)
    },
    typing: async (session: string, text: string) => {
      let pages = await watching(session)
      if (!pages.length) return
      let task = tasks.get(session)
      if (!task) {
        task = await keyOf(store, session)
        tasks.set(session, task)
      }
      send(pages, { operator: { task, typing: text } })
    },
  }
}

// Each conversation keeps its own draft, at `operator:<conversation>`; a
// draft named for no conversation is the one the chat app kept before.
let placeOf = (b: Bundle) => {
  let place = String((b.draft as { place?: string })?.place ?? '')
  return /^operator(:|$)/.test(place) ? place : 'operator'
}
let drafts = (bundles: Bundle[], person: string) =>
  bundles.filter((b) => b.draft).map((b) => ({
    entity: { eid: draftEid(person, placeOf(b)) },
    draft: {
      by: person,
      place: placeOf(b),
      text: String((b.draft as { text?: string })?.text ?? ''),
    },
    typed: { over: String((b.typed as { over?: string })?.over ?? '') },
    $actor: { by: person },
  }))

/**
 * A reply to a letter or text the Operator wrote, which the kernel brings
 * from someone who need be nobody here: a letter's (inbox.ts) by the
 * Message-IDs it names (`thread`), a text's (operator-line.ts) by the numbers
 * it went between (`texted`). `/operator/letter` finds the letter, and
 * `/operator/replied` puts the reply in the conversation of the person the
 * letter or text was written for.
 */
export let operatorReply = async (
  operator: Operator,
  space: string,
  path: string,
  args: Record<string, unknown>,
  armed: () => Promise<void> | undefined,
): Promise<Response> => {
  let { store } = operator
  let thread = Array.isArray(args.thread) ? args.thread.map(String) : []
  let texted = args.texted as { from: string; to: string } | undefined
  let letter = texted
    ? await textOf(store, texted)
    : await letterOf(store, thread)
  if (!letter) {
    return Response.json(
      { message: 'That answers no letter or text of the Operator.' },
      {
        status: 404,
      },
    )
  }
  if (path == '/operator/letter') {
    return Response.json({ letter: letter.entity.eid })
  }
  let options = args.options as Parameters<typeof receive>[3]
  let [old] = options?.id ? await store.g.get([options.id]) : []
  let id = await receive(
    store,
    {
      ...args.request as Request,
      channel: texted ? 'texted' : 'letter',
      person: String(
        comp(letter, texted ? 'operator_text' : 'operator_letter')!.person,
      ),
      space,
    },
    String(args.say ?? ''),
    options,
  )
  await armed()
  return Response.json({ request: id }, {
    status: old?.operator_request ? 200 : 202,
  })
}

export let operatorRequest = async (
  operator: Operator,
  held: Held,
  path: string,
  args: Record<string, unknown>,
  armed: () => Promise<void> | undefined,
  drafted: (bundles: Bundle[]) => void = () => {},
): Promise<Response | null> => {
  let { person, space: spaceId } = held
  let { store } = operator
  await phoneTexts(store.g)
  await channeled(store.g)
  let access = held
  let own = (id: string) => owns(store, id, held)
  let missing = () =>
    Response.json({ message: 'That conversation is missing.' }, { status: 404 })
  let allowedDrafts = async (bundles: Bundle[]) => {
    let allowed = await Promise.all(bundles.map(async (b) => {
      let place = placeOf(b)
      return place == 'operator' || place == 'operator:new' ||
        await own(place.slice('operator:'.length))
    }))
    return bundles.filter((_, i) => allowed[i])
  }
  // The platform's admin, inspecting: every person's conversations, each
  // called by whose it is.
  let everyone = args.everyone === true && access.administrative
    ? operator.named
    : undefined
  if (
    (path == '/operator/stop' || path == '/operator/run') && args.task &&
    !await own(String(args.task))
  ) return missing()
  if (path == '/operator/stop') {
    return Response.json(await operator.stop(String(args.task ?? ''), person))
  }
  if (path == '/operator/draft') {
    if (Array.isArray(args.bundles)) {
      let bundles = drafts(args.bundles as Bundle[], person)
      if ((await allowedDrafts(bundles)).length != bundles.length) {
        return missing()
      }
      await store.g.apply(bundles)
    }
    let kept = await allowedDrafts(await store.g.read(`.draft.by=${person}`))
    if (Array.isArray(args.bundles)) drafted(kept)
    return Response.json({ bundles: kept })
  }
  // The opt-ins this store kept before the number moved onto the person
  // (operator-texts.ts `handed`): listed for the page to hand to the
  // directory, then dropped once it has.
  if (path == '/operator/texts') {
    let kept = await store.g.read('.sms_consent')
    if (args.handed === true) {
      await store.g.apply(
        kept.map((row) => ({ entity: row.entity, sms_consent: null })),
      )
      return Response.json([])
    }
    return Response.json(kept.map((row) => row.sms_consent))
  }
  if (path == '/operator/receive') {
    let intake = {
      ...args.request as Request,
      person,
      space: spaceId,
      administrative: access.administrative === true,
    }
    let options = args.options as Parameters<typeof receive>[3]
    if (Array.isArray(args.draft)) {
      let also = drafts(args.draft as Bundle[], person)
      if ((await allowedDrafts(also)).length != also.length) return missing()
      options = { ...options, also }
    }
    let [old] = options?.id ? await store.g.get([options.id]) : []
    if (old && !await own(old.entity.eid)) return missing()
    let id = await receive(store, intake, String(args.say ?? ''), options)
    await armed()
    if (options?.also) {
      drafted(await allowedDrafts(await store.g.read(`.draft.by=${person}`)))
    }
    return Response.json({
      request: id,
      ...(options?.also
        ? {
          bundles: await store.g.get(options.also.map((b) => b.entity.eid)),
        }
        : {}),
    }, {
      status: old?.operator_request ? 200 : 202,
    })
  }
  // A request that could not finish, taken in again as itself once its cause
  // is fixed, so the person need not send it again: its failure, the answer
  // that told of it and what was read of its files are dropped, and its
  // intake runs anew (operator-channels.ts `operator_receive`).
  if (path == '/operator/retry') {
    let id = String(args.request ?? '')
    let [row] = await store.g.get([id])
    if (!row?.operator_request || !(access.administrative || await own(id))) {
      return Response.json({ message: 'That request is missing.' }, {
        status: 404,
      })
    }
    if (!row.failed) {
      return Response.json({ message: 'That request did not fail.' }, {
        status: 409,
      })
    }
    let [told] = await store.g.get([derivedEid('operator-answer|' + id)])
    await store.g.apply([
      { entity: row.entity, failed: null, content: null },
      ...told ? [{ entity: told.entity, $delete: true as const }] : [],
    ], { trusted: true })
    await enqueue(store.g, 'operator_receive', id)
    await armed()
    return Response.json({ request: id, text: `retrying request ${id}` })
  }
  if (path == '/operator/request') {
    let [row] = await store.g.get([String(args.id ?? '')])
    return row?.operator_request && await own(row.entity.eid)
      ? Response.json((await answering(store, [row]))[0])
      : Response.json({ message: 'That request is missing.' }, { status: 404 })
  }
  if (path == '/operator/requests') {
    let ids = Array.isArray(args.ids) ? args.ids.map(String) : []
    return Response.json(
      await answering(
        store,
        (await Promise.all(
          ids.map(async (id) =>
            await own(id) ? (await store.g.get([id]))[0] : undefined
          ),
        )).filter((row): row is Bundle => !!row?.operator_request),
      ),
    )
  }
  if (path == '/operator/messages') {
    let rows = (await requested(store)).reverse()
    let allowed = await Promise.all(rows.map((r) => own(r.entity.eid)))
    rows = rows.filter((_, i) => allowed[i])
    let failed = await store.g.read('.effect.state=failed')
    return Response.json(rows.map((row) => {
      let run = failed.find((b) =>
        (b.effect as { target?: string }).target == row.entity.eid
      )
      return run
        ? {
          ...row,
          failed: { reason: (run.effect as { error?: string }).error },
        }
        : row
    }))
  }
  if (path == '/operator/work') {
    return Response.json(await workOf(store, spaceId, person, everyone))
  }
  // Their Updates from the Operator, and what they do there.
  if (path == '/operator/updates') {
    let answer = await updating(store, held, args)
    if ('request' in answer) await armed()
    return Response.json(answer)
  }
  if (path == '/operator/conversation') {
    if (!everyone && !await own(String(args.open ?? ''))) return missing()
    return Response.json(
      await conversationOf(
        store,
        String(args.at ?? ''),
        String(args.open ?? ''),
        operator.named,
        everyone,
        held.called,
      ),
    )
  }
  if (path == '/operator/read') {
    if (typeof args.task == 'string' && !await own(args.task)) return missing()
    if (!args.task) {
      let { tasks = [], conversations = [] } = await readOperator(store)
      let mine = async (rows: Bundle[]) => {
        let allowed = await Promise.all(rows.map((r) => own(r.entity.eid)))
        return rows.filter((_, i) => allowed[i])
      }
      return Response.json({
        tasks: await mine(tasks),
        conversations: await mine(conversations),
      })
    }
    return Response.json(
      await readOperator(
        store,
        typeof args.task == 'string' ? args.task : undefined,
        args.context === true,
      ),
    )
  }
  return null
}

/** A kernel-vouched delivery receipt for this space's private mail. */
export let operatorReceipt = async (
  operator: { store: { g: Pick<Graph, 'get' | 'apply'> } },
  args: { letter: string; id: string; kind?: string },
): Promise<Response> => {
  let [row] = await operator.store.g.get([args.letter])
  let name = args.kind == 'answer' ? 'operator_answer' : 'mail'
  if (!row?.[name]) {
    throw new Error('Operator receipt awaits its recorded letter')
  }
  let before = comp(row, name)?.message_id
  if (before && before != args.id) {
    throw new Error('Operator receipt disagrees with the recorded Message-ID')
  }
  if (!before) {
    await operator.store.g.apply([{
      entity: row.entity,
      [name]: { message_id: args.id },
    }], { trusted: true })
  }
  return Response.json({ ok: true })
}

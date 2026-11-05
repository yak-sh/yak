import type { Bundle } from '@yaks/graph'
import { draftEid } from '@yaks/draft'
import type { Held } from './build-door.ts'
import { type Operator, readOperator } from './operator.ts'
import { receive, type Request } from './operator-channels.ts'
import type { operatorStore } from './operator-store.ts'
import { transcript } from '@yaks/session'
import { stepOf } from '@yaks/tools/title'
import type { Tool } from '@yaks/model'
import {
  frame,
  type Helper,
  helperFrame,
  type Names,
  type Offers,
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
// its transcript.
let helpersOf = async (store: Store, sessions: Bundle[]): Promise<Helper[]> => {
  let children = (await Promise.all(
    sessions.map((b) => store.g.read(`.spawned.parent=${b.entity.eid}`)),
  )).flat()
  return await Promise.all(children.map(async (b) => ({
    call: comp(b, 'spawned')?.call as string | undefined,
    entries: await transcript(store.g, b.entity.eid),
  })))
}

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
let seenOf = async (store: Store, sessions: Bundle[], entries: Bundle[]) => {
  let helpers = await helpersOf(store, sessions)
  return {
    helpers,
    offers: await offersOf(store, [
      ...entries,
      ...helpers.flatMap((h) => h.entries),
    ]),
  }
}

// The task holding a session, by the link a task keeps to it.
let holding = async (store: Store, session: string) => {
  let [link] = await store.g.read(`.contains .edge.to=${session}`)
  return String(comp(link, 'edge')?.from ?? '')
}

let REQUESTS =
  '.operator_request ?operator_answer ?doc ?delivered ?failed ?bounced .order=-created.at .limit=100'

// The task a request was taken up by: the one its answer names, or the one
// holding the session it started.
let taskOf = async (store: Store, request: Bundle) => {
  let named = comp(request, 'operator_answer')?.task
  if (named) return String(named)
  let session = comp(request, 'operator_request')?.session
  return session ? await holding(store, String(session)) : ''
}

// A request no task has taken yet, named by its first line.
let firstLine = (request: Bundle) =>
  String(comp(request, 'doc')?.body ?? '').split('\n')[0].slice(0, 80) ||
  'A request'

let taken = (requests: Bundle[]) =>
  requests.filter((r) =>
    !comp(r, 'operator_request')?.session && !comp(r, 'operator_answer')?.task
  )

/**
 * The Operator's work, newest first, as its conversations are listed
 * (operator-view.ts `worked`, `sidebar`): each task in the words its newest session says of it, and the
 * requests no session has taken yet.
 */
export let workOf = async (store: Store): Promise<Worked[]> => {
  let [tasks, requests] = await Promise.all([
    store.g.read('.task ?doc .order=-created.at .limit=50'),
    store.g.read(REQUESTS),
  ])
  let drawn = await Promise.all(tasks.map(async (task) => {
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
      busy: state == 'Working on it' || state == 'Waiting to start',
    }
  }))
  let waiting = taken(requests).map((r) => {
    let failed = r.failed ?? r.bounced
    return {
      open: r.entity.eid,
      title: firstLine(r),
      state: failed ? 'Could not finish' : 'Waiting to start',
      at: String(comp(r, 'created')?.at ?? ''),
      busy: !failed,
    }
  })
  return [...waiting, ...drawn]
}

/**
 * One conversation in the Operator's chat app, opened by its task or by a
 * request: its title and the task drawn with its sessions' transcripts
 * (operator-view.ts `talk`), or the request alone while no session has taken
 * it, for the page to draw as it always has. `begun` is the request it began
 * with, the same before and after a task takes it up (the task, for one no
 * request began).
 */
export let conversationOf = async (
  store: Store,
  at: string,
  open: string,
  named: Named = nameless,
) => {
  let [row] = await store.g.get([open])
  let task = row?.task
    ? open
    : row?.operator_request
    ? await taskOf(store, row)
    : ''
  let [held] = task ? await store.g.get([task]) : []
  if (!held?.task) {
    return row?.operator_request
      ? {
        task: '',
        begun: open,
        title: firstLine(row),
        html: '',
        waiting: [row],
      }
      : { task: '', begun: '', title: '', html: '', waiting: [] }
  }
  let requests = await store.g.read(REQUESTS)
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
  let files = asked.flatMap((r) =>
    ((comp(r, 'operator_request')?.files ?? []) as { name: string }[])
      .map((f, index) => ({ request: r.entity.eid, name: f.name, index }))
  )
  return {
    task,
    begun: asked[0]?.entity.eid ?? task,
    title: String(comp(held, 'doc')?.title ?? 'A request'),
    html: talk(
      held,
      entries,
      await namesOf(store, entries, named),
      files,
      at,
      await seenOf(store, sessions, entries),
    ),
    waiting: [],
  }
}

/**
 * What a session's step changed, as its task's frame for the page's socket:
 * the lines past `from` (by `entry.seq`, the last 30 when unknown), and the
 * newest seq it covers, to start the next from.
 */
export let frameOf = async (
  store: Store,
  session: string,
  from?: number,
  named: Named = nameless,
) => {
  let entries = await transcript(store.g, session)
  let seq = Math.max(
    0,
    ...entries.map((b) => Number(comp(b, 'entry')?.seq ?? 0)),
  )
  let task = await holding(store, session)
  if (task) {
    return {
      seq,
      frame: frame(
        task,
        entries,
        await namesOf(store, entries, named),
        from ?? seq - 30,
        { offers: await offersOf(store, entries) },
      ),
    }
  }
  // A helper's step shows in the conversation of the Operator that started it.
  let [row] = await store.g.get([session])
  let parent = String(comp(row, 'spawned')?.parent ?? '')
  task = parent && await holding(store, parent)
  if (!task) return null
  let started = await transcript(store.g, parent)
  return {
    seq,
    frame: helperFrame(
      task,
      entries,
      started,
      await namesOf(store, started, named),
      from ?? 0,
      await offersOf(store, entries),
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
  let watching = () =>
    sockets().filter((ws) =>
      (ws.deserializeAttachment() as { operator?: boolean } | null)?.operator
    )
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
    tell: async (session: string) => {
      let pages = watching()
      if (!pages.length) return
      let made = await frameOf(store, session, told.get(session), named)
      if (!made) return
      told.set(session, made.seq)
      send(pages, made.frame)
    },
    typing: async (session: string, text: string) => {
      let pages = watching()
      if (!pages.length) return
      let task = tasks.get(session)
      if (!task) {
        task = await holding(store, session)
        if (!task) return
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

export let operatorRequest = async (
  operator: Operator,
  held: Held,
  path: string,
  args: Record<string, unknown>,
  armed: () => Promise<void> | undefined,
): Promise<Response | null> => {
  let { person, space: spaceId } = held
  let { store } = operator
  let access = held
  if (path == '/operator/stop') {
    return Response.json(await operator.stop(String(args.task ?? ''), person))
  }
  if (path == '/operator/draft') {
    if (Array.isArray(args.bundles)) {
      await store.g.apply(drafts(args.bundles as Bundle[], person))
    }
    return Response.json({ bundles: await store.g.read(`.draft.by=${person}`) })
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
    if (typeof args.in_reply_to == 'string') {
      let message = args.in_reply_to.replace(/[<>]/g, '')
      let previous = await store.g.read(
        `(.operator_answer.message_id=${
          JSON.stringify(message)
        }|.mail.message_id=${
          JSON.stringify(message)
        }) ?operator_request ?operator_answer`,
      )
      let same = previous.find((r) =>
        (r.operator_request as { person?: string })?.person == person
      )
      if (same) {
        intake.task = (same.operator_answer as { task?: string })?.task
      }
    }
    let options = args.options as Parameters<typeof receive>[3]
    if (Array.isArray(args.draft)) {
      options = { ...options, also: drafts(args.draft as Bundle[], person) }
    }
    let [old] = options?.id ? await store.g.get([options.id]) : []
    let id = await receive(store, intake, String(args.say ?? ''), options)
    await armed()
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
  if (path == '/operator/request') {
    let [row] = await store.g.get([String(args.id ?? '')])
    return row?.operator_request
      ? Response.json(row)
      : Response.json({ message: 'That request is missing.' }, { status: 404 })
  }
  if (path == '/operator/requests') {
    let ids = Array.isArray(args.ids) ? args.ids.map(String) : []
    return Response.json(
      (await store.g.get(ids)).filter((row) => row?.operator_request),
    )
  }
  if (path == '/operator/messages') {
    let rows = (await store.g.read(REQUESTS)).reverse()
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
  if (path == '/operator/work') return Response.json(await workOf(store))
  if (path == '/operator/conversation') {
    return Response.json(
      await conversationOf(
        store,
        String(args.at ?? ''),
        String(args.open ?? ''),
        operator.named,
      ),
    )
  }
  if (path == '/operator/read') {
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

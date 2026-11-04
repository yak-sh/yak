import type { Bundle } from '@yaks/graph'
import { draftEid } from '@yaks/draft'
import type { Held } from './build.ts'
import { type Operator, readOperator } from './operator.ts'
import { receive, type Request } from './operator-channels.ts'
import type { operatorStore } from './operator-store.ts'
import { transcript } from '@yaks/session'
import { titleOf } from '@yaks/tools/title'
import {
  frame,
  type Names,
  stateOf,
  talk,
  type Worked,
} from './operator-view.ts'

type Store = ReturnType<typeof operatorStore>
let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Record<string, unknown> | undefined

// The English names of the tools a transcript's calls name (`call.to` is a
// tool's eid), each said as the one thing its call's arguments chose.
let namesOf = async (store: Store, entries: Bundle[]): Promise<Names> => {
  let tools = await store.g.get([
    ...new Set(
      entries.flatMap((b) => b.call ? [String(comp(b, 'call')!.to)] : []),
    ),
  ])
  let held = new Map(
    tools.filter(Boolean).map((b) => [b.entity.eid, comp(b, 'tool') ?? {}]),
  )
  return (tool, args) => {
    let t = held.get(tool)
    return t ? titleOf(t, args) : 'Use a tool'
  }
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

let REQUESTS =
  '.operator_request ?operator_answer ?doc ?delivered ?failed ?bounced .order=-created.at .limit=100'

// The task a request was taken up by: the one its answer names, or the one
// holding the session it started.
let taskOf = async (store: Store, request: Bundle) => {
  let named = comp(request, 'operator_answer')?.task
  if (named) return String(named)
  let session = comp(request, 'operator_request')?.session
  if (!session) return ''
  let [link] = await store.g.read(`.contains .edge.to=${session}`)
  return String(comp(link, 'edge')?.from ?? '')
}

let taken = (requests: Bundle[]) =>
  requests.filter((r) =>
    !comp(r, 'operator_request')?.session && !comp(r, 'operator_answer')?.task
  )

/**
 * The Operator's work, newest first, as its page lists it (operator-view.ts
 * `worked`): each task in the words its newest session says of it, and the
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
      title: String(comp(r, 'doc')?.body ?? '').split('\n')[0].slice(0, 80) ||
        'A request',
      state: failed ? 'Could not finish' : 'Waiting to start',
      at: String(comp(r, 'created')?.at ?? ''),
      busy: !failed,
    }
  })
  return [...waiting, ...drawn]
}

/**
 * One piece of the Operator's work on a page of its own, opened by its task
 * or by a request: the task drawn with its sessions' transcripts
 * (operator-view.ts `talk`), or the request alone while no session has taken
 * it, for the page to draw as it always has.
 */
export let conversationOf = async (store: Store, at: string, open: string) => {
  let [row] = await store.g.get([open])
  let task = row?.task
    ? open
    : row?.operator_request
    ? await taskOf(store, row)
    : ''
  let [held] = task ? await store.g.get([task]) : []
  if (!held?.task) {
    return { task: '', html: '', waiting: row?.operator_request ? [row] : [] }
  }
  let requests = await store.g.read(REQUESTS)
  let sessions = await sessionsOf(store, task)
  let ids = new Set(sessions.map((b) => b.entity.eid))
  let entries = await entriesOf(store, sessions)
  let files = requests.filter((r) =>
    ids.has(String(comp(r, 'operator_request')?.session)) ||
    comp(r, 'operator_answer')?.task == task
  ).flatMap((r) =>
    ((comp(r, 'operator_request')?.files ?? []) as { name: string }[])
      .map((f, index) => ({ request: r.entity.eid, name: f.name, index }))
  )
  return {
    task,
    html: talk(held, entries, await namesOf(store, entries), files, at),
    waiting: [],
  }
}

/**
 * What a session's step changed, as its task's frame for the page's socket:
 * the lines past `from` (by `entry.seq`, the last 30 when unknown), and the
 * newest seq it covers, to start the next from.
 */
export let frameOf = async (store: Store, session: string, from?: number) => {
  let [link] = await store.g.read(`.contains .edge.to=${session}`)
  let task = String(comp(link, 'edge')?.from ?? '')
  if (!task) return null
  let entries = await transcript(store.g, session)
  let seq = Math.max(
    0,
    ...entries.map((b) => Number(comp(b, 'entry')?.seq ?? 0)),
  )
  return {
    seq,
    frame: frame(
      task,
      entries,
      await namesOf(store, entries),
      from ?? seq - 30,
    ),
  }
}

export type Listener = {
  send: (data: string) => void
  deserializeAttachment: () => unknown
}

/** Frames for the pages watching this Operator, with each session's cursor. */
export let operatorFrames = (store: Store, sockets: () => Listener[]) => {
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
      let made = await frameOf(store, session, told.get(session))
      if (!made) return
      told.set(session, made.seq)
      send(pages, made.frame)
    },
    typing: async (session: string, text: string) => {
      let pages = watching()
      if (!pages.length) return
      let task = tasks.get(session)
      if (!task) {
        let [link] = await store.g.read(`.contains .edge.to=${session}`)
        task = String(comp(link, 'edge')?.from ?? '')
        if (!task) return
        tasks.set(session, task)
      }
      send(pages, { operator: { task, typing: text } })
    },
  }
}

let drafts = (bundles: Bundle[], person: string) =>
  bundles.filter((b) => b.draft).map((b) => ({
    entity: { eid: draftEid(person, 'operator') },
    draft: {
      by: person,
      place: 'operator',
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
    let eid = draftEid(person, 'operator')
    if (Array.isArray(args.bundles)) {
      await store.g.apply(drafts(args.bundles as Bundle[], person))
    }
    return Response.json({ bundles: await store.g.get([eid]) })
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

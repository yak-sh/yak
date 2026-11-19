// Outside helpers belong to a caller-owned chat, never the person's main
// thread. Questions for the person cross that boundary as passive notices.
//
// A helper runs in yaks.app's sandbox, or on its person's own machine, the
// one a space's tunnel goes to (`machine`, as `mcp_server.machine` names
// one). Either way it is a child session of the chat, so its report reaches
// the chat as every helper's does (@yaks/session `deliverChild`). On a
// machine nothing here runs it: the machine is asked once to run an agent on
// the brief (`POST /session/spawn`, @yaks/spawn/routes) as the Operator, in
// the conversation the chat works for, and the session here holds the brief
// and where it went (`operator_machine`). The machine's word about that task,
// which its run's report knocks the conversation with (@yaks/tunnel/effects),
// is the helper's answer ({@link machineReport}).
// A stop of the helper here, however it came, asks the machine to stop the
// run (`POST /session/stop`, {@link stopOnMachine}).
import { line } from '@yaks/query'
import type { Bundle, Comp } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import {
  deliverChild,
  noticeParent,
  raiseNotice,
  spawnChild,
  type ToolContext,
} from '@yaks/session'
import { owns } from './operator-access.ts'
import type { Held } from './build-door.ts'
import type { OperatorStore } from './operator-store.ts'
import { type Args, refuse } from './tool.ts'
import type { Operator } from './operator.ts'
import type { Space } from './directory.ts'

export let helperParent = async (
  store: OperatorStore,
  who: Pick<Held, 'person' | 'space'>,
  open: string,
) => {
  if (!open || !await owns(store, open, who)) {
    throw refuse('missing', 'That chat is missing.')
  }
  let row: Bundle | undefined = (await store.g.get([open]))[0]
  if (row?.task) {
    // Containment points from the task to its session.
    let links = await store.g.read(line`.contains&.edge.from=${open}`)
    let sessions = await store.g.get(
      links.map((b) => String((b.edge as Comp).to)),
    )
    row = sessions.filter((b) => b.session).sort((a, b) =>
      String((a.created as Comp)?.at).localeCompare(
        String((b.created as Comp)?.at),
      )
    ).at(-1)
  }
  let link = row?.spawned as Comp | undefined
  if (!row?.session || !link?.notice || link.quiet == null) {
    throw refuse(
      'arguments',
      'Name the task or session returned by operator_chat.',
    )
  }
  return row.entity.eid
}

/** A helper started under the caller's private chat (`helperParent`) on
 * `args.brief`, with the model `args.model` names or the Operator's own
 * (`choose`), answered at once; its report reaches the chat as the session
 * tools' helpers' do (@yaks/session `spawnChild`). */
export let spawnHelper = async (
  { store, choose, machine }: Pick<Operator, 'store' | 'choose' | 'machine'>,
  held: Pick<Held, 'person' | 'administrative'>,
  space: Space,
  args: Args,
) => {
  let parent = await helperParent(
    store,
    { ...held, space: space.eid },
    String(args.task ?? ''),
  )
  let brief = typeof args.brief == 'string' ? args.brief : ''
  if (!brief.trim()) throw refuse('arguments', 'Give the helper a brief.')
  let [scope] = await store.g.get([parent], ['operator_session'])
  // The same person may have used the admin door earlier; a connector
  // helper must not borrow that authority from an older chat.
  if (
    (scope?.operator_session as Comp | undefined)?.administrative &&
    !held.administrative
  ) {
    throw refuse('access', 'Start a chat with your current permissions first.')
  }
  let title = typeof args.title == 'string' ? args.title.trim() : ''
  let model = typeof args.model == 'string' ? args.model : undefined
  let at = typeof args.machine == 'string' ? args.machine.trim() : ''
  if (at) {
    let mine = at == space.slug
    let reached = mine && await machine(held, space, parent)
    if (!reached) {
      throw refuse(
        'access',
        `No machine of yours answers through ${at}'s tunnel for this Operator: ${
          mine
            ? `${at} has no tunnel, or its machine runs helpers only for the platform's admin`
            : `name ${space.slug}, whose tunnel goes to your machine`
        }, or omit machine for yaks.app's sandbox.`,
      )
    }
    return await onMachine(store, reached, space, parent, {
      brief,
      title,
      ...model ? { model } : {},
    }, scope)
  }
  let selected = await choose(held, space, model)
  let session = await spawnChild(store.g, parent, {
    prompt: brief,
    model: selected.model,
    ...title ? { title } : {},
  })
  // The chat takes up the report when it comes, however long ago it closed.
  await store.g.apply([{ entity: { eid: parent }, completed: null }], {
    trusted: true,
  })
  return {
    session,
    parent,
    text: `Helper ${session} started. Its report goes to chat ${parent}.`,
  }
}

// What the machine answers a run asked of it with (@yaks/spawn/routes).
type Spawned = {
  task: string
  session: string
  names: { task: string; session: string }
}

/** A helper on the machine `reached`: the run asked of it, and the child of
 * the chat `parent` that stands for it here, holding the brief and where it
 * went, which no runner here takes up. */
let onMachine = async (
  store: OperatorStore,
  reached: typeof fetch,
  space: Space,
  parent: string,
  asked: { brief: string; title: string; model?: string },
  scope: Bundle | undefined,
) => {
  let r = await reached('http://machine/session/spawn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(asked),
  })
  let said = await r.json().catch(() => ({})) as
    & Partial<Spawned>
    & { error?: { message?: string } }
  if (!r.ok || !said.task || !said.session) {
    throw refuse(
      'machine',
      `Your machine did not start the helper (${r.status}): ${
        said.error?.message ?? 'it said nothing more'
      }`,
    )
  }
  let session = crypto.randomUUID()
  let names = `${said.names?.task ?? said.task} ${
    said.names?.session ?? said.session
  }`
  await store.g.apply([
    {
      entity: { eid: session },
      session: { id: session },
      spawned: { parent, notice: true },
      ...scope?.operator_session
        ? { operator_session: scope.operator_session }
        : {},
      operator_machine: {
        space: space.eid,
        task: said.task,
        session: said.session,
        names,
      },
      ...asked.title ? { doc: { title: asked.title } } : {},
    },
    {
      entity: { eid: derivedEid(`${session}:input`) },
      entry: { session, from: 'your parent session' },
      content: { body: asked.brief },
    },
    // The chat takes up the report when it comes, however long ago it closed.
    { entity: { eid: parent }, completed: null },
  ], { trusted: true })
  return {
    session,
    parent,
    text:
      `Helper ${session} started on your machine as ${names}. Its report goes to chat ${parent}.`,
  }
}

/**
 * What a machine said about `about` (`text`, the knock `key` names), as the
 * report of the helper here that runs as that task there ({@link onMachine}):
 * its answer, which reaches its chat as every helper's does. Answers the
 * helper, or nothing where no helper runs as `about`, which leaves the words
 * to whatever else takes in a machine's word.
 */
export let machineReport = async (
  store: OperatorStore,
  told: { about?: string; text: string; key: string },
): Promise<string | undefined> => {
  if (!told.about) return
  let [helper] = await store.g.read(
    line`.operator_machine.task=${told.about}&.spawned&.fields=entity.eid`,
  )
  let session = helper?.entity.eid
  if (!session) return
  await store.g.apply([{
    entity: { eid: derivedEid(`operator-machine-report|${told.key}`) },
    entry: { session },
    content: { body: told.text },
    output: { source: derivedEid(`${session}:input`) },
  }], { trusted: true })
  await deliverChild(store.g, session)
  return session
}

/**
 * The run on its machine of the helper a stop entry (`stop`) ends, asked to
 * stop there (`POST /session/stop`, @yaks/spawn/routes), through the machine
 * `reach` finds for the helper as it found it to start the run: nothing where
 * the stopped session is no machine's helper. A machine that cannot be
 * reached, or does not stop the run, fails the effect, which tries again and
 * is reported.
 */
export let stopOnMachine = async (
  store: OperatorStore,
  reach: (session: string) => Promise<typeof fetch | null>,
  stop: string,
) => {
  let [entry] = await store.g.get([stop], ['entry'])
  let session = String((entry?.entry as Comp | undefined)?.session ?? '')
  let [helper] = session
    ? await store.g.get([session], ['operator_machine'])
    : []
  let on = helper?.operator_machine as Comp | undefined
  if (!on) return
  let reached = await reach(session)
  if (!reached) {
    throw new Error(`No machine reaches helper ${session} to stop ${on.names}`)
  }
  let r = await reached('http://machine/session/stop', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session: on.session }),
  })
  if (!r.ok) {
    throw new Error(
      `The machine did not stop ${on.names} (${r.status}): ${await r.text()}`,
    )
  }
}

export let questionNotice = async (
  store: OperatorStore,
  context: ToolContext | undefined,
  question: string,
) => {
  if (
    !context || await noticeParent(store.g, context.session) == context.session
  ) return
  await store.g.apply(
    await raiseNotice(
      store.g,
      context.session,
      `Needs you, from helper/chat ${context.session}:\n${question}\nThe choices are in your Updates.`,
      derivedEid(`operator-question:${context.call.entity.eid}`),
    ),
    { trusted: true },
  )
}

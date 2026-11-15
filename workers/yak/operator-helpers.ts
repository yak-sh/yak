// Outside helpers belong to a caller-owned chat, never the person's main
// thread. Questions for the person cross that boundary as passive notices.
import type { Bundle, Comp } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import {
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
    let links = await store.g.read(`.contains&.edge.from=${open}`)
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
  { store, choose }: Pick<Operator, 'store' | 'choose'>,
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
  let selected = await choose(
    held,
    space,
    typeof args.model == 'string' ? args.model : undefined,
  )
  let session = await spawnChild(store.g, parent, {
    prompt: brief,
    model: selected.model,
    ...typeof args.title == 'string' ? { title: args.title } : {},
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

// Outside helpers belong to a caller-owned chat, never the person's main
// thread. Questions for the person cross that boundary as passive notices.
import type { Bundle, Comp } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { noticeParent, raiseNotice, type ToolContext } from '@yaks/session'
import { owns } from './operator-access.ts'
import type { Held } from './build-door.ts'
import type { OperatorStore } from './operator-store.ts'
import { refuse } from './tool.ts'

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

/** Runtime inspection and explicit actions. Reads never wake a session. */
import { type Bundle, type Comp, type Graph, token } from '@yaks/graph'
import type { Agent } from './run.ts'

export type RuntimeAction = 'interrupt' | 'cancel-queued' | 'resume'
export let runtimeRows = async (
  g: Graph,
  session: string,
): Promise<Bundle[]> => {
  let [selected, children] = await Promise.all([
    g.read('.session&.entity.eid=' + session),
    g.read('.session&.spawned.parent=' + session),
  ])
  return await Promise.all([...selected, ...children].map(async (b) => {
    let id = b.entity.eid
    let [attempt] = await g.read(
      '.entry.session=' + id +
        '&.attempt.state=inflight&.order=-entry.seq&.limit=1',
    )
    let [tail] = await g.read(
      '.entry.session=' + id + '&.notice=&.order=-entry.seq&.limit=1',
    )
    let [call] = await g.read(
      '.entry.session=' + id + '&.call&.order=-entry.seq&.limit=1',
    )
    let waiting = call &&
      !(await g.read('.result.call=' + call.entity.eid + '&.limit=1')).length
    // Project existing facts only; nothing is written back as duplicate status.
    return {
      ...b,
      ...attempt ? { attempt: attempt.attempt } : {},
      ...waiting ? { call: call.call } : {},
      ...tail?.error ? { error: tail.error } : {},
      ...(attempt ?? tail)?.created
        ? { updated: (attempt ?? tail)!.created }
        : {},
    }
  }))
}

export let runtimeAction = async (
  a: Pick<Agent, 'h' | 'd' | 'send'>,
  session: string,
  action: RuntimeAction,
): Promise<string> => {
  let [row] = await a.h.g.read('.session&.entity.eid=' + session)
  if (!row) throw new Error('Session not found')
  if (action == 'interrupt') {
    let active = await a.h.g.read(
      '.entry.session=' + session + '&.attempt.state=inflight',
    )
    if (!active.length || !a.d.interrupt(session)) {
      return 'No cancellable model request is running.'
    }
    return 'Cancellation requested. Provider must acknowledge abort; independent processes are unchanged.'
  }
  if (action == 'cancel-queued') {
    return a.d.enqueue(session, async () => {
      let [row] = await a.h.g.read('.session&.entity.eid=' + session)
      if (!row) throw new Error('Session not found')
      if ((row.dispatch as Comp | undefined)?.state != 'queued') {
        throw new Error('Only queued work can be cancelled here')
      }
      // Preconditions prevent cancelling a child that started while the view was open.
      await a.h.g.apply([{
        entity: row.entity,
        dispatch: { state: 'settled' },
        $was: { dispatch: { state: token('queued') } },
      }, {
        entity: { eid: crypto.randomUUID() },
        entry: { session },
        stop: {},
        content: {
          body:
            'Queued session cancelled by the user; task state is unchanged.',
        },
      }], { trusted: true })
      return 'Queued session cancelled. Its task was not cancelled.'
    })
  }
  if (action != 'resume') throw new Error('Unknown runtime action')
  let [tail] = await a.h.g.read(
    '.entry.session=' + session + '&.notice=&.order=-entry.seq&.limit=1',
  )
  let interrupted = (tail?.error as Comp | undefined)?.code == 'interrupted'
  if ((row.session as Comp).status != 'settled' && !interrupted) {
    throw new Error(
      'Continue requires idle or interrupted work; other failures and stopped work are not replayed',
    )
  }
  await a.send(
    session,
    'Continue from the current state. Preserve completed work; do not repeat completed tool operations.',
  )
  return 'Continuation input submitted; the previous request was not replayed.'
}

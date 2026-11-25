/**
 * An Operator conversation a yaks.app bug stopped, taken up again once the
 * bug is fixed, so the person's work recovers without their asking.
 *
 * Its report names its space as whose stopped work it is (operator.ts
 * `unfinished`, the tag `rerun`), and the conversation keeps the fault the
 * report was filed under as `stalled{fault}`. The platform tracker's
 * resolution of the bug hands the space the faults its occurrences were
 * filed under (@yaks/tracker/effects `settle`), through the kernel's `Reruns`
 * entrypoint ({@link reruns}) to the space's Operator ({@link rerun}): each
 * conversation stalled on one is said to again, on the `fixed` channel, in
 * the task or conversation it stopped in, once for each bug. Its answer tells
 * the person so in their Updates (operator.ts `answered`). The rerun keeps
 * what made the stopped words wait for the person's tap: the conversation
 * keeps how they came and the number a tap goes to (operator.ts `carrying`),
 * and the `fixed` words, the platform's own, are `heard` where someone
 * else's steered the stopped turn (operator-approvals.ts `steering`).
 */
import { line as q } from '@yaks/query'
import type { Bundle, Comp } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { enqueue } from '@yaks/effects'
import { steered, topOf, transcript } from '@yaks/session'
import type { Explanation } from '@yaks/tracker/resolution'
import type { OperatorStore } from './operator-store.ts'
import type { Env } from './env.ts'
import type { Request } from './operator-channels.ts'

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

/** What a fixed bug hands back: the faults its reports of the space's
 * stopped work were filed under, the bug, and how it was fixed. */
export type Rerun = { faults: string[]; bug: string; said?: Explanation }

/** Take up again, in `space`'s Operator, each conversation stalled on one of
 * `faults`: a request on the `fixed` channel for the person whose
 * conversation it is, carrying on its task where it has one, named by the bug
 * and the conversation so a second hand-back of the same fix asks nothing.
 * The conversation is no longer stalled. Answers the requests it made. */
export let rerun = async (
  store: OperatorStore,
  space: string,
  { faults, bug, said }: Rerun,
): Promise<string[]> => {
  let { receive } = await import('./operator-channels.ts')
  let named = new Set(faults)
  // A store holds few stalled conversations, each until its bug is fixed.
  let stalled = (await store.g.read(q`.stalled .fields=stalled.fault`))
    .filter((b) => named.has(String(comp(b, 'stalled')?.fault)))
  let made: string[] = []
  for (let { entity: { eid: session } } of stalled) {
    let id = derivedEid(`operator-rerun|${bug}|${session}`)
    let top = await topOf(store.g, session)
    // Whose words it carried on, as its newest request says, and the task
    // it works on, where it has one.
    let [[had], [newest], [link], lines] = await Promise.all([
      store.g.get([id]),
      store.g.read(
        q`.operator_request.session=${top} .order=-created.at .limit=1 .fields=operator_request`,
      ),
      store.g.read(q`.contains .edge.to=${top}`),
      transcript(store.g, session),
    ])
    let asked = comp(newest, 'operator_request')
    let task = comp(link, 'edge')?.from
    if (!had && asked?.person && asked.space == space) {
      let request: Request = {
        space,
        person: String(asked.person),
        channel: 'fixed',
        about: session,
        ...task ? { task: String(task) } : {},
        ...asked.administrative ? { administrative: true } : {},
      }
      // The words are the platform's own: where someone else's steered the
      // stopped turn, worked for its person (@yaks/session `steered`), they
      // steer its rerun too.
      await receive(store, request, said?.cause || 'It was not explained.', {
        id,
        title: 'Taken up again: yaks.app fixed what stopped it',
        heard: steered(lines, request.person),
      })
      await enqueue(store.g, 'operator_receive', id)
      made.push(id)
    }
    await store.g.apply([{ entity: { eid: session }, stalled: null }], {
      trusted: true,
    })
  }
  return made
}

/** The kernel's side: a space the tracker names, by eid, whose Operator is
 * asked to {@link rerun}; a space gone, or trashed, has nothing to run. */
export let reruns = async (
  env: Env,
  space: string,
  asked: Rerun,
): Promise<void> => {
  let { directoryOf } = await import('./directory.ts')
  let at = await directoryOf(env.STORE).at(space)
  if (!at || at.trashed) return
  let { builderOf, SPACE } = await import('./build-door.ts')
  let response = await builderOf(env, space)(() =>
    new Request('https://builder/operator/rerun', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yak-kernel': '1',
        [SPACE]: space,
      },
      body: JSON.stringify(asked),
    })
  )
  if (!response.ok) {
    throw Error(
      `the Operator refused a rerun (${response.status}): ${await response
        .text()}`,
    )
  }
  await response.body?.cancel()
}

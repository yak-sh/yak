// The code behind `session_run` where a `yak` host lists the harness,
// exported as `@yaks/harness/effects`: the runner (@yaks/session `running`)
// lent this machine, as the harness on its own lends it (./local.ts `here`).
// @yaks/session declares the effect and knows nothing of a machine; the
// harness handles it because the machine is the harness's to lend. What the
// box opened is let go after the host's admitted work drains.

import { promptEntry } from '@yaks/context'
import { type Comp, derivedEid, Refused } from '@yaks/graph'
import { instructionsFor } from './instructions.ts'
import type { Handlers } from '@yaks/effects'
import type { Host } from '@yaks/host'

import { running } from '@yaks/session'
import { lend } from './agent.ts'
import { here } from './local.ts'
import { hosted } from './store.ts'
import { unfinishedEach } from './unfinished.ts'
import { overheadEach } from './overhead.ts'
import { machines } from './session_machines.ts'

/** The runner, lent this machine, over the host's graph. The plugin's options
 * may name `compactAt`, the share of its model's context window a transcript
 * fills before it is compacted (half where absent); the model a session asks
 * by default is graph data (./default.ts `defaultUsing`). */
export let effects = (
  host: Host,
  options: Record<string, unknown> = {},
): Handlers => {
  let { lent } = here(hosted(host), {
    compactAt: typeof options.compactAt == 'number'
      ? options.compactAt
      : undefined,
  })
  host.defer(() => lent.release?.())
  let binding = machines(
    host.graph,
    host.sandboxes,
    host.resolveHome,
    host.workspaces,
  )
  let runner = lend(lent)
  let g = host.graph
  let entries = (session: string, q: string) =>
    g.read(`.entry.session=${session}&${q}&.limit=1&.fields=entity.eid`)
  // The instructions a transcript opens with, admitted once before it is
  // answered, when whoever began it wrote none: an HTTP fixer's (its home,
  // its claimed task or project), or the persona a session wears, as any door
  // writes it (a browser's chat names the persona and its first message, no
  // more). A persona is admitted only before the first turn, so a session
  // whose persona owes nothing beside its files is not asked again.
  let opening = async (session: string) => {
    let [owner] = await g.get([session])
    let s = owner?.session as Comp | undefined
    if (
      !s || s.ended || ['stopped', 'failed'].includes(String(s.status))
    ) return
    let fixer = !!owner.fixer && !owner.process && !owner.stop
    let persona = typeof s.persona == 'string' ? s.persona : undefined
    if (!fixer && !persona) return
    try {
      if (fixer) {
        // HTTP fixer requests use the native runner, not an outside CLI. An
        // existing managed run keeps its original owner across config
        // changes.
        if (!owner.native) {
          await g.apply([{ entity: { eid: session }, native: {} }], {
            trusted: true,
          })
        }
        await binding.cwd(session)
        ;[owner] = await g.get([session])
      } else if ((await entries(session, '.ask')).length) return
      // Preparation is restartable. Admit each immutable source only once.
      if ((await entries(session, '.prompt')).length) return
      let work = fixer
        ? (await g.read(`.claim.session=${session}&.task&.limit=1`))[0]
          ?.entity.eid ?? (owner.filed as Comp | undefined)?.project
        : undefined
      let files = await instructionsFor(
        g,
        { ...owner.home as Comp | undefined },
        host.workspaces,
        { persona, work: work as string | undefined },
      )
      if (files.length) {
        await g.apply(
          files.map((file) =>
            promptEntry(
              session,
              undefined,
              file.body,
              file.source,
              'shared',
              file.revision,
            )
          ),
          { trusted: true },
        )
      }
    } catch (error) {
      // Configuration cannot improve by repeating the same preparation.
      // Keep a terminal answer in the transcript, also seen after restart.
      if (!(error instanceof Refused)) throw error
      let [last] = await g.read(
        `.entry.session=${session}&.order=-entry.seq&.limit=1`,
      )
      await g.apply([{
        entity: {
          eid: derivedEid(`${session}:binding-refusal:${last.entity.eid}`),
        },
        entry: { session },
        refusal: { code: 'context' },
        content: { body: error.message },
      }], { trusted: true })
    }
  }
  return {
    ...running(host.graph, {
      ...runner,
      each: overheadEach(host, unfinishedEach(host, runner.each)),
      answers: async (using, session) => {
        if (!await runner.answers?.(using, session)) return false
        if (session) await opening(session)
        return true
      },
      stopping: host.stopping,
    }),
  }
}

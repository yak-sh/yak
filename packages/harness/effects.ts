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
 * by default is graph data (./model_selection.ts `defaultUsing`). */
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
  return {
    ...running(host.graph, {
      ...runner,
      each: overheadEach(host, unfinishedEach(host, runner.each)),
      answers: async (using, session) => {
        if (!await runner.answers?.(using, session)) return false
        if (!session) return true
        let [fixer] = await host.graph.get([session], [
          'fixer',
          'process',
          'stop',
        ])
        if (!fixer?.fixer || fixer.process || fixer.stop) return true
        let [owner] = await host.graph.get([session])
        // HTTP fixer requests use the native runner, not an outside CLI. An
        // existing managed run keeps its original owner across config changes.
        if (
          (owner.session as Comp)?.ended ||
          ['stopped', 'failed'].includes(
            String((owner.session as Comp)?.status),
          )
        ) return true
        if (!owner.native) {
          await host.graph.apply([{
            entity: { eid: session },
            native: {},
          }], { trusted: true })
        }
        try {
          await binding.cwd(session)
          ;[owner] = await host.graph.get([session])
          let home = owner.home as Comp
          let previous = await host.graph.read(
            `.entry.session=${session}&.prompt&*`,
          )
          // Preparation is restartable. Admit each immutable source only once.
          if (!previous.length) {
            let work = await host.graph.read(
              `.claim.session=${session}&.task&.limit=1&*`,
            )
            let files = await instructionsFor(
              host.graph,
              home,
              host.workspaces,
              {
                persona: (owner.session as Comp).persona as string | undefined,
                work: work[0]?.entity.eid ??
                  (owner.filed as Comp | undefined)?.project as
                    | string
                    | undefined,
              },
            )
            if (files.length) {
              await host.graph.apply(
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
          }
        } catch (error) {
          // Configuration cannot improve by repeating the same preparation.
          // Keep a terminal answer in the transcript, also seen after restart.
          if (!(error instanceof Refused)) throw error
          let [last] = await host.graph.read(
            `.entry.session=${session}&.order=-entry.seq&.limit=1`,
          )
          await host.graph.apply([{
            entity: {
              eid: derivedEid(`${session}:binding-refusal:${last.entity.eid}`),
            },
            entry: { session },
            refusal: { code: 'context' },
            content: { body: error.message },
          }], { trusted: true })
        }
        return true
      },
      stopping: host.stopping,
    }),
  }
}

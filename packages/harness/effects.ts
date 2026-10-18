// The code behind `session_run` where a `yak` host lists the harness,
// exported as `@yaks/harness/effects`: the runner (@yaks/session `running`)
// lent this machine, as the harness on its own lends it (./local.ts `here`).
// @yaks/session declares the effect and knows nothing of a machine; the
// harness handles it because the machine is the harness's to lend. What the
// box opened is let go when the host stops.

import { promptEntry } from '@yaks/context'
import { type Comp, derivedEid, Refused } from '@yaks/graph'
import { instructionsFor } from './instructions.ts'
import { owing } from './session_machines.ts'
import type { Handlers } from '@yaks/effects'
import type { Host } from '@yaks/host'

import { running } from '@yaks/session'
import { lend } from './agent.ts'
import { here } from './local.ts'
import { hosted } from './store.ts'
import { unfinishedEach } from './unfinished.ts'
import { overheadEach } from './overhead.ts'
import { machineDone, machines } from './session_machines.ts'

let word = (options: Record<string, unknown>, name: string) =>
  typeof options[name] == 'string' ? options[name] : undefined

/** The runner, lent this machine, over the host's graph. The model to ask for
 * by default and its provider may be named in the plugin's options, and so
 * may `compactAt`, the share of its model's context window a transcript fills
 * before it is compacted (half where absent). */
export let effects = (
  host: Host,
  options: Record<string, unknown> = {},
): Handlers => {
  let { lent } = here(hosted(host), {
    name: word(options, 'name'),
    provider: word(options, 'provider'),
    compactAt: typeof options.compactAt == 'number'
      ? options.compactAt
      : undefined,
  })
  host.stopping.addEventListener('abort', () => void lent.release?.(), {
    once: true,
  })
  let binding = machines(host.graph, host.machines, host.workspaces)
  let release = async (id: string) => {
    let [session] = await host.graph.get([id])
    if (session && await machineDone(host.graph, session)) {
      await binding.release(id)
    }
  }
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
            let files = await instructionsFor(
              host.graph,
              host.machines,
              home,
              host.workspaces,
            )
            files.push(
              ...await owing(
                host.graph,
                home,
                files,
                (owner.session as Comp).persona as string | undefined,
              ),
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
      idle: release,
    }),
    session_machine_release: async (event: import('@yaks/graph').Bundle) => {
      let [subject] = await host.graph.get([event.entity.eid])
      let candidates = subject?.session ? [subject] : []
      let entry = subject?.entry as import('@yaks/graph').Comp | undefined
      if (entry?.session) {
        candidates.push(...await host.graph.get([String(entry.session)]))
      }
      let claim = subject?.claim as import('@yaks/graph').Comp | undefined
      if (subject?.completed && claim?.session) {
        candidates.push(...await host.graph.get([String(claim.session)]))
      }
      for (let session of candidates) {
        await release(session.entity.eid)
      }
    },
  }
}

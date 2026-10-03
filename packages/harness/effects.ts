// The code behind `session_run` where a `yak` host lists the harness,
// exported as `@yaks/harness/effects`: the runner (@yaks/session `running`)
// lent this machine, as the harness on its own lends it (./local.ts `here`).
// @yaks/session declares the effect and knows nothing of a machine; the
// harness handles it because the machine is the harness's to lend. What the
// box opened is let go when the host stops.

import type { Handlers } from '@yaks/effects'
import type { Host } from '@yaks/cli/host'
import { running } from '@yaks/session'
import { lend } from './agent.ts'
import { here } from './local.ts'
import { hosted } from './store.ts'
import { inboxHandlers, type InboxOptions } from './answering.ts'
import { instructionFiles } from '@yaks/context/host'
import { homeAt, owing } from './workspace.ts'

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
  let handlers = running(host.graph, { ...lend(lent), stopping: host.stopping })
  let inbox = options.inbox as InboxOptions | undefined
  if (!inbox?.person) {
    return { ...handlers, inbox_answer: () => {}, inbox_publish: () => {} }
  }
  return {
    ...handlers,
    ...inboxHandlers(host, {
      ...inbox,
      holder: host.me,
      gone: host.gone,
      stopping: host.stopping,
      opening: async () => {
        let cwd = Deno.cwd()
        let home = await homeAt(host.graph, cwd)
        let files = await instructionFiles(cwd)
        return {
          home,
          files: [...files, ...await owing(host.graph, home, files)],
        }
      },
    }),
  }
}

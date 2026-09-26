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

let word = (options: Record<string, unknown>, name: string) =>
  typeof options[name] == 'string' ? options[name] : undefined

/** The runner, lent this machine, over the host's graph. The model to ask for
 * by default and its provider may be named in the plugin's options. */
export let effects = (
  host: Host,
  options: Record<string, unknown> = {},
): Handlers => {
  let { lent } = here(hosted(host), {
    name: word(options, 'name'),
    provider: word(options, 'provider'),
  })
  host.stopping.addEventListener('abort', () => void lent.release?.(), {
    once: true,
  })
  return running(host.graph, {
    ...lend(lent),
    stopping: host.stopping,
    gone: host.gone,
  })
}

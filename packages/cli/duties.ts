// The box-specific opening module handed to @yaks/threads: composition stays
// here; the Worker and its lifecycle belong to threads.
import { become } from '@yaks/process'
import type { Host, Start } from '@yaks/threads'
import { read } from './config.ts'
import { compose, facet } from './host.ts'

export let open = async ({ data, me, roles }: Start<string>): Promise<Host> => {
  become(me)
  let host = await compose(read(data), ['graph', ...roles], facet)
  return {
    duties: (signal, only) => host.duties(signal, only),
    nudge: () => host.fx.wake(),
    stop: () => host.stop(),
    close: () => host.close(),
  }
}

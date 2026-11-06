// Plain tool answers, shared by the CLI and HTTP consumers of a host.
import type { Bundle } from '@yaks/graph'
import type { Host } from '@yaks/host'
import { type Drawn, registry } from './answer.ts'
import { show } from './terminal.ts'
import { pluginViews, used } from './config.ts'

export let text = (
  host: Pick<Host, 'config' | 'graph' | 'vocab' | 'observe'>,
) => {
  let views: ReturnType<typeof registry> | undefined
  return async (answer: Bundle[], tool?: Drawn): Promise<string> => {
    views ??= registry(
      (host.config.plugins ?? []).map(used),
      pluginViews,
      host.observe,
    )
    let lines: string[] = []
    await show(
      { tui: false, out: (line) => lines.push(line) },
      await views,
      host.vocab,
      answer,
      {},
      {
        lookup: (ids) => host.graph.get(ids),
        query: (q) => host.graph.read(q),
      },
      tool,
    )
    return lines.join('\n')
  }
}

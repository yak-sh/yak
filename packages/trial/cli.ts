// `yak trial`: score every case the graph holds under a variant, write each
// trial row, and print the tally. The work is ./moment.ts's; this only hands
// it the host's storage and search.
import type { CliCommand } from '@yaks/cli/host'

export let commands: CliCommand[] = [{
  name: 'trial',
  description:
    'Score every miss in the graph under a persona (by default the one each session wore): writes trial{case, variant, asked, unasked, tokens} and prints the tally.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      variant: { type: 'string', description: 'persona eid to score' },
    },
  },
  positional: ['variant'],
  run: async (args, host, context) => {
    let { cases, run } = await import('./moment.ts')
    let { tally } = await import('./mod.ts')
    if (!host.search) throw new Error('this graph has no search')
    let all = await cases(host.storage)
    let rows = []
    for (let c of all) {
      let row = await run(
        host.storage,
        host.vocab,
        host.search,
        c,
        typeof args.variant == 'string' ? args.variant : undefined,
      )
      if (row) rows.push(row)
    }
    if (rows.length) await host.graph.apply(rows)
    context.out(JSON.stringify(tally(rows, all), null, 2))
    return 0
  },
}]

// A person's own space minted inside the write that mints it (T-148852): the
// request `$own{person, want?}` becomes the batch directory.ts `owning`
// decides over this transaction's own reads, so it reads the person's seats,
// their row and which addresses are free as the write finds them. Two asks at
// once (a sign-in settling behind its answer, and the first page it sent the
// person to) are two transactions one after the other, and the second finds
// the first's seat and writes nothing. Before, the gateway read, decided and
// wrote in five trips, and an ask landing between another's reads minted a
// second space at the next free address.
//
// The platform's alone: what it writes is the kernel's (a person's `started`,
// a space's `starter`), so a request that is not trusted is refused.
import type { Bundle, Plugin, Tx } from '@yaks/graph'
import { hook } from '@yaks/graph/plugin'
import { Refused } from '@yaks/graph/errors'
import { after, each } from '@yaks/fp'
import { directoryRows, type Row } from '../directory.ts'

type Own = { person: string; want?: string }

// The directory's decisions over this transaction: its reads are the
// write's own, and it writes nothing itself.
let over = (tx: Tx) =>
  directoryRows({
    query: async (q) =>
      (await tx.read(q) as Row[]).map((row) => ({
        ...row,
        policy: { revision: 0 },
      })),
    apply: () => {
      throw new Error('a write decided inside another writes nothing itself')
    },
  })

export let plugins = (): Plugin[] => [{
  name: 'yak/directory',
  requests: ['$own'],
  authorize: hook(['$own'], (bundles, tx, _err, context) => {
    if (!bundles.some((b) => b.$own)) return bundles
    if (!context?.trusted) {
      throw new Refused('only the platform mints a person their own space')
    }
    return each(
      bundles,
      [] as Bundle[],
      (out, b) => {
        if (!b.$own) return [...out, b]
        let { person, want } = b.$own as Own
        return after(
          over(tx).owning(person, want),
          (wrote) => [...out, ...wrote],
        )
      },
    )
  }),
}]

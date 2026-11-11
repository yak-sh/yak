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
import type { Bundle, Plugin } from '@yaks/graph'
import { hook } from '@yaks/graph/plugin'
import { Refused } from '@yaks/graph/errors'
import { after, each } from '@yaks/fp'
import { inside } from '../directory.ts'

type Own = { person: string; want?: string }

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
          inside(tx).owning(person, want),
          (wrote) => [...out, ...wrote],
        )
      },
    )
  }),
}]

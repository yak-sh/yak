// Mint each deployed version as a Git commit.
import { minting } from '@yaks/git'
import type { Bundle } from '@yaks/graph'
import type { Handlers } from '@yaks/effects'
import type { Options } from './store.ts'

export let effects = (_host: unknown, options: Options): Handlers => {
  let at = options.store
  if (!at.meta) return {}
  return {
    git_mint: async (event, tx, write) => {
      let [row] = await tx.get([event.entity.eid])
      if (!row?.deploy || row.tombstone) return
      let { releases } = await import('../gitobj.ts')
      let dir = {
        read: async (line: string) => await tx.read(line),
        write: (bundles: Bundle[]) => Promise.resolve(write(bundles)),
      }
      await minting(releases(at.env, dir))([row], tx)
    },
  }
}

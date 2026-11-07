// A test account's end: on yaks.app (workers/yak/erase.ts), and on this box,
// where every connection to it goes with it. A credential the box kept for a
// person who is gone is only a way to write them back (T-144541).
import { type Ctx, disconnect, toAccount } from '@yaks/connections'
import { CallError } from '@yaks/tools/errors'
import { closeAccount, type Closed } from './api.ts'

/** What erasing took: the account's, and how many of this box's connections
 * to it ended. `gone` is an account the platform had already erased, as its
 * daily sweep does. */
export type Erased = Closed & { gone: boolean; connections: number }

/** End this box's yaks.app connections to an account, answering how many. */
export let forget = async (c: Ctx, address: string): Promise<number> => {
  let kept = await toAccount(c.graph.read, 'yaks.app', address)
  for (let b of kept) await disconnect(c, b.entity.eid)
  return kept.length
}

/** Erase a test account as `bearer`, and end this box's connections to it,
 * also when the account was gone already. A check changes nothing, and counts
 * the connections that would end. */
export let erase = async (
  c: Ctx,
  bearer: string,
  address: string,
  check = false,
): Promise<Erased> => {
  let closed = await closeAccount(bearer, address, check).then(
    (closed) => ({ ...closed, gone: false }),
    (error) => {
      if (error instanceof CallError && error.code == 'no_account') {
        return { address, erased: false, gone: true, spaces: [], seats: [] }
      }
      throw error
    },
  )
  let connections = check
    ? (await toAccount(c.graph.read, 'yaks.app', address)).length
    : await forget(c, address)
  return { ...closed, connections }
}

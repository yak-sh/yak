// View lifecycles for live query subscriptions. The board hook opens the
// shadow set beside the complete cache and closes it with the last view.
import { useEffect } from 'preact/hooks'
import { boardQuery, boardSub } from '../live.ts'
import { type Ent } from '../types.ts'

export let useBoardSub = (e?: Ent) => {
  let q = String(e?.board?.query ?? '')
  useEffect(() => e ? boardSub(e) : undefined, [e?.eid])
  useEffect(() => {
    if (e) boardQuery(e)
  }, [e?.eid, q])
}

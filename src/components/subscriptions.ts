// View lifecycles for live query subscriptions. The board hook opens the
// shadow set beside the complete cache and closes it with the last view.
import { useEffect } from 'preact/hooks'
import {
  boardQuery,
  boardSub,
  boardTallyLine,
  boardTallyName,
  dropAgg,
  holdAgg,
} from '../live.ts'
import { type Ent } from '../types.ts'

export let useBoardSub = (e?: Ent) => {
  let q = String(e?.board?.query ?? '')
  useEffect(() => e ? boardSub(e) : undefined, [e?.eid])
  useEffect(() => {
    if (e) boardQuery(e)
  }, [e?.eid, q])
}

// The tile's half of a board: its status COUNTS, held for the tile's life and
// closed by the last one. The aggregate is keyed by the BOARD, so a query edit
// re-asks under the same name (live.ts aggQuery) rather than churning the hold.
export let useBoardTally = (e?: Ent) => {
  useEffect(() => {
    if (!e) return
    let line = boardTallyLine(e)
    if (!line) return
    let name = boardTallyName(e)
    holdAgg(name, line)
    return () => dropAgg(name)
  }, [e?.eid])
}

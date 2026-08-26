// View lifecycles for live query subscriptions. The board hook opens the
// shadow set beside the complete cache and closes it with the last view; the
// entity hooks hold ONE row (and its edges) for as long as a view paints it.
import { useEffect } from 'preact/hooks'
import {
  boardQuery,
  boardSub,
  boardTallyLine,
  boardTallyName,
  dropAgg,
  holdAgg,
  routeSub,
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

// The entity a view PAINTS but no enclosing subscription delivers — held for
// the view's life (T-22371). The working-set boot used to walk one hop from
// every card and preseed whatever it pointed at, which is how a pinned card had
// a row to render; that hop is gone, so whatever paints another entity by eid
// SAYS so, and the row — with the `.edges!` rider's edges and their far
// endpoints — streams in on mount and is evicted with the last view of it.
export let useEntity = (eid?: string) => {
  useEffect(() => eid ? routeSub(eid) : undefined, [eid])
}

// The same hold for a LIST of pins. The canvas List face and the tray's shelf
// chips paint a pin's target without mounting a Card, so they hold it here; the
// joined key means a re-render that moves no pin re-subscribes nothing.
export let usePinTargets = (ps: { target: string }[]) => {
  let key = ps.map((p) => p.target).join(',')
  useEffect(() => {
    let offs = key ? key.split(',').map((t) => routeSub(t)) : []
    return () => {
      for (let off of offs) off()
    }
  }, [key])
}

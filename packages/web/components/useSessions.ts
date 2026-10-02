import { useEffect, useState } from 'preact/hooks'
import { leaseEid } from '../../effects/lease.ts'
import { ent } from '../live.ts'
import { type RunnerLease, trayLive, traySessions } from '../sessions.ts'
import { type Ent, vocab } from '../types.ts'
import {
  trayActiveQuery,
  trayProcessQuery,
  trayRecentQuery,
} from '../tray_query.ts'
import { useQueryResult } from './useQuery.ts'

// Both surfaces own the same bounded subscriptions; the query layer shares
// their wire reads. Leases are one projected batch over these candidates only.
export let useSessions = (enabled = true) => {
  let query = (line: string) => vocab.comp('session') ? line : ''
  let active = useQueryResult(query(trayActiveQuery), enabled, true).eids
  let process = useQueryResult(query(trayProcessQuery), enabled, true).eids
  let recent = useQueryResult(query(trayRecentQuery), enabled, true).eids
  let ids = [...new Set([...active, ...process, ...recent])].sort()
  let leaseIds = new Set(
    useQueryResult(
      ids.length
        ? `.entity.eid=${
          ids.map((id) => leaseEid(`@yaks/session/run/${id}`)).join(',')
        }` +
          '&.fields=lease.holder,lease.until'
        : '',
      enabled && ids.length > 0,
      true,
    ).eids,
  )
  let leases: Record<string, RunnerLease> = Object.fromEntries(
    ids.map((id) => {
      let eid = leaseEid(`@yaks/session/run/${id}`)
      return [id, leaseIds.has(eid) ? ent(eid).lease ?? {} : {}]
    }),
  )
  let [now, setNow] = useState(Date.now())
  // Deadline expiry need not write to the graph. Wake at the next one so
  // expired leases no longer keep old sessions ahead of the newest few.
  let until = Math.min(
    ...Object.values(leases).flatMap((l) => {
      let at = Date.parse(l.until ?? '')
      return l.holder && at > Date.now() ? [at] : []
    }),
  )
  useEffect(() => {
    setNow(Date.now())
    if (!Number.isFinite(until)) return
    let timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(0, until - Date.now()), 2147483647),
    )
    return () => clearTimeout(timer)
  }, [until])
  let rows: [string, Ent][] = ids.flatMap((eid) => {
    let e = ent(eid)
    return e.session && (recent.includes(eid) || trayLive(e, leases[eid], now))
      ? [[eid, e]]
      : []
  })
  return { rows: traySessions(rows, leases, now), leases }
}

// Payload-free CDP attribution: all inbound UTF-8 bytes, row identities only.
// Subscriptions overlap, so per-sub ID counts are NOT additive. Exclusive IDs
// occur in just one sub; ids permits same-snapshot union/difference analysis.
type Event = {
  method: string
  params?: { response?: { payloadData?: string } }
}
type Frame = {
  sub?: string
  q?: string
  changes?: { eid?: string }[]
  peers?: { eid?: string }[]
  snapshot?: { changes?: { eid?: string }[] }
}
export let wireBreakdown = (events: Event[]) => {
  let subs = new Map<string, {
    sub: string
    query?: string
    bytes: number
    frames: number
    ids: Set<string>
    members: Set<string>
    peers: Set<string>
  }>()
  for (let event of events) {
    let text = event.params?.response?.payloadData
    let sent = event.method == 'Network.webSocketFrameSent'
    let received = event.method == 'Network.webSocketFrameReceived'
    if (!text || (!sent && !received)) continue
    let frame: Frame = {}
    try {
      frame = JSON.parse(text) ?? {}
    } catch { /* Control bytes still count in the unaddressed bucket. */ }
    if (sent && !frame.sub) continue
    let sub = frame.sub ?? '(unaddressed)'
    let row = subs.get(sub)
    if (!row) {
      row = {
        sub,
        bytes: 0,
        frames: 0,
        ids: new Set(),
        members: new Set(),
        peers: new Set(),
      }
      subs.set(sub, row)
    }
    if (sent) {
      row.query = frame.q
      continue
    }
    row.bytes += new TextEncoder().encode(text).length
    row.frames++
    for (let c of [...frame.changes ?? [], ...frame.snapshot?.changes ?? []]) {
      if (c.eid) {
        row.ids.add(c.eid)
        row.members.add(c.eid)
      }
    }
    for (let c of frame.peers ?? []) {
      if (c.eid) {
        row.ids.add(c.eid)
        row.peers.add(c.eid)
      }
    }
  }
  let owners = new Map<string, number>()
  for (let row of subs.values()) {
    for (let id of row.ids) owners.set(id, (owners.get(id) ?? 0) + 1)
  }
  return [...subs.values()].map((row) => ({
    ...row,
    distinctIDs: row.ids.size,
    exclusiveIDs: [...row.ids].filter((id) => owners.get(id) == 1).length,
    ids: [...row.ids].sort(),
    members: row.members.size,
    peers: row.peers.size,
  })).sort((a, b) => b.bytes - a.bytes || a.sub.localeCompare(b.sub))
}

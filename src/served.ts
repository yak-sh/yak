// Who a claude process serves: the ONE session its channel plugin delivers
// to. A pid names a PROCESS, not a conversation — /clear reifies a NEW
// session entity under the same one, so a pid can wear several rows, and
// the newest (highest num) is the live conversation; the rest are ghosts
// nothing renders for. A subagent is a tool call INSIDE its operator's
// process and reifies wearing no pid at all (cli.ts) — a child has no
// process of its own to claim.
//
// Two sides ask this question and must answer it the same: the knock
// ladder, deciding whether to stamp `cast` (door.ts, over SQL rows), and
// the channel plugin, deciding whom to deliver to (channels/tasks, over
// its stream index). While the copies were independent they disagreed,
// and a knock stamped a confident lie — `cast S-…` for a session that
// never heard it (T-7288). So the rule lives here, once, db-free so both
// may import it.

export type Seat = {
  eid: string
  num: number
  pid?: number | null
  id?: string | null
}

// A conversation row always carries the provider's session id — reify
// keys on it (SessionStart, the managed launcher). A row wearing the pid
// WITHOUT one is an artifact (a hand-reified probe row, a malformed
// reify), and letting it win by recency shadows the live conversation:
// everything aimed at the operator session goes invisible while the
// channel serves a row nothing renders for (T-15147's channel half —
// S-14232 sat sid-less on the operator's pid and ate its comments). So
// the newest sid-bearing row is the seat; only a pid with no sid-bearing
// rows at all falls back to bare recency.
export let served = (seats: Seat[], pid?: number | null): Seat | undefined => {
  if (pid == null) return undefined
  let worn = seats.filter((s) => s.pid == pid).sort((a, b) => b.num - a.num)
  return worn.find((s) => s.id) ?? worn[0]
}

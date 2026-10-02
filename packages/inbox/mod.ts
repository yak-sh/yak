/** Pure attention policy shared by every inbox door. No I/O or sends. */
export type Row = {
  eid: string
  comps: Record<string, Record<string, unknown>>
}

// The notification lifecycle (T-7006), read as pure Row-predicates over
// the stamp components: presence is the fact, absence the earlier state.
// Only `archived` hides an item from the inbox — no automated path can
// drain it; `opened` only marks it read. So the one hiding stamp is a
// deliberate operator act, and the inbox is drain-proof by construction.
export let inInbox = (r: Row) => !r.comps.archived
export let isUnread = (r: Row) => !r.comps.opened

// Who an inbox reads FOR: the session S acting for actor A, standing in
// project P, holding the eids it CLAIMS. Every "addressed to me" test
// below is a pure fact about the graph, so membership can't drift.
export type Reader = {
  session?: string
  actor?: string
  scope?: string
  // Whether this reader is the project's operator loop. Non-operators get no
  // project-wide mail or actor knocks, only direct address and claimed work.
  operator?: boolean
  claims?: Set<string>
  // The addresses this reader answers to (its actor's, plus the actor's own
  // eid, which is how a letter names a recipient before delivery resolves
  // it). A letter reaches a PERSON this way — they stand in no project, so
  // the scope arm below says nothing about them.
  addrs?: Set<string>
  // The entities this actor has a standing instruction about: watch them
  // though nothing is aimed at me, mute them though something is. Absent
  // from both is the default, which is whatever addressed() says.
  watching?: Set<string>
  muting?: Set<string>
}

// What an inbox item is ABOUT — a subscription is aimed at the task or
// the venture, never at the individual letter, so this is the eid the
// watch/mute sets are asked about.
export let aboutOf = (r: Row) =>
  String(
    r.comps.comment?.target ?? r.comps.signal?.target ??
      r.comps.mail?.target ?? r.comps.knock?.target ?? '',
  )

// Every entity this actor has said something about, split by mode.
export let subsOf = (all: Row[], actor?: string) => {
  let watching = new Set<string>(), muting = new Set<string>()
  if (actor) {
    for (let r of all) {
      let sub = r.comps.subscription
      if (!sub || String(sub.actor) != actor) continue
      ;(sub.mode == 'mute' ? muting : watching).add(String(sub.target))
    }
  }
  return { watching, muting }
}

// Addressed to this reader — the four doors an item reaches attention
// through: a comment on work it claims or on the session itself, a knock aimed
// at the session or its actor, or mail that ARRIVED
// (message_id is the inbound mark; sent mail carries none). One predicate,
// so the digest, the TUI, and the web read the SAME inbox.
export let addressed = (who: Reader) => (r: Row): boolean => {
  let c = r.comps.comment
  if (c) {
    let t = String(c.target ?? '')
    // Said TO the actor, not just to one of its sessions: an operator loop
    // outlives the session that happened to be running when someone spoke
    // to the venture, so a comment on P-19 must reach whoever runs P-19 —
    // it was unheard by anyone otherwise. Gated on `operator` exactly like
    // the actor knock below, so a specialist still hears only direct
    // address and its own claimed work.
    return t == who.session || !!who.claims?.has(t) ||
      (who.operator == true && !!who.actor && t == who.actor)
  }
  // A notice reaches the same doors a comment does — claimed work, the
  // session itself, or the actor for an operator loop — but it was emitted,
  // not said (D-13858). Same addressing, different provenance.
  let n = r.comps.signal
  if (n) {
    let t = String(n.target ?? '')
    return t == who.session || !!who.claims?.has(t) ||
      (who.operator == true && !!who.actor && t == who.actor)
  }
  let k = r.comps.knock
  if (k) {
    // WHO the knock is for rides the shared `deliver {to}` facet now.
    let t = String(r.comps.deliver?.to ?? '')
    return !!t &&
      (t == who.session || (who.operator == true && t == who.actor))
  }
  let m = r.comps.mail
  if (m) {
    // An arrival, never a letter still going out — message_id is the
    // inbound mark, and it screens both arms below.
    if (!m.message_id) return false
    // A letter to your SESSION is direct address, so it lands whatever loop
    // you run — the same rule the comment and knock arms above already
    // follow. Sessions are addressable by id (`S-31@<fleet domain>`), and
    // gating that on `operator` would resolve the
    // address perfectly and then tell nobody.
    if (who.session && String(m.target) == who.session) return true
    // Project mail reaches only the operator loop, never a specialist.
    if (who.operator != true) return false
    // Two ways a letter is yours, and the FIRST is what a person has: it
    // was sent to an address you answer to. A person stands in no project,
    // so the scope arm says nothing about them — and a reader with neither
    // arm matches NOTHING rather than the fleet's whole correspondence
    // (1338 arrived letters in a week: the wrong default is a firehose,
    // not an inconvenience).
    return (!!who.addrs?.size && who.addrs.has(String(m.to ?? ''))) ||
      (!!who.scope && String(m.target) == who.scope)
  }
  return false
}

// The inbox: addressed to me and NOT archived. Unread within it is
// isUnread (NOT opened) — the two derived predicates the design names.
//
// A standing instruction OVERRIDES the addressed-to default, on what the
// item is about rather than the item itself. Mute wins even over direct
// address: it is the operator saying a thread is finished, and a rule
// that quietly declines to obey that is worse than one that obeys it
// too well — `--all` is the way back, the same as everywhere else.
export let inboxItem = (who: Reader) => {
  let to = addressed(who)
  return (r: Row) => {
    if (!inInbox(r)) return false
    let about = aboutOf(r)
    if (about && who.muting?.has(about)) return false
    if (about && who.watching?.has(about)) return true
    return to(r)
  }
}

// The reader an inbox reads for, resolved from the graph in one place:
// the session named, the actor it acts for, the project it stands in, and
// the eids it claims — everything addressed() needs.
// Every address an actor answers to: the address book entry it carries,
// and its own eid — a letter names its recipient by reference and only
// resolves to an address at delivery (M-4063), so both forms appear in the
// stored row depending on when you look.
export let addrsOf = (all: Row[], actor?: string): Set<string> => {
  let out = new Set<string>()
  if (!actor) return out
  out.add(actor)
  let a = all.find((r) => r.eid == actor)?.comps.email?.address
  if (a) out.add(String(a))
  return out
}

// The reader a WEB client reads for. A browser has no session — its
// identity is the actor its client entity names — and a person browsing
// their own graph IS the loop, which is all `operator` has ever meant.
// No claims: leases belong to sessions, and a person holds none.
export let readerAt = (all: Row[], actor?: string): Reader => ({
  actor,
  operator: true,
  claims: new Set(),
  addrs: addrsOf(all, actor),
  scope: all.find((r) => r.eid == actor)?.comps.project ? actor : undefined,
  ...subsOf(all, actor),
})

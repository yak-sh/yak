// The doctor: a registry of checks that read the live graph and make the
// impossible states we can already see LOUD — a claim held by a session
// that ended, a board whose query no longer parses, an arrived letter with
// no sender. Each check is one ROW (name + about + a run() over the graph),
// so the next one is a row, not a verb (see `checks` below and M-4066).
//
// The mail check is the first and oldest entry: every address the graph can
// mint mail for must be Cloudflare-deliverable. The failure it exists for is
// SILENT — an address with no routing rule and the catch-all off is accepted
// at send and dropped at Cloudflare with no bounce (ufos@, T-6262) — so it
// reads the LIVE rule set; a hand-maintained expected list is exactly how the
// drift hid. The static snapshot below is the degrade seam for when no token
// can read Email Routing, and it says so loudly. CLIENT-SAFE: the checks read
// through the Querier (HTTP) and env + fetch only, never the db directly.
import { base } from './mailer.ts'
import { atFleet, canon } from './mailaddr.ts'
import { idOf, sessionActive } from './types.ts'
import { parseQuery } from './query.ts'
import { integrity } from './client.ts'
import type { Querier, Row } from './client.ts'
import type { Anomalies } from './db.ts'

// The yak.sh zone — an identifier, not a secret (useless without a
// token); CLOUDFLARE_ZONE_ID re-aims the doctor at another zone.
let ZONE = 'a0879bd97b46bc6d35cb60b3e831c8d8'

export type Rule = { value: string; enabled: boolean }
export type Rules = { live: boolean; catchall: boolean; rules: Rule[] }

// NOT AUTHORITATIVE — a checked-in snapshot of the rule set, used only
// when nothing on the box can read Email Routing. It drifts from
// Cloudflare silently, which is the whole disease this doctor treats, so
// a rule-dependent verdict read from here is reported as UNVERIFIED
// rather than as a failure (`fromRules: true` on the finding, `?` at the
// renderer). A snapshot that merely LOOKS current is how `task@` was
// reported as silently dropping while letters were landing in it
// (T-10480) — believe the live read or believe a probe, never this list.
//
// There are no literal rules left to drift: Email Routing is ONE catch-all
// to the inbox worker, so the address book is the only place that decides
// where a letter goes, and a new operator address is a graph row rather
// than a dashboard visit. What still bites is an illegal local-part,
// rejected at RCPT upstream of every rule — and `canon` decides that
// without consulting anything here.
//
// Reading it live is NOT an env-token job: the credential that carries
// Email Routing scope on this box is the **MCP Cloudflare server**
// (OAuth, no inline token), reachable from a session that has it — which
// is why every bearer token in .env fails this call with code 10000. So
// refreshing this list is an agent errand, not a config change. If a
// read-only routing token is ever minted, put it in
// CLOUDFLARE_ROUTING_READ_TOKEN and live mode takes over.
export let STATIC_RULES: Rules = {
  live: false,
  // The zone catch-all is ENABLED and covers the fleet subdomain,
  // proven by a probe pair to one unruled local-part 88s apart: E-11328
  // (before the flip) never arrived, E-11329 (after) round-tripped in
  // 288ms, verified. The apex is not at risk and never was: yak.sh MX is
  // Google Workspace, so Cloudflare receives no @yak.sh mail to catch.
  catchall: true,
  // Empty because it IS empty — all twelve per-address rules were deleted
  // 2026-07-30, each having pointed at the same worker the catch-all does.
  // Re-probed after: mailtest@ and taskmaster@ (the two with no book entry,
  // so they ride Cloudflare instead of local-first delivery) both arrived
  // verified with no rule of their own.
  rules: [],
}

// The book the doctor checks: every email-comp wearer still in play —
// a retired project's address is history, not a delivery promise.
export type Entry = { address: string; owner: string }
export let bookOf = (all: Row[]): Entry[] =>
  all
    .filter((r) =>
      r.comps.email?.address && !(r.comps.project && r.comps.archived)
    )
    .map((r) => ({
      address: String(r.comps.email.address),
      owner: `${idOf(r)} ${r.comps.doc?.title ?? ''}`.trim(),
    }))

// The diagnosis, pure — the tested seam. Only fleet-domain addresses are
// ours to judge (external mailboxes route however their domain likes).
// Deliverable = legal local-part AND (an enabled literal rule, or the
// catch-all catching). Caveat the flip must verify (T-5837): a zone
// catch-all has not covered the fleet subdomain historically — if
// it reads enabled here, probe before trusting it.
// `fromRules` says whether the verdict DEPENDS on the rule set, and it is
// the whole difference between a measurement and a guess. A bad local-part
// is decided by `canon` alone — authoritative in either mode. "No routing
// rule" is only as true as the rules we read, so against the snapshot it
// is unverified, and the renderer must not dress it as a failure.
export type Finding = Entry & { problem: string; fromRules: boolean }
export let diagnose = (book: Entry[], r: Rules): Finding[] =>
  book.filter((e) => atFleet(e.address)).flatMap(
    (e): Finding[] => {
      if (canon(e.address) != e.address) {
        return [{
          ...e,
          fromRules: false,
          problem: `illegal local-part — Cloudflare bounces it at RCPT, ` +
            `upstream of every rule; canonical is ${canon(e.address)}`,
        }]
      }
      let ruled = r.rules.some((x) =>
        x.enabled && x.value.toLowerCase() == e.address.toLowerCase()
      )
      return ruled || r.catchall ? [] : [{
        ...e,
        fromRules: true,
        problem: r.live
          ? 'no enabled routing rule and the catch-all is off — ' +
            'sends report success, mail drops silently'
          : 'no rule in the checked-in snapshot — UNVERIFIED, not a ' +
            'measurement: the snapshot has drifted before (task@, T-10480). ' +
            'Read the live rules before filing this as a defect',
      }]
    },
  )

// The live rule set: literal to-matchers plus the catch-all's state
// (enabled AND not action=drop is what makes it a delivery path).
// null = no token on box — the caller degrades to the snapshot; a
// token that can't read (wrong scope) throws instead, so a misminted
// token is a loud fact, never a silent degrade.
export let liveRules = async (): Promise<Rules | null> => {
  // ONE name, deliberately. CLOUDFLARE_TASKS_TOKEN used to be the
  // fallback, but it is proven NOT to carry Email Routing scope (code
  // 10000, same as every other bearer token on this box) — so naming it
  // here turned the loud-failure branch into a guaranteed false alarm on
  // any box that loads holdco's .env, while the branch was meant to catch
  // a MISMINTED token. A token that cannot read still throws; a box with
  // no token degrades to the snapshot and says so.
  let token = Deno.env.get('CLOUDFLARE_ROUTING_READ_TOKEN')
  if (!token) return null
  let zone = Deno.env.get('CLOUDFLARE_ZONE_ID') ?? ZONE
  let get = async (path: string) => {
    let res = await fetch(`${base()}/zones/${zone}/email/routing${path}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    let body = await res.json().catch(() => ({}))
    if (!res.ok || !body.success) {
      throw new Error(`GET email/routing${path}: HTTP ${res.status}`)
    }
    return body
  }
  type Wire = {
    enabled?: boolean
    matchers?: { type: string; field?: string; value?: string }[]
    actions?: { type: string }[]
  }
  let rules: Rule[] = []
  for (let page = 1;; page++) {
    let body = await get(`/rules?page=${page}&per_page=50`)
    for (let r of (body.result ?? []) as Wire[]) {
      for (let m of r.matchers ?? []) {
        if (m.type == 'literal' && m.field == 'to' && m.value) {
          rules.push({ value: m.value, enabled: !!r.enabled })
        }
      }
    }
    let info = body.result_info
    if (!info || page * info.per_page >= info.total_count) break
  }
  let ca = (await get('/rules/catch_all')).result as Wire | undefined
  let catchall = !!ca?.enabled &&
    !(ca.actions ?? []).some((a) => a.type == 'drop')
  return { live: true, catchall, rules }
}

// ---- The check registry -------------------------------------------------
//
// A finding is `fail` (a measured contract violation — `task doctor` exits
// non-zero) or `warn` (a soft leak, or an UNVERIFIED verdict read off the
// static snapshot). A check that itself throws is turned into a `fail` by the
// runner — a doctor that swallows its own breakage is the exact disease it
// treats ("a surface that discards its evidence is the bug").
export type Level = 'fail' | 'warn'
export type Report = { level: Level; text: string }
export type Check = {
  name: string
  about: string
  run: (q: Querier, now: number) => Promise<Report[]>
}

// The mail check, as the first registry entry: the deliverability diagnosis
// above, rendered as findings. A rule-dependent verdict read from the static
// snapshot is only a `warn` (UNVERIFIED); an illegal local-part or a
// live-confirmed drop is a `fail`. The snapshot caveat rides along only when
// a verdict actually leaned on it — a clean book needs no disclaimer.
export let mailCheck: Check = {
  name: 'mail',
  about: 'every book address is Cloudflare-deliverable',
  run: async (q) => {
    let book = bookOf(await q(['.email.address!']))
    let out: Report[] = []
    let rules: Rules | null = null
    try {
      rules = await liveRules()
    } catch (e) {
      // A token that cannot read throws — a misminted token is a loud fact,
      // worth surfacing whether or not it changes a verdict.
      out.push({
        level: 'warn',
        text: `live routing read failed (${(e as Error).message}) — ` +
          `falling back to the static snapshot`,
      })
    }
    let live = rules?.live ?? false
    rules ??= STATIC_RULES
    let bad = diagnose(book, rules)
    for (let f of bad) {
      out.push({
        level: f.fromRules && !live ? 'warn' : 'fail',
        text: `${f.address} (${f.owner}) — ${f.problem}`,
      })
    }
    if (!live && bad.some((f) => f.fromRules)) {
      out.push({
        level: 'warn',
        text: 'the rule-dependent verdicts above come from the STATIC ' +
          'snapshot (not authoritative) — read the live rules to confirm',
      })
    }
    return out
  },
}

// An arrived letter (message_id or received_at set) with no `from` is the
// exact silent bug we memorialized: mail.from sat in neither comps nor
// stamped and every reply misrouted (M-17876). `from` is server-stamped now,
// so its absence on an arrived letter means the stamp broke — a reply with
// nowhere to go, which is why this is a `fail`.
export let mailWithoutFrom = (rows: Row[]): Report[] =>
  rows.flatMap((r): Report[] => {
    let m = r.comps.mail
    if (!m || !(m.message_id || m.received_at) || m.from) return []
    return [{
      level: 'fail',
      text: `${idOf(r)} arrived with no sender — a reply has nowhere to go ` +
        `(mail.from is server-stamped; its absence means the stamp broke)`,
    }]
  })

// A board is a saved query; if it stops parsing, opening the board errors
// instead of listing. An empty query means every task (valid), so only a
// non-empty one that throws is a finding.
export let brokenBoards = (rows: Row[]): Report[] =>
  rows.flatMap((r): Report[] => {
    let query = r.comps.board?.query
    if (typeof query != 'string' || !query.trim()) return []
    try {
      parseQuery(query)
      return []
    } catch (e) {
      return [{
        level: 'fail',
        text: `${idOf(r)} query no longer parses ` +
          `(${(e as Error).message}): ${query}`,
      }]
    }
  })

// Mirrors types.ts awake() over a row's raw session facet, sharing the one
// sessionActive list: a session is ended when it is not active AND not
// holding an open external door (a live pid with no finish stamp).
let facet = (r: Row) => r.comps.session ?? {}
let ended = (f: Record<string, unknown>) =>
  !sessionActive.includes(String(f.status)) && !(f.pid && !f.finished_at)

// A task still leased by a session that has ended: death:'release' should
// have detached the claim when the session died, and wrap releases it on a
// graceful end — so a live lease held by an ended (or vanished) session is a
// leak that makes the board lie about who is working. A `warn`: stale, not
// corrupt.
export let staleClaims = (claimed: Row[], sessions: Row[]): Report[] => {
  let byEid = new Map(sessions.map((s) => [s.eid, s]))
  return claimed.flatMap((r): Report[] => {
    let sid = r.comps.claim?.session
    if (!sid) return []
    let s = byEid.get(String(sid))
    if (s && !ended(facet(s))) return []
    return [{
      level: 'warn',
      text: `${idOf(r)} is claimed by ${s ? idOf(s) : String(sid)}, which ` +
        `has ended — the lease should have been released`,
    }]
  })
}

// A session stuck between states: 'starting' should be brief, and a stop that
// was requested long ago with no finish means the signal went unheard. A
// long-RUNNING session is healthy work, never a finding — only the stalled
// transitions are. `warn`: a stuck process, not corrupt data.
export let stuckSessions = (rows: Row[], now: number, hours = 2): Report[] => {
  let old = (t: unknown) => {
    let at = Date.parse(String(t ?? ''))
    return !isNaN(at) && now - at > hours * 3_600_000
  }
  return rows.flatMap((r): Report[] => {
    let s = facet(r)
    if (s.finished_at) return []
    if (String(s.status) == 'starting' && old(s.started_at)) {
      return [{
        level: 'warn',
        text: `${idOf(r)} has been starting for over ${hours}h with no ` +
          `finish — the launch stalled or its finish stamp was lost`,
      }]
    }
    if (s.stop_requested_at && old(s.stop_requested_at)) {
      return [{
        level: 'warn',
        text: `${idOf(r)} was asked to stop over ${hours}h ago but never ` +
          `finished — the stop signal went unheard`,
      }]
    }
    return []
  })
}

// Storage-integrity anomalies (D-18866, T-18874), read from the raw db scan the
// wire cannot expose (orphaned component rows and dangling {eid} references are
// invisible to snapshot()/query by construction — the exact reason they hid).
// Each is corruption the id-keyed schema rejects outright, so a `fail`; a server
// too old to carry the /integrity route answers null, reported as an unverified
// `warn` rather than a false all-clear. Pre-cutover this is the gate; afterward
// it is ongoing drift monitoring — the reshape cleaned the graph, so it stays 0.
export let integrityReport = (a: Anomalies | null): Report[] => {
  if (!a) {
    return [{
      level: 'warn',
      text: 'this server has no /integrity route — the storage-anomaly scan ' +
        'is UNVERIFIED (upgrade the server to run it)',
    }]
  }
  let out: Report[] = []
  for (let [table, n] of Object.entries(a.orphans)) {
    out.push({
      level: 'fail',
      text: `${table}: ${n} orphaned row(s) — the owner entity has no spine ` +
        `(dead data the id-keyed schema rejects)`,
    })
  }
  for (let [col, n] of Object.entries(a.dangling)) {
    out.push({
      level: 'fail',
      text: `${col}: ${n} reference(s) to a missing entity (a dangling ` +
        `{eid} ref the id-keyed schema rejects)`,
    })
  }
  return out
}

// Governed durable work and knowledge must be reachable from a project through
// dependency parent→child edges. The raw recursive scan is server-side because
// detached cycles look internally connected to any client-side local walk; the
// project-root seed is what proves they are orphans.
export let projectOrphans = (a: Anomalies | null): Report[] => {
  if (!a?.unrooted) {
    return [{
      level: 'warn',
      text: 'this server does not report project reachability — the governed ' +
        'corpus check is UNVERIFIED (upgrade the server to run it)',
    }]
  }
  if (!a.unrooted.length) return []
  return [{
    level: 'fail',
    text: `${a.unrooted.length} governed entity(s) are outside every ` +
      `project-rooted dependency closure: ${a.unrooted.join(', ')}`,
  }]
}

// The ANN index has exactly ONE writer: the process running the embed sweep,
// which claims it with ownVector() (D-22530 — a write-capable extension lives
// only where its write does). The failure this exists for is the 2026-08-26
// split-brain (T-22622): dispatch moved to its own daemon, the daemon's --join
// connection had never run vector_init, and every rebuild it attempted threw
// "Vector context not found" — while the server, which HAD the context, kept
// quantizing on its READ path. Silent from the outside: writes land, search
// answers, the neighbours are just quietly frozen at the last good rebuild.
//
// The tell is a dirty mark that outlives the sweep interval. The sweep clears
// it in the same tick that dirties it, so a mark older than a few intervals
// means nobody is quantizing.
export let vectorStale = (
  a: Anomalies | null,
  now: number,
  minutes = 30,
): Report[] => {
  let v = a?.vector
  if (!a || !v) {
    return [{
      level: 'warn',
      text: 'this server does not report vector-index state — the ANN ' +
        'maintenance check is UNVERIFIED (upgrade the server to run it)',
    }]
  }
  if (!v.dirty || !v.rows) return []
  let at = Date.parse(String(v.newest ?? ''))
  if (isNaN(at) || now - at <= minutes * 60_000) return []
  return [{
    level: 'fail',
    text: `the ANN index has been dirty since ${v.newest} (${v.rows} ` +
      `embeddings) — nothing has quantized it in over ${minutes}m, so ` +
      `semantic search is answering frozen neighbours. No process claimed ` +
      `the vector write, or the owner's connection never ran vector_init`,
  }]
}

// Deliverables (knock/wake/mail) are outbox rows: created, then settled
// delivered or error by the effects dispatcher — inline in the server, or the
// effects daemon in split mode (D-22388 step 3). A pending row growing old
// means NOBODY is dispatching: the daemon died and its supervisor is not
// healing it, or a split server runs with no daemon at all. That failure is
// otherwise silent — writes succeed, the board looks normal, letters just
// never leave — which is exactly the class the doctor exists for. A wake is
// pending ON PURPOSE until its hour, so only a wake whose `at` has passed
// counts.
export let undispatched = (
  rows: Row[],
  now: number,
  minutes = 10,
): Report[] => {
  let old = (t: unknown) => {
    let at = Date.parse(String(t ?? ''))
    return !isNaN(at) && now - at > minutes * 60_000
  }
  let stale = rows.filter((r) => {
    if (!r.comps.deliver || r.comps.delivered || r.comps.error) return false
    if (r.comps.mail?.message_id || r.comps.mail?.received_at) return false // inbound: arrival is its settlement
    let due = r.comps.wake ? r.comps.wake.at : r.comps.created?.at
    return old(due)
  })
  if (!stale.length) return []
  return [{
    level: 'warn',
    text:
      `${stale.length} deliverable(s) pending over ${minutes}m (${
        stale.slice(0, 5).map((r) => idOf(r)).join(', ')
      }${stale.length > 5 ? ', …' : ''}) — nothing is dispatching effects: ` +
      `check the effects daemon (effectsd, TASKS_EFFECTS=daemon) or the ` +
      `server's inline dispatcher`,
  }]
}

// The registry. A new check is one more row here — its verdict a pure
// function above, its run() a thin read through the Querier.
export let checks: Check[] = [
  mailCheck,
  {
    name: 'mail-from',
    about: 'every arrived letter carries a sender',
    run: async (q) => mailWithoutFrom(await q(['.kind=mail'])),
  },
  {
    name: 'board',
    about: 'every saved board query still parses',
    run: async (q) => brokenBoards(await q(['.kind=board'])),
  },
  {
    name: 'claim',
    about: 'no entity is leased by a session that has ended',
    run: async (q) =>
      staleClaims(await q(['.claim.session!']), await q(['.kind=session'])),
  },
  {
    name: 'session',
    about: 'no session is stuck starting or stuck stopping',
    run: async (q, now) => stuckSessions(await q(['.kind=session']), now),
  },
  {
    name: 'storage',
    about: 'no orphaned component rows or dangling entity references',
    run: async () => integrityReport(await integrity()),
  },
  {
    name: 'project-root',
    about: 'all durable work and knowledge is reachable from a project',
    run: async () => projectOrphans(await integrity()),
  },
  {
    name: 'vector',
    about: 'the ANN index is being rebuilt by the sweep that owns it',
    run: async (_q, now) => vectorStale(await integrity(), now),
  },
  {
    name: 'effects',
    about: 'deliverables are being dispatched (effects daemon / inline)',
    run: async (q, now) =>
      undispatched(
        (await Promise.all(
          [['.kind=knock'], ['.kind=wake'], ['.kind=mail']].map((f) => q(f)),
        )).flat(),
        now,
      ),
  },
]
// Future rows, each one entry once its signal exists: a managed session
// 'running' with a dead pid (needs a /proc probe), a derived sweep that
// stopped moving (personas, embed, inbound, backup — needs a last-run
// cadence to compare against), an {eid} reference pointing at a tombstone.

// Run a set of checks, turning a crash into a loud `fail` rather than a lost
// diagnosis. `now` is injectable so the time-based checks are testable.
export type Result = { name: string; about: string; reports: Report[] }
export let run = (
  list: Check[],
  q: Querier,
  now = Date.now(),
): Promise<Result[]> =>
  Promise.all(list.map(async (c): Promise<Result> => {
    // try/catch, not `.catch`: a check that throws SYNCHRONOUSLY never returns
    // a promise to hang a handler on, and swallowing its own breakage is the
    // exact disease the doctor treats.
    try {
      return { name: c.name, about: c.about, reports: await c.run(q, now) }
    } catch (e) {
      return {
        name: c.name,
        about: c.about,
        reports: [{
          level: 'fail',
          text: `the check itself crashed — ${(e as Error).message}`,
        }],
      }
    }
  }))

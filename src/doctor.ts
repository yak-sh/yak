// The mail doctor: every address the graph can mint mail for must be
// Cloudflare-deliverable. The failure it exists for is SILENT — an
// address with no routing rule and the catch-all off is accepted at
// send and dropped at Cloudflare with no bounce (ufos@, T-6262) — so
// the check must read the LIVE rule set; a hand-maintained expected
// list is exactly how the drift hid. The static snapshot below is the
// degrade seam for when no token can read Email Routing, and it says
// so loudly. CLIENT-SAFE: env + fetch only, no db.
import { base, canon } from './mailer.ts'
import { idOf } from './types.ts'
import type { Row } from './client.ts'

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
// renderer).
//
// It has already drifted once, expensively: `task` and `taskmaster` were
// added to Cloudflare on 2026-07-23 08:25Z and verified end-to-end at
// 09:42Z (T-5837), but this list was reconciled just before that and kept
// a date that made it look current. The doctor then reported
// `✗ task@bot.yak.sh — mail drops silently` for months while letters were
// arriving at it, and that verdict was filed as a production defect
// (T-10480). Both entries are restored below on two independent proofs:
// the live probe recorded on T-5837, and a DKIM-verified letter from
// Gmail that reached task@ and minted E-10458 off the edge spool.
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
  catchall: false, // zone catch-all is disabled (action: drop)
  rules: [
    'holdco',
    'printbound',
    'crayonbloom',
    'cafecar',
    'homelab',
    'trading',
    'zestful',
    'harness',
    'mailtest',
    'ufos',
    'task', // added + verified live 2026-07-23 (T-5837)
    'taskmaster', // ditto
  ].map((v) => ({ value: `${v}@bot.yak.sh`, enabled: true })),
}

// The book the doctor checks: every email-comp wearer still in play —
// a retired project's address is history, not a delivery promise.
export type Entry = { address: string; owner: string }
export let bookOf = (all: Row[]): Entry[] =>
  all
    .filter((r) => r.comps.email?.address && !r.comps.project?.retired_at)
    .map((r) => ({
      address: String(r.comps.email.address),
      owner: `${idOf(r)} ${r.comps.doc?.title ?? ''}`.trim(),
    }))

// The diagnosis, pure — the tested seam. Only bot.yak.sh addresses are
// ours to judge (external mailboxes route however their domain likes).
// Deliverable = legal local-part AND (an enabled literal rule, or the
// catch-all catching). Caveat the flip must verify (T-5837): a zone
// catch-all has not covered the bot.yak.sh subdomain historically — if
// it reads enabled here, probe before trusting it.
// `fromRules` says whether the verdict DEPENDS on the rule set, and it is
// the whole difference between a measurement and a guess. A bad local-part
// is decided by `canon` alone — authoritative in either mode. "No routing
// rule" is only as true as the rules we read, so against the snapshot it
// is unverified, and the renderer must not dress it as a failure.
export type Finding = Entry & { problem: string; fromRules: boolean }
export let diagnose = (book: Entry[], r: Rules): Finding[] =>
  book.filter((e) => /@bot\.yak\.sh$/i.test(e.address)).flatMap(
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

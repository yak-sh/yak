// A person's own domain, on Cloudflare's side (T-33038). The `hostname`
// component says which place a domain serves — a space, or one app of it
// (platform.rs, T-33037, T-34596) — and index.ts already routes by it; this
// file is the other half: the custom hostname at Cloudflare, and a plain
// reading of how far provisioning has come. Nothing here knows or cares which
// of the two a hostname carries.
//
// The three tools over it live in tools.ts. What is here is the account API
// and the mapping, because the mapping is the part that has to be right: an
// agent walking a person through their registrar can only say "your CNAME
// hasn't arrived yet" instead of "it's still pending" if we hand it the
// difference. So `steps()` joins the ownership check to Cloudflare's verdicts:
// the records they added, the hostname Cloudflare accepted and the certificate
// it issued. A word we have never seen falls
// through as `waiting` carrying that word, which is the truth: we do not know
// it, and pretending it is fine would be worse.
//
// The custom hostname is keyed by the hostname on both sides, so Cloudflare's
// own id is never stored (platform.rs): one copy of the fact, and it cannot
// drift. Every call here looks the hostname up by name.
//
// The token is the platform's own (CF_HOSTNAMES_TOKEN, `wrangler secret put`):
// Zone → SSL and Certificates → Edit on the yaks.app zone, and nothing else.
// Unset, every door here refuses saying so — a domain half-attached would
// leave a billable hostname at Cloudflare with nothing pointing at it.
import { answered } from './dispatch.ts'
import { resent } from './workers_api.ts'
import type { Env } from './env.ts'
import { apex as hostApex, type Host } from './host.ts'
import { type Host as Hostname, stamp } from './directory.ts'
import { token } from '@yaks/graph/sha256'

export let needsHostnames = (env: Host = {}) =>
  'the platform has no Cloudflare token to attach custom hostnames with ' +
  `(CF_HOSTNAMES_TOKEN, Zone → SSL and Certificates → Edit on ${
    hostApex(env)
  }) — ` +
  'a domain cannot be provisioned until it is set. Every space still ' +
  `answers at <space>.${hostApex(env)}`

export let NEEDS_HOSTNAMES = needsHostnames()

export let NEEDS_ZONE =
  'the platform does not know which Cloudflare zone to attach a custom ' +
  'hostname to (CF_ZONE) — a domain cannot be provisioned until it is set'

// A hostname's shape, and nothing about who owns it: labels of letters,
// digits and dashes, at least two of them, 253 bytes at most.
export let HOST =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

// A registry's own second level, for the apex hint below. Not a public
// suffix list — a list is a thing to forget — just the handful that make
// `herbusiness.co.uk` three labels and still an apex.
let SECOND = /^(?:co|com|net|org|edu|gov|ac|or|ne|nom|sch|ltd|plc|firm|gen)$/

// Whether this looks like a domain's apex — the bare name with nothing in
// front — which is the one place DNS forbids a CNAME, and the step where a
// person gives up. A hint, and said as one wherever it is printed: the agent
// reading the answer already knows whether the person's domain has a label
// in front of it, and this only saves it having to say so.
export let apex = (host: string) => {
  let l = host.split('.')
  return l.length == 2 ||
    (l.length == 3 && SECOND.test(l[1]) && l[2].length == 2)
}

// The DNS a person adds: the hostname aimed at the fallback origin (route.ts
// origin), and this attachment's ownership TXT challenge at its separate name.
export type Rec = { type: string; name: string; value: string }

export let records = (
  host: string,
  env: Host = {},
  verification?: Partial<Rec> | null,
): Rec[] => [
  { type: 'CNAME', name: host, value: `origin.saas.${hostApex(env)}` },
  ...txt(verification) ? [{ ...verification as Rec, type: 'TXT' }] : [],
]

let txt = (r?: Partial<Rec> | null): r is Rec =>
  r?.type?.toLowerCase() == 'txt' && !!r.name && !!r.value

// The custom hostname as Cloudflare answers it — the fields read here, and
// no more. `verification_errors` is what it says about the hostname pointing
// at us; `ssl` is the certificate's own half.
export type Custom = {
  id: string
  hostname: string
  status?: string
  verification_errors?: string[]
  ownership_verification?: { type: string; name: string; value: string }
  ssl?: {
    status?: string
    validation_errors?: { message?: string }[]
  }
}

let api = (env: Env, path: string) =>
  `${env.HOSTNAMES_API ?? 'https://api.cloudflare.com/client/v4'}` +
  `/zones/${env.CF_ZONE}/custom_hostnames${path}`

let sent = (env: Env, path: string, init: RequestInit = {}) =>
  resent(api(env, path), {
    ...init,
    headers: {
      authorization: `Bearer ${env.CF_HOSTNAMES_TOKEN}`,
      ...(init.headers as Record<string, string> ?? {}),
    },
  })

// Whether this platform can reach Cloudflare at all. Every door asks first,
// because the alternative to refusing is a half-attached domain.
export let reachable = (env: Env) => {
  if (!env.CF_ZONE) throw new Error(NEEDS_ZONE)
  if (!env.CF_HOSTNAMES_TOKEN) throw new Error(needsHostnames(env))
}

// The custom hostname for this name, or null. The hostname is the key on
// Cloudflare's side too, so this is the lookup every door starts from.
export let customOf = async (env: Env, host: string) => {
  reachable(env)
  let found = await answered(
    await sent(env, `?hostname=${encodeURIComponent(host)}`),
  ) as Custom[]
  return found.find((c) => c.hostname == host) ?? null
}

// Certificate HTTP validation is separate from ownership. Cloudflare can
// activate a hostname from a leftover CNAME; only the ownership TXT challenge
// below proves the person making this attachment controls its DNS.
export let provision = async (env: Env, host: string) => {
  reachable(env)
  return await answered(
    await sent(env, '', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hostname: host,
        ssl: {
          method: 'http',
          type: 'dv',
          settings: { min_tls_version: '1.2' },
        },
      }),
    }),
  ) as Custom
}

// Give the hostname back. Answers whether there was one: a hostname
// Cloudflare has already dropped is not a failure to detach, it is a detach
// with nothing left to do.
export let release = async (env: Env, host: string) => {
  let custom = await customOf(env, host)
  if (!custom) return false
  await answered(await sent(env, `/${custom.id}`, { method: 'DELETE' }))
  return true
}

// ── Reading ownership, routing and certificate readiness ──────────────────

export type State = 'done' | 'waiting' | 'error'
export type Step = {
  step: 'ownership' | 'dns' | 'validation' | 'certificate'
  state: State
  said: string
}

// Cloudflare's hostname `status`, which is the validation step: whether it
// has accepted this hostname as one we may serve.
// developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/validation-status/
let VALID: Record<string, [State, string]> = {
  active: ['done', 'Cloudflare serves this hostname'],
  active_redeploying: ['done', 'serving, with a change going out'],
  pending: ['waiting', 'Cloudflare has not seen the record point here yet'],
  provisioning: ['waiting', 'Cloudflare is setting the hostname up'],
  moved: [
    'error',
    'the record stopped pointing here, so Cloudflare gave up on it — put ' +
    'the CNAME back and detach and attach the domain again',
  ],
  blocked: ['error', 'Cloudflare will not serve this hostname'],
  deleted: [
    'error',
    'Cloudflare dropped the hostname after a week of it pointing nowhere — ' +
    'detach the domain and attach it again',
  ],
}

// And `ssl.status`, which is the certificate step.
// developers.cloudflare.com/ssl/reference/certificate-statuses/
let CERT: Record<string, [State, string]> = {
  active: ['done', 'the certificate is issued and serving'],
  initializing: ['waiting', 'the certificate has not been asked for yet'],
  pending_validation: [
    'waiting',
    'the certificate authority is waiting for the hostname to resolve here',
  ],
  pending_issuance: ['waiting', 'the certificate authority is issuing it'],
  pending_deployment: ['waiting', 'the certificate is going out to the edge'],
  pending_deletion: ['waiting', 'the certificate is being withdrawn'],
  expired: ['error', 'the certificate expired'],
  deleted: ['error', 'the certificate is gone'],
}

// A word neither table knows: `waiting`, carrying the word itself. A timeout
// is the one shape worth recognising by pattern, because every one of them
// says the same thing and the list of them grows.
let read = (
  table: Record<string, [State, string]>,
  status: string | undefined,
): [State, string] =>
  !status ? ['waiting', 'Cloudflare has not said yet'] : table[status] ??
    (/_timed_out$/.test(status)
      ? ['error', `Cloudflare gave up: ${status.replace(/_/g, ' ')}`]
      : ['waiting', `Cloudflare says ${status.replace(/_/g, ' ')}`])

// The DNS step. Cloudflare is the one that can see whether the name resolves
// here, and it says so in `verification_errors` — "custom hostname does not
// CNAME to this zone." while the record is missing or not propagated yet. Its
// own words are handed on, because they are more specific than ours would be.
// CNAME flattening at an apex is why we ask Cloudflare rather than resolving
// the name ourselves: a flattened apex has no CNAME to find, and it works.
let dns = (c: Custom): [State, string] => {
  let errs = c.verification_errors ?? []
  let missing = errs.find((e) => /cname/i.test(e))
  if (missing) {
    return [
      'waiting',
      `${missing.replace(/\.$/, '')} — it is not added, or ` +
      'not propagated yet',
    ]
  }
  if (errs.length) return ['error', errs.join('; ')]
  if (c.status == 'moved' || c.status == 'deleted') {
    return ['error', 'the hostname stopped pointing here']
  }
  if (c.status == 'pending' && !c.ssl?.status) {
    return ['waiting', 'Cloudflare has not looked for the record yet']
  }
  return c.status == 'pending'
    ? ['waiting', 'Cloudflare is still checking where the name points']
    : ['done', 'the name resolves here']
}

let pair = ([state, said]: [State, string]) => ({ state, said })

export let steps = (c: Custom, owned = false): Step[] => {
  let bad = (c.ssl?.validation_errors ?? [])
    .map((e) => e.message).filter(Boolean).join('; ')
  let cert = read(CERT, c.ssl?.status)
  return [
    {
      step: 'ownership',
      state: owned ? 'done' : 'waiting',
      said: owned
        ? 'hostname ownership is verified'
        : 'add the ownership TXT record to verify control of this hostname',
    },
    { step: 'dns', ...pair(dns(c)) },
    { step: 'validation', ...pair(read(VALID, c.status)) },
    {
      step: 'certificate',
      ...pair(bad && cert[0] != 'done' ? ['error', bad] : cert),
    },
  ]
}

// A TXT answer consists of quoted strings; join its fragments before comparing
// the whole token. A different name, a CNAME or an unsuccessful lookup proves
// nothing. DNS is consulted only until this attachment has a durable receipt.
export let ownership = async (env: Env, record: Partial<Rec> | null) => {
  if (!txt(record)) return false
  let at = new URL(env.DNS_API ?? 'https://cloudflare-dns.com/dns-query')
  at.searchParams.set('name', record.name)
  at.searchParams.set('type', 'TXT')
  let r = await fetch(at, {
    headers: { accept: 'application/dns-json' },
    signal: AbortSignal.timeout(5000),
  })
  if (!r.ok) {
    await r.body?.cancel()
    throw new Error(`ownership TXT lookup answered ${r.status}`)
  }
  let reply = await r.json() as {
    Status: number
    Answer?: { name: string; type: number; data: string }[]
  }
  if (reply.Status != 0) return false
  let name = (s: string) => s.toLowerCase().replace(/\.$/, '')
  return (reply.Answer ?? []).some((a) => {
    if (a.type != 16 || name(a.name) != name(record.name)) return false
    let parts = a.data.match(/"(?:[^"\\]|\\.)*"/g) ?? []
    if (!parts.length || parts.join(' ') != a.data) return false
    return parts.map((s) => JSON.parse(s)).join('') == record.value
  })
}

// Both the connector and a visitor can advance provisioning. They use this
// same gate, retaining Cloudflare's challenge even if a later API answer omits
// it. Previously active hostnames keep their standing; pending old rows still
// have to prove ownership. Receipt, challenge and stage commit together, guarded
// against another refresh or a detach/re-attach while the DNS lookup was away.
export let refresh = async (env: Env, row: Hostname, custom: Custom | null) => {
  let verification = txt(row.verification)
    ? row.verification
    : custom?.ownership_verification ?? row.verification
  let owned = !!row.verified ||
    (row.stage == 'active' && row.verification == null)
  let unavailable = false
  if (!owned) {
    try {
      owned = await ownership(env, verification)
    } catch {
      unavailable = true
    }
  }
  let how = custom ? steps(custom, owned) : null
  if (how && unavailable) {
    how[0].said = 'ownership TXT lookup is unavailable — check again shortly'
  } else if (how && !owned && !txt(verification)) {
    how[0].said = 'Cloudflare has not supplied an ownership TXT record yet'
  }
  let stage = how ? stageOf(how) : 'error' as const
  if (
    stage != row.stage || token(verification) != token(row.verification) ||
    (owned && !row.verified)
  ) {
    let at = new Date().toISOString()
    let applied = await stamp(env, {
      entities: [{
        entity: { eid: row.eid },
        hostname: { verification, stage, at },
        ...owned && !row.verified ? { verified: { at } } : {},
        $was: {
          hostname: {
            name: token(row.name),
            serves: token(row.serves),
            stage: token(row.stage),
            verification: token(row.verification),
          },
          verified: { at: token(row.verified) },
        },
      }],
    })
    if (!applied.some((b) => b.entity.eid == row.eid && b.hostname)) {
      return { how: null, stage: 'pending' as const, records: [] }
    }
  }
  return { how, stage, records: records(row.name, env, verification) }
}

// What the entity's `stage` becomes: active once all four are done, error
// the moment any of them is, pending otherwise.
export let stageOf = (steps: Step[]) =>
  steps.some((s) => s.state == 'error')
    ? 'error' as const
    : steps.every((s) => s.state == 'done')
    ? 'active' as const
    : 'pending' as const

// The steps as lines an agent reads out, in the order they happen: what is
// left to wait for is always the tail of the list.
export let reading = (steps: Step[]) =>
  steps.map((s) =>
    `${
      s.state == 'done' ? '✓' : s.state == 'error' ? '✗' : '…'
    } ${s.step}: ${s.said}`
  ).join('\n')

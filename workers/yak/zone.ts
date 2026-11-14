// Records the platform writes in its own zone (CF_ZONE, the yaks.app zone),
// through the one fetch every call to Cloudflare's API goes through
// (@yaks/cloudflare/api `resent`). A space's subdomain takes mail by records
// written here (space-mail.ts, D-415); a person's own domain is theirs to
// write (domains.ts).
//
// A record is named by its type, name and content, as DNS has it: Cloudflare's
// own id for one is looked up at each call and never stored. Writing one that
// is already there does nothing, and so does removing one that is not, so a
// setup that stopped halfway is finished by running it again.
//
// The token is the platform's own (CF_DNS_TOKEN, `wrangler secret put`):
// Zone → DNS → Edit on the yaks.app zone, and nothing else.
import { resent } from '@yaks/cloudflare/api'
import { answered } from './dispatch.ts'
import type { Env } from './env.ts'

/** A record in the zone. `proxied` is said for an AAAA or CNAME only. */
export type ZoneRecord = {
  type: string
  name: string
  content: string
  priority?: number
  proxied?: boolean
}

export type Zone = Pick<Env, 'CF_ZONE' | 'CF_DNS_TOKEN' | 'HOSTNAMES_API'>

/** Why no record can be written in the zone yet, or nothing when one can. */
export let zoneWaiting = (env: Zone) =>
  !env.CF_ZONE
    ? 'the platform does not know its Cloudflare zone (CF_ZONE)'
    : !env.CF_DNS_TOKEN
    ? 'waiting for credentials: records in the zone need CF_DNS_TOKEN ' +
      '(Zone → DNS → Edit)'
    : undefined

let api = (env: Zone, path: string) =>
  `${env.HOSTNAMES_API ?? 'https://api.cloudflare.com/client/v4'}` +
  `/zones/${env.CF_ZONE}/dns_records${path}`

let call = async (env: Zone, path: string, init: RequestInit = {}) => {
  let waiting = zoneWaiting(env)
  if (waiting) throw new Error(waiting)
  return await answered(
    await resent(api(env, path), {
      ...init,
      headers: {
        authorization: `Bearer ${env.CF_DNS_TOKEN}`,
        ...init.body ? { 'content-type': 'application/json' } : {},
      },
    }),
  )
}

type Held = ZoneRecord & { id: string }

// DNS compares names without case or the root's dot, and Cloudflare may
// answer a TXT record's content in quotes.
let bare = (s: string) => s.toLowerCase().replace(/\.$/, '')
let content = (r: ZoneRecord) =>
  r.type == 'TXT' ? r.content.replace(/^"(.*)"$/, '$1') : bare(r.content)
let same = (a: ZoneRecord, b: ZoneRecord) =>
  a.type == b.type && bare(a.name) == bare(b.name) && content(a) == content(b)

// The records of one type at one name.
let at = async (env: Zone, r: ZoneRecord) =>
  await call(
    env,
    `?type=${r.type}&name=${encodeURIComponent(bare(r.name))}&per_page=100`,
  ) as Held[]

/** Write each record that is not already in the zone. One another call wrote
 * between the look and the write is there, which is all that was asked. */
export let written = async (env: Zone, records: ZoneRecord[]) => {
  let there = async (r: ZoneRecord) =>
    (await at(env, r)).some((h) => same(h, r))
  for (let r of records) {
    if (await there(r)) continue
    try {
      await call(env, '', {
        method: 'POST',
        body: JSON.stringify({ ttl: 1, ...r, name: bare(r.name) }),
      })
    } catch (why) {
      if (!await there(r)) throw why
    }
  }
}

/** Remove each record that is in the zone. */
export let unwritten = async (env: Zone, records: ZoneRecord[]) => {
  for (let r of records) {
    for (let h of (await at(env, r)).filter((h) => same(h, r))) {
      await call(env, `/${encodeURIComponent(h.id)}`, { method: 'DELETE' })
    }
  }
}

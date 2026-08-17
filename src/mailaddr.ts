// The fleet mail namespace. One runtime setting names the domain used by
// outbound canonicalization, local delivery, inbound routing, and diagnostics;
// TASKS_MAIL_DOMAIN lets an OSS install own a different namespace.

export let mailDomain = () =>
  Deno.env.get('TASKS_MAIL_DOMAIN')?.trim().toLowerCase() || 'bot.yak.sh'

export let fleetAddress = (local: string) => `${local}@${mailDomain()}`

export let fleetLocal = (address: string): string | null => {
  let [local, domain, ...extra] = address.trim().split('@')
  return local && domain && !extra.length &&
      domain.toLowerCase() == mailDomain()
    ? local
    : null
}

export let atFleet = (address: string) => fleetLocal(address) != null

// The canonical, deliverable form of a fleet address. Cloudflare Email
// Routing rejects an underscore in the fleet domain's local-part at RCPT —
// upstream of the inbox Worker, so such mail bounces whatever the routing
// rules say. Lowercasing and shedding underscores is the only reliable fix,
// and it is authoritative on its own (no rule set to consult). Every other
// domain passes untouched. This is both the send-time normalizer and the
// address-book WRITE rule (db.ts apply): a book entry Cloudflare cannot
// deliver can never be stored, so the doctor's mail check has nothing to find.
export let canon = (to: string) => {
  let local = fleetLocal(to)
  return local != null
    ? local.toLowerCase().replace(/_/g, '') + '@' + mailDomain()
    : to
}

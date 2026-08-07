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

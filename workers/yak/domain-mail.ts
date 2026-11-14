// A space's own domain's mail (D-415): where it goes, and setting it up,
// reading it and removing it at the provider its hostname row names
// (`mail_domain{name, via}`). The web half is domains.ts; the tools that say
// both are in tools.ts. Whether the records have arrived is read from the
// provider every time and never stored.
//
// Mail never stops a domain serving the web: a provider that cannot be
// reached, or refuses, is said beside the web records, and attaching the
// domain again finishes the setup.
import type { DomainRecord } from '@yaks/host/senders'
import { caught } from './defects.ts'
import type { MailDomain } from './directory.ts'
import { mailHost } from './domains.ts'
import type { Env } from './env.ts'
import { MAIL_VIA, mailDomains } from './mail-domains.ts'

/** A mail domain as its provider has it: its records, or why there are none:
 * the provider is `waiting` (a key not set), `failed` (it refused), or does
 * not hold the domain (`absent`). */
export type Mail = {
  records: DomainRecord[]
  waiting?: string
  failed?: string
  absent?: boolean
}

/** Where a newly attached hostname's mail goes, and the provider carrying
 * it. When DNS cannot say whether the domain takes mail, `mail.<host>`, which
 * leaves any mail it takes alone. */
export let placed = async (env: Env, host: string): Promise<MailDomain> => {
  let name
  try {
    name = await mailHost(env, host)
  } catch (why) {
    caught(why, { request: 'mail host', host })
    name = `mail.${host}`
  }
  return { name, via: MAIL_VIA }
}

// A verb at the domain's provider, answered as a `Mail` when it cannot run.
let at = async (
  env: Env,
  mail: MailDomain,
  run: (p: Awaited<ReturnType<typeof mailDomains>>) => Promise<Mail>,
): Promise<Mail> => {
  try {
    let provider = await mailDomains(env, mail.via)
    let waiting = provider.waiting?.()
    if (waiting) return { records: [], waiting }
    return await run(provider)
  } catch (why) {
    caught(why, { request: 'mail domain', domain: mail.name, via: mail.via })
    return { records: [], failed: (why as Error).message }
  }
}

/** Set the mail domain up, or answer it as it is when it already is. */
export let setUp = (env: Env, mail: MailDomain) =>
  at(env, mail, async (p) => ({ records: (await p.setup(mail.name)).records }))

/** The mail domain's records as they stand, each saying whether it arrived. */
export let readMail = (env: Env, mail: MailDomain) =>
  at(env, mail, async (p) => {
    let got = await p.read(mail.name)
    return got ? { records: got.records } : { records: [], absent: true }
  })

/** Remove the mail domain at its provider. Rejects when the provider
 * refuses, so the hostname row stays for the next detach to finish; answers
 * why when the provider cannot be reached at all. */
export let unmail = async (env: Env, mail: MailDomain | null) => {
  if (!mail) return undefined
  let provider = await mailDomains(env, mail.via)
  let waiting = provider.waiting?.()
  if (waiting) return waiting
  await provider.remove(mail.name)
  return undefined
}

/** Whether every record has arrived, so mail flows both ways. */
export let ready = (m: Mail) =>
  !!m.records.length && m.records.every((r) => r.arrived)

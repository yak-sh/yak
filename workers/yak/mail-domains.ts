// The mail domains a space's own addresses live at: set up, read and removed
// through the provider config.ts `mailDomains` names, lent under its name
// (lent.ts), its key read from the Worker's environment at its use. Nothing
// here names a provider or holds its id for a domain: a domain is its name.
import type { MailDomains } from '@yaks/host/senders'
import { mailDomains as config } from './config.ts'

// One lending per environment. Its options read the environment as they are
// used, so a key put after the first call is used by the next.
let held = new WeakMap<object, Promise<MailDomains>>()

let lend = async (env: object) => {
  let all = await (await import('./lent.ts')).lent(env, 'mailDomains', config)
  if (!Object.hasOwn(all, config.via)) {
    throw new Error(`no mail domains ${config.via} are lent`)
  }
  return all[config.via]
}

/** The mail domains config.ts `mailDomains` lends as its `via`. */
export let mailDomains = (env: object): Promise<MailDomains> => {
  let got = held.get(env)
  if (!got) {
    held.set(env, got = lend(env))
    got.catch(() => held.delete(env))
  }
  return got
}

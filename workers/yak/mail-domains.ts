// The mail domains a space's own addresses live at: set up, read and removed
// through the providers config.ts `mailDomains` lends, each under its name
// (lent.ts), its key read from the Worker's environment at its use. Nothing
// here holds a provider's id for a domain: a domain is its name, and a
// hostname row names the provider that carries it (`mail_domain{via}`).
import type { MailDomains } from '@yaks/host/senders'
import { mailDomains as config } from './config.ts'

// One lending per environment. Its options read the environment as they are
// used, so a key put after the first call is used by the next.
let held = new WeakMap<object, Promise<Record<string, MailDomains>>>()

let lending = (env: object) => {
  let got = held.get(env)
  if (!got) {
    held.set(
      env,
      got = import('./lent.ts').then((m) => m.lent(env, 'mailDomains', config)),
    )
    got.catch(() => held.delete(env))
  }
  return got
}

/** The mail domains lent as `via`: config.ts `mailDomains`'s own by
 * default, which is the provider a new mail domain is set up with. */
export let mailDomains = async (
  env: object,
  via: string = config.via,
): Promise<MailDomains> => {
  let all = await lending(env)
  if (!Object.hasOwn(all, via)) {
    throw new Error(`no mail domains ${via} are lent`)
  }
  return all[via]
}

/** The provider a new mail domain is set up with. */
export let MAIL_VIA = config.via

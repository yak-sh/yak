// The selected yaks.app connection, shared by stored admin tools and terminal
// commands. A renewed website session stays in its original vault record, and
// a test account whose session lapsed signs itself in again from its own mail
// (@yaks/connections/yaks-app `botSession`), so its browser doors never wait
// on a person.
import type { Comp } from '@yaks/graph'
import type { Host } from '@yaks/host'
import { person } from '@yaks/cli/host'
import { given, used } from '@yaks/cli/config'
import { ADMIN, isTestAddress } from '@yaks/platform/bots'
import { botSession } from '@yaks/connections/yaks-app'
import { FORWARDED } from './forward.ts'
import { accountCredential } from '@yaks/connections'
import { records } from '@yaks/secrets'
import { claimsOf, renewing, zone } from './api.ts'
import { Refused } from './refusal.ts'

export type Account = {
  address: string
  bearer: string
  session?: string
  /** The website session for a browser-only door: the one held, or, for a
   * test account whose session is missing or lapsed, a fresh sign-in. */
  signedIn?: (rejected?: string) => Promise<string | undefined>
}

export let account = (
  host: Pick<Host, 'vault' | 'config' | 'graph'>,
  signIn = botSession,
) =>
async (as?: string): Promise<Account> => {
  let plugin = host.config.plugins?.find((p) => used(p) == '@yaks/admin')
  let endpoint = plugin && given(plugin).forward
  if (typeof endpoint == 'string' && (as == ADMIN || as == 'admin')) {
    return {
      address: ADMIN,
      bearer: FORWARDED + endpoint,
      session: FORWARDED + endpoint,
    }
  }
  let owner = await person(host)
  if (!owner) throw new Refused('A configured person is required')
  let at = await accountCredential(host, owner, 'yaks.app', as)
  if (!at) {
    throw new Refused(
      'No yaks.app connection; sign in with yak auth yaks.app',
    )
  }
  let address = String(
    (at.connection.connection as Comp)?.account ?? '(unnamed account)',
  )
  let keep = async (fresh: string) => {
    await records<{ website_session?: string }>(
      host.graph,
      host.vault,
      '',
      () => {},
    ).update(
      String((at.connection.secret as Comp)?.name),
      (record) => {
        record.website_session = fresh
        return Promise.resolve()
      },
    )
  }
  let session = at.session
  if (session) renewing(keep)
  let signedIn = async (rejected?: string) => {
    if (!isTestAddress(address) || (session != rejected && live(session))) {
      return session
    }
    session = await signIn(host.graph, `https://${zone()}`, address)
    await keep(session)
    renewing(keep)
    return session
  }
  return { address, bearer: at.bearer, session, signedIn }
}

// Whether a session still stands for a minute more, as far as its claims
// say. One whose claims cannot be read is the platform's to judge.
let live = (session?: string, now = Date.now()) => {
  if (!session) return false
  let exp = claimsOf(session)?.exp
  return exp == null || exp * 1000 > now + 60_000
}

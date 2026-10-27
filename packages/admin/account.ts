// The selected yaks.app connection, shared by stored admin tools and terminal
// commands. A renewed website session stays in its original vault record.
import type { Comp } from '@yaks/graph'
import type { Host } from '@yaks/host'
import { person } from '@yaks/cli/host'
import { accountCredential, AccountError } from '@yaks/connections'
import { records } from '@yaks/secrets'
import { renewing } from './api.ts'
import { Refused } from './refusal.ts'

export type Account = { address: string; bearer: string; session?: string }

export let account = (
  host: Pick<Host, 'vault' | 'config' | 'graph'>,
) =>
async (as?: string): Promise<Account> => {
  let owner = await person(host)
  if (!owner) throw new Refused('A configured person is required')
  let at
  try {
    at = await accountCredential(host, owner, 'yaks.app', as)
  } catch (error) {
    if (error instanceof AccountError) throw new Refused(error.message)
    throw error
  }
  if (!at) {
    throw new Refused(
      'No yaks.app connection; sign in with yak auth yaks.app',
    )
  }
  let address = String(
    (at.connection.connection as Comp)?.account ?? '(unnamed account)',
  )
  if (at.session) {
    renewing(async (fresh) => {
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
    })
  }
  return { address, bearer: at.bearer, session: at.session }
}

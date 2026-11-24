// What the person writes to their own pages through the tab's page graph
// (@yaks/platform/account-rows), done here as the person: their account's
// name and whether friends see when they are online, a message to a friend,
// and a friend asked by their sign-in email. The page shows each at once and
// this answers what it came to, or refuses it, which takes it back off the
// page. Messages and asks are the tools the person's assistant calls, called
// as them, so the page and the assistant do each one way.
import type { Bundle } from '@yaks/graph'
import { ACCOUNT, type Account, accountEid } from '@yaks/platform/account-rows'
import { CallError } from '@yaks/tools/errors'
import type { Directory } from './directory.ts'
import type { Env } from './env.ts'
import { hidePresence } from './friends.ts'
import { meta } from './meta.ts'
import { chose, keepName } from './names.ts'
import { personRows } from './side.ts'
import { TOOLS } from './tools.ts'

let WRITES = ['account', 'friendMessage', 'friendAsk']

/** Whether `bundles` are the person's writes to their own pages. */
export let accountWrites = (bundles: unknown): bundles is Bundle[] =>
  Array.isArray(bundles) && bundles.length > 0 &&
  bundles.every((b) => b && typeof b == 'object' && WRITES.some((w) => w in b))

let call = (env: Env, dir: Directory, person: string) =>
(
  name: string,
  args: Record<string, unknown>,
) => TOOLS.find((t) => t.name == name)!.run({ env, dir, person }, args)

/** Do the person's writes, in order, and answer the rows they came to. */
export let accountApply = async (
  bundles: Bundle[],
  env: Env,
  dir: Directory,
  person: string,
): Promise<Bundle[]> => {
  let tool = call(env, dir, person)
  let answered: Bundle[] = []
  for (let b of bundles) {
    if (b.account) {
      if (b.entity.eid != accountEid(person)) {
        throw new CallError('access', 'That is someone else’s account.')
      }
      let said = b.account as Partial<Account>
      if (said.name !== undefined) {
        await keepName(meta(env), person, chose(said.name), 'said', {
          by: person,
        })
      }
      if (said.hidden !== undefined) {
        await hidePresence(dir, { person, role: 'owner' }, person, said.hidden)
      }
      answered.push(...await personRows(dir, person, ACCOUNT))
    } else if (b.friendMessage) {
      let { to, words } = b.friendMessage as { to: string; words: string }
      await tool('friend_message', { friend: to, words })
      answered.push(b)
    } else if (b.friendAsk) {
      await tool('friend_add', {
        email: (b.friendAsk as { email: string }).email,
      })
      answered.push(b)
    }
  }
  return answered
}

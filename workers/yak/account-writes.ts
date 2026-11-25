// What the person writes to their own pages through the tab's page graph
// (@yaks/platform/account-rows), done here as the person: their account's
// name, whether friends see when they are online and the space `/manage`
// opens first, a browser signed out, a message to a friend or one read, and a
// friend asked by their sign-in email. The page shows each at once and this
// answers what it came to, or refuses it, which takes it back off the page. A
// message is sent as the one the page names (friends.ts `sendFriend`), the
// way the assistant's friend_message sends it, and an ask is the tool the
// assistant calls, called as them, so the page and the assistant do each one
// way.
import type { Bundle } from '@yaks/graph'
import {
  ACCOUNT,
  accountEid,
  type AccountWrite,
} from '@yaks/platform/account-rows'
import { CallError } from '@yaks/tools/errors'
import { browsers, end, endAll } from './browser-sessions.ts'
import type { Directory } from './directory.ts'
import type { Env } from './env.ts'
import { hidePresence, readFriend, sendFriend } from './friends.ts'
import { meta } from './meta.ts'
import { chose, keepName } from './names.ts'
import { personRows } from './side.ts'
import { TOOLS } from './tools.ts'

let WRITES = ['account', 'signOut', 'friendMessage', 'friendAsk']

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
      let said = b.account as AccountWrite
      if (said.name !== undefined) {
        await keepName(meta(env), person, chose(said.name), 'said', {
          by: person,
        })
      }
      if (said.hidden !== undefined) {
        await hidePresence(dir, { person, role: 'owner' }, person, said.hidden)
      }
      if (said.first) await openFirst(dir, person, said.first)
      answered.push(...await personRows(dir, person, ACCOUNT))
    } else if (b.signOut) {
      let { session } = b.signOut as { session: string }
      if (session == 'all') await endAll(env, person)
      for (let s of await browsers(env, person)) {
        if (s.eid == session) await end(env, s)
      }
      answered.push(b)
    } else if (b.friendMessage) {
      let m = b.friendMessage as { to?: string; words?: string; read?: boolean }
      let as = { person, role: null }
      if (m.words !== undefined) {
        await sendFriend(dir, as, {
          eid: b.entity.eid,
          to: String(m.to ?? ''),
          words: m.words,
        })
      } else if (m.read) await readFriend(dir, as, [b.entity.eid])
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

// The space `/manage` opens first is the one the person's seat marks theirs
// (`member.own`): the mark moves to another space they own, and stays where
// it is for one they do not.
let openFirst = async (dir: Directory, person: string, slug: string) => {
  let seats = await dir.seats(person, 'owner')
  let to = seats.find((s) => s.space.slug == slug && !s.space.trashed)
  if (!to || to.own) return
  await dir.apply({
    entities: seats.filter((s) => s.own || s == to).map((s) => ({
      entity: { eid: s.seat },
      member: { own: s == to },
    })),
  }, { 'x-yak-person': person, 'x-yak-role': 'owner' })
}

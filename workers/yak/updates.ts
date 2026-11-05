// Updates from the Operator (T-140508): what happened in a space, as messages
// from its Operator a person can reply to, at `/manage/<space>/updates`
// (route.ts `managePath('updates', …)`), beside the chat app's side
// (operator-page.ts `updatesPage`). Until @yaks/inbox serves them, there are
// none to count or show.
import type { Env } from './env.ts'
import type { Space } from './directory.ts'
import type { Who } from './session.ts'
import { esc } from './pages.ts'

/** How many updates this person has not read, which the side counts beside
 * "Updates from <Operator>". */
export let unread = (_env: Env, _space: Space, _who: Who) => Promise.resolve(0)

/** What the Updates page shows under its bar. */
export let updates = (_env: Env, space: Space, _who: Who) =>
  Promise.resolve(
    `<div class="Talk_Hello"><h2>Nothing new</h2><p>${
      esc(space.operator)
    } writes here when something happens in your apps.</p></div>`,
  )

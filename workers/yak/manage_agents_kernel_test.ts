// The Apps page says whether an agent is connected, which only the OAuth
// provider's grants know, and its first read of them takes longer than the
// rest of the page (T-149703). So the page is drawn with them only when they
// are in hand, and otherwise leaves what depends on them for its script to
// settle (connected_ui.ts `agentLive`).
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { fresh, seed, unique } from './probe.ts'
import { managePath } from './route.ts'

// Listing a person's grants waits, while `held`, for the test to let it go.
let held = false
let waiting: (() => void)[] = []
let k = await fresh({}, (env) => {
  let kv = env.OAUTH_KV as { list: (o: { prefix: string }) => Promise<unknown> }
  let list = kv.list.bind(kv)
  kv.list = (o) =>
    held && o.prefix.startsWith('grant:')
      ? new Promise((go) => waiting.push(() => go(list(o))))
      : list(o)
})
let slug = unique('agents')
let { cookie } = await seed(k, [{ slug, apps: ['recipes'] }])

// The Apps page's connect card: whether it is shown, and whether the page
// left it for its script.
let card = async () => {
  let page = await k.at('yaks.app', managePath('apps', slug), {
    headers: { cookie },
  })
  assertEquals(page.status, 200)
  let at = parseHTML(await page.text()).document.querySelector('.Desk_Connect')!
  return {
    shown: !at.hasAttribute('hidden'),
    unsettled: at.hasAttribute('data-unsettled'),
  }
}

// The person has connected no agent, so the card asks them to.
test('the Apps page draws the connect card from grants already in hand', async () => {
  assertEquals(await card(), { shown: true, unsettled: false })
})

test('the Apps page answers without waiting on the grants, leaving the card to its script', async () => {
  held = true
  try {
    assertEquals(await card(), { shown: false, unsettled: true })
  } finally {
    held = false
    for (let go of waiting.splice(0)) go()
  }
})

addEventListener('unload', () => void k.stop())

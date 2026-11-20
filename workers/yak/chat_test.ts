// yaks.app's chat platforms (chat.ts) at a space's Operator settings: Discord
// is offered once yaks.app keeps its Discord bot, and each button posts to
// the connections page that sends its owner on to Discord.

import { assertEquals, assertStringIncludes } from '@std/assert'
import { test } from '@yaks/testing'
import { renderToString } from 'preact-render-to-string'
import { registration } from '@yaks/connections'
import type { D1Like } from '@yaks/d1'
import { d1 } from '../../packages/d1/testing.ts'
import { platform } from './directory-rows-probe.ts'
import { KERNEL, meta } from './meta.ts'
import { offers } from './chat.ts'
import { chatCard } from './operator-page.ts'

let KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
let { env } = platform('a probe secret', {
  VAULT: d1() as unknown as D1Like,
  VAULT_KEY: KEY,
})
let names = async () =>
  (await offers(env)).map((o) => [o.platform.name, o.bot.name, o.user?.name])

let botless = await names()
await meta(env).apply(
  [registration('discord', { id: 'app', secret: 's', bot: 'BOT' })],
  KERNEL,
)
let kept = await names()
let card = renderToString(
  chatCard('/manage/ana/connections', 'Kit', await offers(env))[0],
)

test('Discord is offered once yaks.app keeps its bot, with the account a person links there', () => {
  assertEquals(botless, [])
  assertEquals(kept, [['discord', 'discord', 'discord-account']])
})

test('each button posts to the connections page, naming the integration still in testing', () => {
  assertStringIncludes(
    card,
    `method="post" action="/manage/ana/connections?enable=discord"`,
  )
  assertStringIncludes(
    card,
    `method="post" action="/manage/ana/connections?enable=discord-account"`,
  )
  assertStringIncludes(card, 'name="integration" value="discord"')
  assertStringIncludes(card, 'Add Kit to a Discord server you manage.')
  assertStringIncludes(card, 'Add to Discord')
  assertStringIncludes(card, 'Connect my Discord account')
})

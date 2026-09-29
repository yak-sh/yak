// A villager's own line and app link stay visible beside their quest.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { talkHtml } from './hud.ts'
import { GIVERS } from './quests.ts'
import { quests } from './quests/vale.ts'
import { completion, WELCOME } from './village-tasks.ts'
import { greeting } from './villagers.ts'
import { seedDesigns } from './designs_fixture.ts'

seedDesigns()

Deno.test('Pip reacts to this hero marking the welcome task in Village Tasks', async () => {
  let quest = quests.find((q) => q.giver == 'pip')!
  let neutral = 'Still got room by the fire.'
  let panel = (line: string) =>
    parseHTML(`<html><body>${
      talkHtml({
        quest,
        state: 'open',
        have: 0,
        greets: line,
        name: 'Pip',
        note: line,
        link: { href: '/village-tasks/', label: 'Village Tasks' },
      })
    }</body></html>`).document

  let rows = [{ village_done: { task: WELCOME, player: 'hero-a' } }]
  let done = (hero: string) => completion(() => Promise.resolve(rows), hero)
  let before = panel(greeting('pip', neutral, await done('hero-b')))
  assertStringIncludes(
    before.querySelector('.Talk_Body')!.textContent,
    'mark it done',
  )
  assertEquals(greeting('pip', neutral, false, false), neutral)

  let line = greeting('pip', neutral, await done('hero-a'), false)
  let document = panel(line)
  let body = document.querySelector('.Talk_Body')!
  assertStringIncludes(body.textContent, quest.title)
  assertStringIncludes(body.textContent, 'showed your mark')
  let link = document.querySelector('.Talk_Acts a')!
  assert(link)
  assertStringIncludes(link.getAttribute('href') ?? '', '/village-tasks/')
  assertEquals(greeting('pip', neutral, true, true), neutral)
  assertEquals(greeting('rowan', neutral, true), neutral)
})

Deno.test('a villager offer appears as a quest card with both choices', () => {
  let document = parseHTML(`<html><body>${
    talkHtml({
      offer: {
        eid: 'offer-1',
        giver: GIVERS[0],
        give: [{ kind: 'coin', n: 5 }],
        take: [{ kind: 'tusk', n: 2 }],
        state: 'open',
        ends: 0,
        steps: [{ kind: 'tusk', n: 2, have: 0, deed: false }],
        ready: false,
      },
      name: GIVERS[0].name,
    })
  }</body></html>`).document
  let body = document.querySelector('.Talk_Body')!.textContent
  assertStringIncludes(body, 'Bring 2 Boar tusk')
  assertStringIncludes(body, 'Reward: 5 Coins')
  assertEquals(
    [...document.querySelectorAll('.Talk_Acts button')].map((b) =>
      b.getAttribute('data-do')
    ),
    ['accept', 'refuse', 'close'],
  )
})

Deno.test('talking to another hero offers a party invitation', () => {
  let document = parseHTML(`<html><body>${
    talkHtml({
      player: true,
      name: 'Ada <the Bold>',
      message: 'Travel together.',
      invite: true,
    })
  }</body></html>`).document
  assertEquals(
    document.querySelector('.Talk_Who')!.textContent,
    'Ada <the Bold>',
  )
  assertEquals(
    [...document.querySelectorAll('.Talk_Acts button')].map((b) =>
      b.getAttribute('data-do')
    ),
    ['invite', 'close'],
  )
  assertEquals(document.querySelector('the')?.textContent, undefined)
})

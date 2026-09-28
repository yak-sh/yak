// A villager's own line and app link stay visible beside their quest.
import { assert, assertStringIncludes } from '@std/assert'
import { parseHTML } from 'linkedom'
import { talkHtml } from './hud.ts'
import { quests } from './quests/vale.ts'
import { greeting } from './villagers.ts'

Deno.test('Pip points each hero to Village Tasks even while offering a quest', () => {
  let quest = quests.find((q) => q.giver == 'pip')!
  let line = greeting('pip', 'Check my welcome sign.', true)
  let { document } = parseHTML(`<html><body>${
    talkHtml({
      quest,
      state: 'open',
      have: 0,
      greets: line,
      name: 'Pip',
      note: line,
      link: { href: '/village-tasks/', label: 'Village Tasks' },
    })
  }</body></html>`)
  let body = document.querySelector('.Talk_Body')!
  assertStringIncludes(body.textContent, quest.title)
  assertStringIncludes(body.textContent, 'welcome sign')
  let link = document.querySelector('.Talk_Acts a')!
  assert(link)
  assertStringIncludes(link.getAttribute('href') ?? '', '/village-tasks/')
})

import { assertEquals, assertThrows } from '@std/assert'
import { eidOf } from '@yaks/archetype'
import { archetypeTables } from './live_archetypes.ts'
import { applyLocal, config, landSub, useRoute } from './live.ts'

Deno.test('malformed or misaddressed descriptors are never trusted', () => {
  for (
    let [id, tables, error] of [
      ['bad-json', 'not JSON', SyntaxError],
      ['wrong-id', '["task"]', Error],
    ] as const
  ) {
    applyLocal([
      { eid: id, name: 'entity', comp: { eid: id } },
      { eid: id, name: 'archetype', comp: { tables } },
    ])
    assertThrows(() => archetypeTables(id), error)
  }
})

Deno.test('failed descriptor reads release and can retry on the next render', async () => {
  let sent: { sub?: string; q?: string; unsub?: string }[] = []
  let prior = useRoute((f) => sent.push(f as typeof sent[number]))
  let host = config.host
  config.host = 'archetypes.test'
  let tick = () => new Promise((r) => setTimeout(r, 0))
  try {
    let id = eidOf(['retry_plugin'])
    assertEquals(archetypeTables(id), undefined)
    await tick()
    let sub = sent.find((f) => f.q)!.sub!
    landSub({ sub, error: 'unavailable', changes: [] })
    await tick()
    assertEquals(sent.filter((f) => f.unsub == sub).length, 1)
    archetypeTables(id)
    await tick()
    let retry = sent.filter((f) => f.q).at(-1)!.sub!
    assertEquals(retry == sub, false)
    // An authoritative empty answer releases the read and does not loop.
    landSub({ sub: retry, replace: true, changes: [] })
    await tick()
    archetypeTables(id)
    await tick()
    assertEquals(sent.filter((f) => f.q).length, 2)
    assertEquals(sent.filter((f) => f.unsub == retry).length, 1)
  } finally {
    config.host = host
    useRoute(prior)
  }
})

// Chat's slash form calls the commands declared by the app, with typed args.
import { assertEquals, assertStringIncludes } from '@std/assert'
import { slash as parse } from './slash.ts'
import words from './vocab.json' with { type: 'json' }

let all = Object.fromEntries(
  Object.entries(words.$defs).filter(([, def]) => 'tool' in def && def.tool),
)
let slash = (text: string) => parse(text, all)

Deno.test('slash adapts declared app commands and leaves chat alone', () => {
  assertEquals(slash('hello /damage on'), null)
  assertEquals(slash('/damage on'), {
    command: { name: 'damage', args: { on: true } },
  })
  assertEquals(slash('/damage off'), {
    command: { name: 'damage', args: { on: false } },
  })
  assertEquals(slash('/where'), {
    command: { name: 'where', args: {} },
  })
  assertEquals(slash('/teleport tombsands'), {
    command: { name: 'teleport', args: { level: 'tombsands' } },
  })
  assertEquals(slash('/teleport to=01234567-89ab-cdef-0123-456789abcdef'), {
    command: {
      name: 'teleport',
      args: { to: '01234567-89ab-cdef-0123-456789abcdef' },
    },
  })
  assertEquals(slash('/teleport "Tomb Sands"'), {
    command: { name: 'teleport', args: { level: 'Tomb Sands' } },
  })
  assertEquals(slash('/teleport level="Tomb Sands"'), {
    command: { name: 'teleport', args: { level: 'Tomb Sands' } },
  })
  assertEquals(slash('/teleport to="Elder Wren"'), {
    command: { name: 'teleport', args: { to: 'Elder Wren' } },
  })
  assertEquals(slash('/teleport "Tomb Sands'), {
    error: 'Close the quoted argument.',
  })
  assertEquals(slash('/teleport x=-1152 z=624'), {
    command: { name: 'teleport', args: { x: -1152, z: 624 } },
  })
  assertEquals(slash('/inspect "Elder Wren"'), {
    command: { name: 'inspect', args: { target: 'Elder Wren' } },
  })
  assertEquals(slash('/companion_progress directive=order'), {
    command: { name: 'companion_progress', args: { directive: 'order' } },
  })
  assertEquals(slash('/teleport x=Infinity z=624'), {
    error: 'x has the wrong value. Usage: /teleport ' +
      '[level=<string>] [to=<string>] [x=<number>] [z=<number>]',
  })
  assertEquals(slash('/damage maybe'), {
    error: 'on has the wrong value. Usage: /damage <on:on|off>',
  })
  assertEquals(slash('/unknown'), {
    error: 'Unknown command: /unknown. Try /help.',
  })
})

Deno.test('help uses declared commands and omits NPC model tools', () => {
  let available = { gather_wood: all.gather_wood, where: all.where }
  let answer = parse('/help', available)
  if (!answer || !('help' in answer)) throw new Error('help missing')
  assertStringIncludes(answer.help, '/gather_wood')
  assertStringIncludes(answer.help, '/where')
  assertEquals(answer.help.includes('/teleport'), false)
  assertEquals(answer.help.includes('/damage'), false)
  assertEquals(answer.help.includes('/think'), false)
  assertEquals(answer.help.includes('/tell'), false)
  let detail = parse('/help gather_wood', available)
  if (!detail || !('help' in detail)) throw new Error('detail missing')
  assertStringIncludes(detail.help, '/gather_wood')
  assertStringIncludes(detail.help, 'count')
  assertEquals(parse('/help teleport', available), {
    error: 'No available command /teleport.',
  })
  assertEquals(parse('/teleport tombsands', available), {
    error: 'Unknown command: /teleport. Try /help.',
  })
  let admin = slash('/help')
  if (!admin || !('help' in admin)) throw new Error('owner help missing')
  assertStringIncludes(admin.help, '/teleport')
  assertStringIncludes(admin.help, '/damage')
  let teleport = slash('/help teleport')
  if (!teleport || !('help' in teleport)) {
    throw new Error('teleport help missing')
  }
  assertStringIncludes(teleport.help, '`to`')
  assertStringIncludes(teleport.help, 'positioned entity')
})

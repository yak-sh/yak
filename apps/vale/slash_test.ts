// Chat's slash form parses and completes through the same declared grammar.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Lookup } from '@yaks/cli/grammar'
import { slashComplete, type SlashCompletion } from './slash-completion.ts'
import { slash as parse, type Tools } from './slash.ts'
import words from './vocab.json' with { type: 'json' }

let all = Object.fromEntries(
  Object.entries(words.$defs).filter(([, def]) => 'tool' in def && def.tool),
)
let slash = (text: string) => parse(text, all)

// References are supplied by the host; completion neither queries a remote
// graph nor invents a second entity-name resolver.
let lookup: Lookup = {
  ids: (comp) =>
    ({
      beast_design: ['boar', 'Bog Beast', 'boar'],
      theme_design: ['tombsands', 'Tomb Sands'],
      position: ['Elder Wren', 'Elder "Wren"', 'Elder\\Wren'],
    })[comp] ?? [],
}
let tools: Tools = {
  spawn: all.spawn,
  teleport: all.teleport,
  where: all.where,
  damage: all.damage,
  mood: {
    input: { state: { type: 'string', enum: ['bold', 'busy', 'calm'] } },
    required: ['state'],
  },
  think: { input: {}, model: true },
}
let finish = (text: string, result: SlashCompletion, candidate: string) => {
  assertEquals(result.cands.some((c) => c.text == candidate), true)
  return text.slice(0, result.from) + candidate + text.slice(result.to)
}
let suggestions = (text: string, caret = text.length, given = lookup) =>
  slashComplete(tools, text, caret, given)

test('slash adapts declared app commands and leaves chat alone', async () => {
  assertEquals(await slash('hello /damage true'), null)
  for (
    let [text, name, args] of [
      ['/damage true', 'damage', { on: true }],
      ['/damage false', 'damage', { on: false }],
      ['/damage --on', 'damage', { on: true }],
      ['/damage --on=false', 'damage', { on: false }],
      ['/where', 'where', {}],
      ['/teleport tombsands', 'teleport', { level: 'tombsands' }],
      ['/teleport --to=01234567-89ab-cdef-0123-456789abcdef', 'teleport', {
        to: '01234567-89ab-cdef-0123-456789abcdef',
      }],
      ['/teleport "Tomb Sands"', 'teleport', { level: 'Tomb Sands' }],
      ['/teleport --level="Tomb Sands"', 'teleport', { level: 'Tomb Sands' }],
      ['/teleport --to "Elder Wren"', 'teleport', { to: 'Elder Wren' }],
      ['/teleport --x=-1152 --z 624', 'teleport', { x: -1152, z: 624 }],
      ['/inspect "Elder Wren"', 'inspect', { target: 'Elder Wren' }],
      ['/companion_progress --directive=order', 'companion_progress', {
        directive: 'order',
      }],
    ] as const
  ) {
    assertEquals(await slash(text), { command: { name, args } })
  }
  assertEquals(await slash('/teleport "Tomb Sands'), {
    error: 'Close the quoted argument.',
  })
  let invalidNumber = await slash('/teleport --x=nope --z=624')
  assertEquals(invalidNumber, { error: '--x wants a number, got nope' })
  assertEquals(await slash('/damage maybe'), {
    error: '--on wants true or false, got maybe',
  })
  assertEquals(await slash('/unknown'), {
    error: 'Unknown command: /unknown. Try /help.',
  })
})

test('help uses declared commands and omits NPC model tools', async () => {
  let available = { gather_wood: all.gather_wood, where: all.where }
  let answer = await parse('/help', available)
  if (!answer || !('help' in answer)) throw new Error('help missing')
  assertStringIncludes(answer.help, '/gather_wood')
  assertStringIncludes(answer.help, '/where')
  for (let name of ['teleport', 'damage', 'think', 'tell']) {
    assertEquals(answer.help.includes(`/${name}`), false)
  }
  let detail = await parse('/help gather_wood', available)
  if (!detail || !('help' in detail)) throw new Error('detail missing')
  assertStringIncludes(detail.help, '/gather_wood')
  assertStringIncludes(detail.help, 'count')
  assertEquals(await parse('/help teleport', available), {
    error: 'No available command /teleport.',
  })
  assertEquals(await parse('/teleport tombsands', available), {
    error: 'Unknown command: /teleport. Try /help.',
  })
  let admin = await slash('/help')
  if (!admin || !('help' in admin)) throw new Error('owner help missing')
  assertStringIncludes(admin.help, '/teleport')
  assertStringIncludes(admin.help, '/damage')
  let teleport = await slash('/help teleport')
  if (!teleport || !('help' in teleport)) {
    throw new Error('teleport help missing')
  }
  assertStringIncludes(teleport.help, '`to`')
  assertStringIncludes(teleport.help, 'current name')
})

test('slash completion adapts commands, help and exact-word state', async () => {
  assertEquals(await suggestions('/sp'), {
    from: 1,
    to: 3,
    cands: [{ text: 'spawn', kind: 'command' }],
    whole: false,
  })
  let text = finish('/sp', await suggestions('/sp'), 'spawn') + ' b'
  assertEquals(text, '/spawn b')
  let result = await suggestions(text)
  assertEquals(result, {
    from: 7,
    to: 8,
    cands: [{ text: '"Bog Beast"', kind: 'value' }, {
      text: 'boar',
      kind: 'value',
    }],
    whole: false,
  })
  assertEquals(await parse(finish(text, result, 'boar'), tools), {
    command: { name: 'spawn', args: { beast: 'boar' } },
  })
  assertEquals(await suggestions('/spawn'), {
    from: 1,
    to: 6,
    cands: [],
    whole: true,
  })
  assertEquals(await suggestions('/he'), {
    from: 1,
    to: 3,
    cands: [{ text: 'help', kind: 'command' }],
    whole: false,
  })
  let help = finish('/help sp', await suggestions('/help sp'), 'spawn')
  let answer = await parse(help, tools)
  if (!answer || !('help' in answer)) throw new Error('completion help missing')
  assertStringIncludes(answer.help, '/spawn')
  assertEquals(
    (await suggestions('/')).cands.some((c) => c.text == 'think'),
    false,
  )
  assertEquals((await suggestions('/help th')).cands, [])
})

test('slash completion flags and enum/ref values roundtrip in both forms', async () => {
  assertEquals(await suggestions('/teleport --'), {
    from: 10,
    to: 12,
    cands: ['--level', '--to', '--x', '--z'].map((text) => ({
      text,
      kind: 'flag',
    })),
    whole: false,
  })
  for (
    let [text, candidate, name, args] of [
      ['/spawn b', '"Bog Beast"', 'spawn', { beast: 'Bog Beast' }],
      ['/spawn --beast=b', '--beast=boar', 'spawn', { beast: 'boar' }],
      ['/spawn --beast b', 'boar', 'spawn', { beast: 'boar' }],
      ['/mood b', 'bold', 'mood', { state: 'bold' }],
      ['/mood --state=b', '--state=busy', 'mood', { state: 'busy' }],
      ['/mood --state b', 'bold', 'mood', { state: 'bold' }],
      ['/damage --on=f', '--on=false', 'damage', { on: false }],
      ['/damage --on f', 'false', 'damage', { on: false }],
      ['/teleport --level=T', '--level="Tomb Sands"', 'teleport', {
        level: 'Tomb Sands',
      }],
      ['/teleport --level T', '"Tomb Sands"', 'teleport', {
        level: 'Tomb Sands',
      }],
      ['/teleport --to="Elder W', '--to="Elder Wren"', 'teleport', {
        to: 'Elder Wren',
      }],
      ['/teleport --to "Elder W', '"Elder Wren"', 'teleport', {
        to: 'Elder Wren',
      }],
      ['/teleport --to E', '"Elder \\"Wren\\""', 'teleport', {
        to: 'Elder "Wren"',
      }],
      ['/teleport --to=E', '--to="Elder\\\\Wren"', 'teleport', {
        to: 'Elder\\Wren',
      }],
    ] as const
  ) {
    let result = await suggestions(text)
    assertEquals(await parse(finish(text, result, candidate), tools), {
      command: { name, args },
    })
  }
  assertEquals((await suggestions('/mood bold')).whole, true)
  assertEquals((await suggestions('/mood bold')).cands, [])
  assertEquals(
    (await suggestions('/teleport --x=1 --')).cands.some((c) =>
      c.text == '--x'
    ),
    false,
  )
})

test('slash completion uses caret/token ranges and rejects invalid prefixes', async () => {
  let calls: [string, string][] = []
  let look: Lookup = {
    ids: (comp, prefix) => {
      calls.push([comp, prefix])
      return ['boar']
    },
  }
  let text = '/spawn b --extra'
  let result = await suggestions(text, 8, look)
  assertEquals([result.from, result.to], [7, 8])
  assertEquals(finish(text, result, 'boar'), '/spawn boar --extra')
  assertEquals(calls, [['beast_design', 'b']])
  assertEquals([...(await suggestions('/spawn ')).cands].length, 2)
  assertEquals([
    (await suggestions('/spawn ')).from,
    (await suggestions('/spawn ')).to,
  ], [7, 7])
  for (
    let invalid of [
      '',
      'hello /sp',
      ' /sp',
      '//sp',
      '/unknown b',
      '/mood nope ',
      '/teleport --bad x ',
      '/teleport --x=nope --',
      '/teleport --to --',
    ]
  ) {
    assertEquals((await suggestions(invalid)).cands, [], invalid)
  }
  assertEquals(await suggestions('/sp', 0), {
    from: 0,
    to: 0,
    cands: [],
    whole: false,
  })
  assertEquals((await suggestions('/spawn b', 8, {})).cands, [])
})

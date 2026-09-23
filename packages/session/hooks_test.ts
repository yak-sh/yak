import { assert, assertEquals } from '@std/assert'
import { install, lifecycle, merged, turning } from './hooks.ts'

let theirs = { hooks: [{ type: 'command', command: 'say-hello' }] }

Deno.test('an install leads each event and keeps everything else', () => {
  let out = merged({ SessionStart: [theirs] }, lifecycle())
  assertEquals(out.SessionStart.length, 2)
  assertEquals(out.SessionStart[1], theirs)
  assert(
    String(JSON.stringify(out.SessionStart[0])).includes('session context'),
  )
})

Deno.test('a second install replaces the first, never doubles it', () => {
  let once = merged({ SessionStart: [theirs] }, lifecycle())
  let twice = merged(once, lifecycle('/usr/local/bin/yak'))
  assertEquals(twice.SessionStart.length, 2)
  assertEquals(twice.SessionStart[1], theirs)
  assert(
    JSON.stringify(twice.SessionStart[0]).includes('/usr/local/bin/yak'),
    JSON.stringify(twice.SessionStart[0]),
  )
})

Deno.test('removing takes ours out and leaves theirs', () => {
  let once = merged({ SessionStart: [theirs], Stop: [theirs] }, lifecycle())
  let gone = merged(once, lifecycle(), true)
  assertEquals(gone, { SessionStart: [theirs], Stop: [theirs] })
})

Deno.test('a settings file keeps the keys nobody asked about', async () => {
  let dir = await Deno.makeTempDir()
  try {
    let path = `${dir}/settings.json`
    Deno.writeTextFileSync(path, JSON.stringify({ model: 'opus', hooks: {} }))
    install(path)
    let said = JSON.parse(Deno.readTextFileSync(path))
    assertEquals(said.model, 'opus')
    assertEquals(Object.keys(said.hooks).sort(), [
      'SessionEnd',
      'SessionStart',
      'SubagentStart',
    ])
    install(path, { remove: true })
    assertEquals(JSON.parse(Deno.readTextFileSync(path)), { model: 'opus' })
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

Deno.test('the turn hooks spool, and a second install replaces them too', () => {
  let turn = turning(
    '/h/.yak/spool/turns.jsonl',
    '/bin/deno',
    'file:///p/session/turn.ts',
  )
  assertEquals(
    turn,
    "'/bin/deno' run --no-config --allow-read='/h/.yak/spool' " +
      "--allow-write='/h/.yak/spool' 'file:///p/session/turn.ts' " +
      "'/h/.yak/spool/turns.jsonl'",
  )
  let once = merged({ Stop: [theirs] }, lifecycle('yak', turn))
  let twice = merged(once, lifecycle('yak', turning('/other/turns.jsonl')))
  assertEquals(twice.Stop.length, 2)
  assertEquals(twice.UserPromptSubmit.length, 1)
  assert(JSON.stringify(twice.Stop[0]).includes('/other/turns.jsonl'))
  assertEquals(merged(twice, lifecycle(), true), { Stop: [theirs] })
})

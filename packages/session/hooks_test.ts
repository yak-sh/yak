import { assert, assertEquals } from '@std/assert'
import { install, lifecycle, merged } from './hooks.ts'

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

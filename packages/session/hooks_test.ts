import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { install, lifecycle, merged } from './hooks.ts'

let theirs = { hooks: [{ type: 'command', command: 'say-hello' }] }

test('an install leads each event and keeps everything else', () => {
  let out = merged({ SessionStart: [theirs] }, lifecycle())
  assertEquals(out.SessionStart.length, 2)
  assertEquals(out.SessionStart[1], theirs)
  assert(
    String(JSON.stringify(out.SessionStart[0])).includes('session context'),
  )
})

test('a second install replaces the first, never doubles it', () => {
  let once = merged(
    { SessionStart: [theirs], UserPromptSubmit: [theirs] },
    lifecycle(),
  )
  let twice = merged(once, lifecycle('/usr/local/bin/yak', 'http://box:9'))
  assertEquals(twice.SessionStart.length, 2)
  let door = { type: 'http', url: 'http://box:9/session/hook', timeout: 2 }
  assertEquals(twice.PostToolUse, [{ hooks: [door] }])
  assertEquals(twice.PreToolUse, [{ matcher: 'mcp__.*', hooks: [door] }])
  assertEquals(twice.SessionStart[1], theirs)
  assertEquals(twice.UserPromptSubmit.length, 2)
  assertEquals(twice.UserPromptSubmit[1], theirs)
  assert(
    JSON.stringify(twice.SessionStart[0]).includes('/usr/local/bin/yak'),
    JSON.stringify(twice.SessionStart[0]),
  )
})

test('removing takes ours out and leaves theirs', () => {
  let once = merged({ SessionStart: [theirs], Stop: [theirs] }, lifecycle())
  let gone = merged(once, lifecycle(), true)
  assertEquals(gone, { SessionStart: [theirs], Stop: [theirs] })
})

let settings = Deno.makeTempFileSync({ suffix: '.json' })
Deno.writeTextFileSync(settings, JSON.stringify({ model: 'opus', hooks: {} }))
let removable = Deno.makeTempFileSync({ suffix: '.json' })
Deno.writeTextFileSync(removable, JSON.stringify({ model: 'opus', hooks: {} }))
install(removable)

test('a settings file keeps the keys nobody asked about', () => {
  install(settings)
  let said = JSON.parse(Deno.readTextFileSync(settings))
  assertEquals(said.model, 'opus')
  assertEquals(Object.keys(said.hooks).sort(), [
    'PostToolUse',
    'PreToolUse',
    'SessionEnd',
    'SessionStart',
    'SubagentStart',
    'UserPromptSubmit',
  ])
})

test('uninstall leaves the settings outside hooks untouched', () => {
  install(removable, { remove: true })
  assertEquals(JSON.parse(Deno.readTextFileSync(removable)), { model: 'opus' })
})

test('an install takes out the turn hooks an older one wrote', () => {
  let spooled = {
    hooks: [{
      type: 'command',
      command:
        "'deno' run --no-config 'file:///p/packages/session/turn.ts' 'turns.jsonl' || true",
    }],
  }
  let out = merged(
    { Stop: [spooled, theirs], UserPromptSubmit: [spooled] },
    lifecycle(),
  )
  assertEquals(out.Stop, [theirs])
  assertEquals(out.UserPromptSubmit, lifecycle().UserPromptSubmit)
})

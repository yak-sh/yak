import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { connect, connection, install, lifecycle, merged } from './hooks.ts'

let at = 'http://127.0.0.1:8787'
let ours = lifecycle(at)
let theirs = { hooks: [{ type: 'command', command: 'say-hello' }] }

test('an install leads each event and keeps everything else', () => {
  let out = merged({ SessionStart: [theirs] }, ours)
  assertEquals(out.SessionStart.length, 2)
  assertEquals(out.SessionStart[1], theirs)
  assert(
    String(JSON.stringify(out.SessionStart[0])).includes('session context'),
  )
})

test('a second install replaces the first, never doubles it', () => {
  let once = merged(
    { SessionStart: [theirs], UserPromptSubmit: [theirs] },
    ours,
  )
  let twice = merged(once, lifecycle('http://box:9', '/usr/local/bin/yak'))
  assertEquals(twice.SessionStart.length, 2)
  let door = { type: 'http', url: 'http://box:9/session/hook', timeout: 2 }
  assertEquals(twice.PostToolUse, [{ hooks: [door] }])
  assertEquals(twice.PreToolUse, [{ matcher: 'mcp__.*', hooks: [door] }])
  assertEquals(twice.SessionStart[1], theirs)
  assertEquals(twice.UserPromptSubmit.length, 2)
  assertEquals(twice.UserPromptSubmit[1], theirs)
  assert(
    JSON.stringify(twice.UserPromptSubmit[0]).includes('box:9/session/hook'),
    JSON.stringify(twice.UserPromptSubmit[0]),
  )
  assert(
    JSON.stringify(twice.SessionStart[0]).includes('/usr/local/bin/yak'),
    JSON.stringify(twice.SessionStart[0]),
  )
})

test('removing takes ours out and leaves theirs', () => {
  let once = merged({ SessionStart: [theirs], Stop: [theirs] }, ours)
  let gone = merged(once, ours, true)
  assertEquals(gone, { SessionStart: [theirs], Stop: [theirs] })
})

let settings = Deno.makeTempFileSync({ suffix: '.json' })
Deno.writeTextFileSync(settings, JSON.stringify({ model: 'opus', hooks: {} }))
let removable = Deno.makeTempFileSync({ suffix: '.json' })
Deno.writeTextFileSync(removable, JSON.stringify({ model: 'opus', hooks: {} }))
install(removable, { server: at })

test('a settings file keeps the keys nobody asked about', () => {
  install(settings, { server: at })
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
  install(removable, { server: at, remove: true })
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
    ours,
  )
  assertEquals(out.Stop, [theirs])
  assertEquals(out.UserPromptSubmit, ours.UserPromptSubmit)
})

let config = (had: Record<string, unknown>) => {
  let path = Deno.makeTempFileSync({ suffix: '.json' })
  Deno.writeTextFileSync(path, JSON.stringify(had))
  return path
}
let read = (path: string) => JSON.parse(Deno.readTextFileSync(path))

test("the connection goes into Claude Code's config beside everything else", () => {
  let path = config({ numStartups: 3, mcpServers: { docs: { url: 'x' } } })
  assertEquals(connect(path, { server: at }), 'yak')
  assertEquals(read(path), {
    numStartups: 3,
    mcpServers: { docs: { url: 'x' }, yak: connection(at) },
  })
  connect(path, { server: at, remove: true })
  assertEquals(read(path).mcpServers, { docs: { url: 'x' } })
})

test('an entry already on this door keeps its name', () => {
  let path = config({
    mcpServers: { tasks: { type: 'http', url: `${at}/mcp` } },
  })
  assertEquals(connect(path, { server: at, name: 'other' }), 'tasks')
  assertEquals(read(path).mcpServers, { tasks: connection(at) })
})

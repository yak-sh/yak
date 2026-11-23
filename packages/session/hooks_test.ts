import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import {
  connect,
  connection,
  install,
  lifecycle,
  merged,
  PLUGIN,
  pluginHooks,
  statusLine,
} from './hooks.ts'

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
    'Stop',
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
  assertEquals(out.Stop, [...ours.Stop, theirs])
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

test('an entry already on this door keeps its name, however its host is spelled', () => {
  let path = config({
    mcpServers: {
      tasks: { type: 'http', url: 'http://localhost:8787/mcp' },
      again: { type: 'http', url: `${at}/mcp/` },
      elsewhere: { type: 'http', url: 'http://localhost:9999/mcp' },
    },
  })
  assertEquals(connect(path, { server: at, name: 'other' }), 'tasks')
  assertEquals(read(path).mcpServers, {
    tasks: connection(at),
    elsewhere: { type: 'http', url: 'http://localhost:9999/mcp' },
  })
})

test('an existing local MCP client is replaced and removed on the same door', () => {
  let path = config({
    mcpServers: {
      tasks: connection('http://localhost:8787', '/old/yak'),
      docs: { command: 'docs', args: [] },
    },
  })
  assertEquals(connect(path, { server: at, yak: '/new/yak' }), 'tasks')
  assertEquals(read(path).mcpServers, {
    tasks: { type: 'stdio', command: '/new/yak', args: ['mcp', '--host', at] },
    docs: { command: 'docs', args: [] },
  })
  connect(path, { server: at, remove: true })
  assertEquals(read(path).mcpServers, { docs: { command: 'docs', args: [] } })
})

test("the status line is written where the account has none, and a person's own stays", () => {
  let none = config({})
  assertEquals(install(none, { server: at }).line, true)
  install(none, { server: 'http://box:9' })
  assertEquals(read(none).statusLine, statusLine('http://box:9'))
  let own = { type: 'command', command: '~/bin/my-line' }
  let mine = config({ statusLine: own })
  assertEquals(install(mine, { server: at }).line, false)
  install(mine, { server: at, remove: true })
  assertEquals(read(mine).statusLine, own)
})

test('an account running the plugin is pointed at the server, and the hooks written by hand come out', () => {
  let path = config({ enabledPlugins: { [PLUGIN]: true } })
  install(path, { server: at })
  assertEquals(install(path, { server: 'http://box:9/' }).plugin, true)
  let said = read(path)
  assertEquals(said.hooks, undefined)
  assertEquals(said.pluginConfigs, {
    [PLUGIN]: { options: { server: 'http://box:9' } },
  })
  assertEquals(said.enabledPlugins, { [PLUGIN]: true })
})

let root = new URL('../../plugins/yak/', import.meta.url)
let shipped = JSON.parse(
  Deno.readTextFileSync(new URL('hooks/hooks.json', root)),
)

test('the plugin carries the hooks an install writes, posting to its server option', () => {
  assertEquals(shipped.hooks, pluginHooks())
  assertEquals(Object.keys(shipped.hooks), Object.keys(lifecycle(at)))
})

// A plugin hook run as Claude Code runs it: the event on stdin, the option in
// its environment.
let hook = async (event: string, server: string, payload: object) => {
  let command = (shipped.hooks[event][0].hooks[0] as { command: string })
    .command
  let p = new Deno.Command('sh', {
    args: ['-c', command],
    env: { CLAUDE_PLUGIN_OPTION_SERVER: server, PATH: '/usr/bin:/bin' },
    stdin: 'piped',
    stdout: 'piped',
  }).spawn()
  let w = p.stdin.getWriter()
  await w.write(new TextEncoder().encode(JSON.stringify(payload)))
  await w.close()
  let out = await p.output()
  return { code: out.code, said: new TextDecoder().decode(out.stdout) }
}

test("a plugin hook posts its event to the option's server and prints the answer", async () => {
  let heard: unknown[] = []
  let server = Deno.serve({ port: 0, onListen: () => {} }, async (r) => {
    heard.push([new URL(r.url).pathname, await r.json()])
    return Response.json({ decision: 'block', reason: 'answered' })
  })
  try {
    let { port } = server.addr as Deno.NetAddr
    let ran = await hook('UserPromptSubmit', `http://127.0.0.1:${port}`, {
      prompt: '/yak:continue',
    })
    assertEquals(ran.code, 0)
    assertEquals(JSON.parse(ran.said), {
      decision: 'block',
      reason: 'answered',
    })
    assertEquals(heard, [['/session/hook', { prompt: '/yak:continue' }]])
  } finally {
    await server.shutdown()
  }
})

test('a plugin hook whose server is down says nothing and lets Claude Code go on', async () => {
  let ran = await hook('PostToolUse', 'http://127.0.0.1:9', { tool: 'x' })
  assertEquals(ran, { code: 0, said: '' })
})

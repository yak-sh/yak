// Sandbox credentials cross only the container and outbound request boundaries.
import { equal, test } from '@yaks/testing'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { machineTools } from '@yaks/harness/machine'
import { SENTINEL } from '@yaks/secrets'
import { called, transcribed } from './builder.ts'
import { kv } from './binding-probe.ts'
import { sandboxes, workspaces } from './workspace-probe.ts'
import { GRANT } from './grants.ts'
import { HOST, routed, spending, workbench } from './sandbox.ts'
import type { Space } from './directory.ts'

let SECRET = 'a probe secret'
let ADA = 'a0000000-0000-4000-8000-0000000000ad'

let apex = new URL(HOST).host, PLACEHOLDER = SENTINEL + 'a'.repeat(43)
let lend = [{
  sentinel: PLACEHOLDER,
  value: 'token',
  hosts: [apex, `ada.${apex}`],
}]
for (
  let [to, git, expected, status] of [
    [`${HOST}/mcp`, false, 'token', 200],
    [`https://ada.${apex}/chess.git/info/refs`, true, 'token', 200],
    ['https://github.com/withastro/astro', false, PLACEHOLDER, 200],
    [`https://bob.${apex}/`, false, PLACEHOLDER, 200],
    [`https://example.com/?next=${HOST}`, false, PLACEHOLDER, 200],
    [HOST.replace('https:', 'http:'), false, undefined, 403],
  ] as [string, boolean, string | undefined, number][]
) {
  let request = new Request(to, {
    headers: {
      authorization: git
        ? `Basic ${btoa(`x:${PLACEHOLDER}`)}`
        : `Bearer ${PLACEHOLDER}`,
    },
  })
  let answer = new Response('ok')
  test(`a sandbox placeholder ${status == 403 ? 'refuses plaintext' : expected == 'token' ? 'becomes its token' : 'stays a placeholder'} toward ${new URL(to).host}${git ? ' with Git authentication' : ''}`, async () => {
    let out: Request | undefined
    let response = await routed(apex, lend, request, (r, init) => {
      out = r instanceof Request && !init ? r : new Request(r, init)
      return Promise.resolve(answer)
    })
    equal(response.status, status)
    if (status == 403) return equal(out, undefined)
    let said = out!.headers.get('authorization')!.split(' ')[1]
    equal(git ? atob(said).slice(2) : said, expected)
  })
}

let placeholder = async () => {
  let box = sandboxes(() => ({ stdout: 'ok' }))
  let env = {
    SANDBOX: box.SANDBOX,
    WORKSPACES: workspaces(box.SANDBOX),
    OAUTH_KV: kv(),
    SESSION_SECRET: SECRET,
  }
  let { workspace: machine } = await workbench(
    env,
    { eid: 'ada', slug: 'ada' } as Space,
    ADA,
    spending(),
  )
  return { box, machine }
}
let command = await placeholder()
let transcript = await placeholder()
test('a sandbox command holds only its placeholder in its environment and command line', async () => {
  let { box, machine } = command
  await machine.start('yak app_list')
  let placeholder = box.env.at(-1)!.YAKS_TOKEN
  assert(placeholder?.startsWith(SENTINEL), 'the command was signed in')
  for (let handed of box.env.flatMap(Object.values)) {
    assert(!handed.startsWith(GRANT), 'no grant token is handed in')
  }
  for (let said of box.ran) {
    assert(!said.includes(placeholder), `not in ${said.slice(0, 60)}`)
  }
})

let shell = machineTools(transcript.machine).find((tool) =>
  tool.name == 'shell'
)!
let shellCall = {
  id: 'sandbox-call',
  name: 'shell',
  args: JSON.stringify({ command: 'yak app_list' }),
}
let shellRuns = new Map([[
  shell.name,
  async (args: Record<string, unknown>) => [{
    entity: { eid: '$said' },
    output: { source: shellCall.id },
    content: { body: await shell.run(args) },
  }],
]])
test('the container holds a placeholder, never the token, and neither reaches the transcript', async () => {
  let box = transcript.box
  let answer = await called(shellRuns, shellCall)
  let record = transcribed(shellCall, answer)
  assertStringIncludes(answer.text, 'ok')
  assertEquals(record.line.said, 'tool')
  let said = JSON.stringify(record)

  let placeholder = box.env.at(-1)!.YAKS_TOKEN
  assert(placeholder?.startsWith(SENTINEL), 'the command was signed in')
  assert(
    !said.includes(placeholder),
    'no placeholder reaches the transcript',
  )
  assert(!said.includes(GRANT), 'no grant token reaches the transcript')
})

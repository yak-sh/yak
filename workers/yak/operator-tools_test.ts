// Both connector names enter the same Operator door with the caller's seat.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { CallError } from '@yaks/tools/errors'
import { owned } from './directory-fixture.ts'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { call, type Ctx } from './tools.ts'

let requests: Request[] = []
let answer = { task: 'task', session: 'session', text: 'Done.', cost: 0.01 }
let { env } = platform('operator-tools', {
  BUILDER: {
    idFromName: (name) => name,
    get: () => ({
      fetch: (request: Request) => {
        requests.push(request)
        return Promise.resolve(Response.json(answer))
      },
    }),
  },
})
let ctx: Ctx = {
  env,
  dir: directoryOf(env.STORE),
  person: crypto.randomUUID(),
}
let space = await owned(ctx, 'operator-tools')

for (let name of ['operator_chat', 'operator_run']) {
  test(`${name} forwards the request and caller's seat and answers the Operator's result`, async () => {
    let args = {
      space: 'operator-tools',
      say: 'Continue working.',
      task: 'earlier-task',
      provider: 'provider',
      model: 'model',
      attachments: ['attachment'],
    }
    let out = await call(ctx, name, args)
    let request = requests.at(-1)!
    assertEquals(new URL(request.url).pathname, '/operator/run')
    assertEquals(await request.json(), args)
    assertEquals(request.headers.get('x-yak-person'), ctx.person)
    assertEquals(request.headers.get('x-yak-role'), 'owner')
    assertEquals(request.headers.get('x-space-eid'), space)
    assertEquals(out.value, answer)
    assertEquals(out.text, answer.text)
  })

  test(`${name} refuses a caller who cannot write the space before reaching the Operator`, async () => {
    let before = requests.length
    await assertRejects(
      () =>
        call({ ...ctx, person: crypto.randomUUID() }, name, {
          space: 'operator-tools',
          say: 'Do something.',
        }),
      CallError,
      'not a member',
    )
    assertEquals(requests.length, before)
  })
}

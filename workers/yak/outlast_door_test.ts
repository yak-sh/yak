// A release through the connector's door runs in the object it may outlast
// its caller in (outlast.ts), as the caller, and answers what it released.
import { clock, test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { connector, fresh, seed, unique } from './probe.ts'
import { Outlast } from './outlast-object.ts'
import type { Outlasts } from './outlast.ts'
import { durable } from '../../packages/durable-object/testing.ts'
import { sandboxes } from '../../packages/sandbox/testing.ts'
import type { Env } from './env.ts'

let outlasts = (
  env: Env,
  named?: (key: string) => void,
  time?: Env['CLOCK'],
) => {
  let objects = new Map<string, Outlast>()
  env.OUTLAST = {
    idFromName: (name) => (named?.(name), name),
    get: (id) => {
      let name = id as string
      if (!objects.has(name)) {
        let ctx = {
          storage: durable(),
          acceptWebSocket() {},
          getWebSockets: () => [],
        }
        objects.set(name, new Outlast(ctx, env, time))
      }
      return objects.get(name)!
    },
  } satisfies Outlasts
}

test('app_deploy through the door runs in its object and answers its release', async () => {
  let keys: string[] = []
  let k = await fresh({}, (env) => outlasts(env, (key) => keys.push(key)))
  try {
    let space = unique('outlast')
    let { cookie } = await seed(k, [{ slug: space, apps: ['site'] }])
    let agent = connector(k, cookie)
    await agent.tool('app_files', {
      space,
      app: 'site',
      files: [{ path: 'index.html', content: '<h1>Site</h1>' }],
    })
    let said = await agent.tool('app_deploy', { space, app: 'site' })
    assertStringIncludes(JSON.stringify(said), `deployed ${space}/site v1`)
    assertEquals(keys.length, 1)
    assertStringIncludes(keys[0], `|app_deploy|${space}/site`)
  } finally {
    await k.stop()
  }
})

test('sandbox_wait reports progress during preparation and resumes the original wait', async () => {
  let time = clock(Date.now())
  let { WORKBENCH } = sandboxes(() => ({ stdout: 'complete output\n' }))
  let wake = Promise.withResolvers<void>()
  let preparing = Promise.withResolvers<void>()
  let blocked = false
  let lookups = 0
  let k = await fresh({}, (env) => {
    outlasts(env, undefined, time)
    env.WORKBENCH = {
      ...WORKBENCH,
      get: (id) => {
        let box = WORKBENCH.get(id)
        return {
          ...box,
          prepare: async () => {
            if (blocked) {
              preparing.resolve()
              await wake.promise
            }
            await box.prepare()
          },
          getProcess: (process) => {
            if (blocked) lookups++
            return box.getProcess(process)
          },
        }
      },
    }
  })
  try {
    let space = unique('outlast')
    let { cookie } = await seed(k, [{ slug: space, apps: [] }])
    let agent = connector(k, cookie)
    let shell = await agent.tool('sandbox_shell', {
      space,
      command: 'echo complete output',
    })
    let process = shell.match(/process ([\w-]+)/)?.[1]
    if (!process) throw new Error(shell)
    blocked = true
    let args = { process, timeout: 5000, space }
    let first = agent.answer('sandbox_wait', args)
    await Promise.race([
      preparing.promise,
      first.then((out) => {
        throw new Error(out.text)
      }),
    ])
    await time.advance(6_000)
    time.after(1_000, wake.resolve)
    await time.advance(1_000)
    let progress = await first
    assertEquals(progress.value?.running, true)
    assertStringIncludes(progress.text, 'the sandbox is waking')
    let resumed = await agent.tool('sandbox_wait', {
      space,
      process,
      timeout: 5000,
    })
    assertStringIncludes(
      resumed,
      `process ${process} exited 0\ncomplete output`,
    )
    assertEquals(lookups, 1)
  } finally {
    wake.resolve()
    await k.stop()
  }
})

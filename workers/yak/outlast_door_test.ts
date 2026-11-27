// A release through the connector's door runs in the object it may outlast
// its caller in (outlast.ts), as the caller, and answers what it released.
import { clock, test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { connector, fresh, seed, unique } from './probe.ts'
import { Outlast } from './outlast-object.ts'
import { PATIENCE } from '@yaks/tools/outlast'
import type { Outlasts } from './outlast.ts'
import { durable } from '../../packages/durable-object/testing.ts'
import { sandboxes } from '../../packages/sandbox/testing.ts'
import type { Env } from './env.ts'
import { strip } from '@yaks/esbuild/strip'
import { evaluate } from '../../packages/code-mode/testing.ts'
import { compiler } from './testing.ts'

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

test('a code_mode result handle waits for the original invocation', async () => {
  let time = clock(Date.now())
  let started = Promise.withResolvers<void>()
  let ready = Promise.withResolvers<void>()
  let runs = 0
  let k = await fresh({ ESBUILD: compiler() }, (env) => {
    outlasts(env, undefined, time)
    env.CODE_MODE = async (...args) => {
      runs++
      started.resolve()
      await ready.promise
      return await evaluate(args[0], args[1], args[2])
    }
  })
  try {
    let agent = connector(k, k.owner.cookie)
    let result = agent.call('tools/call', {
      name: 'code_mode',
      arguments: { script: 'const answer: number = 21 * 2; return answer' },
    })
    await Promise.race([
      started.promise,
      result.then((out) => {
        throw new Error(JSON.stringify(out))
      }),
    ])
    await time.advance(PATIENCE)
    let pending = (await result).structuredContent.result_handle
    ready.resolve()
    let answer = await agent.answer('result_wait', { result_handle: pending })
    assertEquals(answer.value?.value, 42)
    assertEquals(runs, 1)
  } finally {
    ready.resolve()
    await k.stop()
  }
})

test('app_deploy through the door runs in its object, one per arguments, and answers its release', async () => {
  let keys: string[] = []
  let k = await fresh({}, (env) => outlasts(env, (key) => keys.push(key)))
  try {
    let space = unique('outlast')
    let { cookie } = await seed(k, [{ slug: space, apps: ['site'] }])
    let agent = connector(k, cookie)
    let release = async (content: string, args: object) => {
      await agent.tool('app_files', {
        space,
        app: 'site',
        files: [{ path: 'index.html', content }],
      })
      return JSON.stringify(
        await agent.tool('app_deploy', { space, app: 'site', ...args }),
      )
    }
    assertStringIncludes(await release('<h1>Site</h1>', {}), `${space}/site v1`)
    // Another release's arguments are a run of their own, never the first's.
    assertStringIncludes(
      await release('<h1>Two</h1>', { message: 'Two' }),
      `deployed ${space}/site v2`,
    )
    assertEquals(keys.length, 2)
    assertStringIncludes(keys[0], '|app_deploy|')
    assertEquals(keys[0] == keys[1], false)
  } finally {
    await k.stop()
  }
})

test('a draft preview returns progress while its compiler is busy', async () => {
  let time = clock(Date.now())
  let compiling = Promise.withResolvers<void>()
  let compiled = Promise.withResolvers<void>()
  let builds = 0
  let timings: string[] = []
  let k = await fresh({}, (env) => {
    outlasts(env, undefined, time)
    let assets = env.ASSETS
    env.ASSETS = {
      fetch: (req) =>
        new URL(req.url).pathname == '/_compiler/packages.json'
          ? Promise.resolve(Response.json({}))
          : assets.fetch(req),
    }
    env.ESBUILD = {
      strip,
      fetch: async () => {
        builds++
        compiling.resolve()
        await compiled.promise
        return Response.json({
          pages: { 'main.ts': 'export {}' },
          assets: {},
          installed: [],
          notes: [],
          errors: [],
        }, { headers: { 'server-timing': 'compiler_install;dur=17' } })
      },
    }
  })
  try {
    let space = unique('outlast')
    let { cookie } = await seed(k, [{ slug: space, apps: ['site'] }])
    let agent = connector({
      host: k.host,
      at: async (...args) => {
        let r = await k.at(...args)
        timings.push(r.headers.get('server-timing') ?? '')
        return r
      },
    }, cookie)
    await agent.tool('app_files', {
      space,
      app: 'site',
      files: [
        {
          path: 'index.html',
          content: '<script type="module" src="main.ts"></script>',
        },
        { path: 'main.ts', content: 'let number: number = 42' },
      ],
    })
    let args = { space, app: 'site', screenshot: false }
    let first = agent.answer('app_preview', args)
    await Promise.race([
      compiling.promise,
      first.then((out) => {
        throw new Error(out.text)
      }),
    ])
    await time.advance(PATIENCE)
    let progress = await first
    assertEquals(progress.value?.running, true)
    assertStringIncludes(progress.text, 'the draft is building')
    assertStringIncludes(
      progress.text,
      'Call result_wait with the result_handle',
    )
    compiled.resolve()
    let preview = await agent.answer('result_wait', {
      result_handle: progress.value?.result_handle,
    })
    assertStringIncludes(String(preview.value?.url), '/site/~')
    assertEquals(builds, 1)
    assertEquals(
      timings.some((t) => t.includes('tool_compiler_install;dur=17')),
      true,
    )
  } finally {
    compiled.resolve()
    await k.stop()
  }
})

test('sandbox_wait and sandbox_exec report progress and resume after workbench preparation', async () => {
  let time = clock(Date.now())
  let { WORKBENCH, ran } = sandboxes(() => ({ stdout: 'complete output\n' }))
  let gate: {
    wake: PromiseWithResolvers<void>
    preparing: PromiseWithResolvers<void>
  } | undefined
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
            if (gate) {
              gate.preparing.resolve()
              await gate.wake.promise
            }
            await box.prepare()
          },
          getProcess: (process) => {
            lookups++
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
    let pause = async (tool: string, args: Record<string, unknown>) => {
      let wake = Promise.withResolvers<void>()
      let preparing = Promise.withResolvers<void>()
      gate = { wake, preparing }
      let first = agent.answer(tool, args)
      await Promise.race([
        preparing.promise,
        first.then((out) => {
          throw new Error(out.text)
        }),
      ])
      await time.advance(PATIENCE)
      time.after(1_000, wake.resolve)
      await time.advance(1_000)
      let progress = await first
      assertEquals(progress.value?.running, true)
      assertStringIncludes(progress.text, 'the sandbox is waking')
      assertStringIncludes(progress.text, 'Call result_wait')
    }
    let cmd = 'echo complete output'
    await pause('sandbox_exec', { cmd, space, timeout: 5 })
    let shell = await agent.tool('sandbox_exec', { space, timeout: 5, cmd })
    assertEquals(ran.filter((line) => line == cmd), [cmd])
    let process = shell.match(/process ([\w-]+)/)?.[1]
    if (!process) throw new Error(shell)
    lookups = 0
    await pause('sandbox_wait', { process, timeout: 5000, space })
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
    gate?.wake.resolve()
    await k.stop()
  }
})

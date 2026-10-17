// Source paths follow a private runtime; data and other checkouts do not. A
// launcher's child never outlives its launcher.
import { equal, ok, test, until } from '@yaks/testing'
import { alive, runtimePath, runtimeStack } from './runtime.ts'

test('a runtime remaps source paths without moving neighboring checkouts or data', () => {
  let path = (spec: string) =>
    runtimePath(spec, 'file:///src', 'file:///private')
  equal(
    path('file:///src/packages/tool/tools.ts'),
    'file:///private/packages/tool/tools.ts',
  )
  equal(path('file:///src-other/tool.ts'), 'file:///src-other/tool.ts')
  equal(path('file:///data/yak.db'), 'file:///data/yak.db')
  equal(path('@yaks/task'), '@yaks/task')
  equal(
    runtimeStack(
      'Error\n at file:///private/pkg/a.ts:3:1\n at file:///other/a.ts:2:1',
      'file:///src',
      'file:///private',
    ),
    'Error\n at file:///src/pkg/a.ts:3:1\n at file:///other/a.ts:2:1',
  )
  equal(
    runtimePath('file:///src/tool.ts', undefined, undefined),
    'file:///src/tool.ts',
  )
})

let config = new URL('../../deno.json', import.meta.url).pathname
let runtime = new URL('./runtime.ts', import.meta.url).href
let root = new URL('../../', import.meta.url).href.replace(/\/$/, '')
let text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
let exists = (path: string) => Deno.stat(path).then(() => true, () => false)

// A scratch directory holding the scripts a case runs, gone afterwards.
let scratch = async (
  prefix: string,
  body: (
    script: (name: string, code: string) => Promise<string[]>,
    dir: string,
  ) => Promise<void>,
) => {
  let dir = await Deno.makeTempDir({ prefix })
  try {
    await body(async (name, code) => {
      await Deno.writeTextFile(`${dir}/${name}.ts`, code)
      return ['run', '-A', '--config', config, `${dir}/${name}.ts`]
    }, dir)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

// A launcher's child started the way runtime() starts one, which marks itself
// started and then spins deaf to the SIGTERM it handles, as a worker stuck at
// full CPU does. Each case ends the launcher its own way; the child goes too.
let tethering = (end: (launcher: Deno.ChildProcess) => void) =>
  scratch('yak-tether-', async (script, dir) => {
    let child = 0
    try {
      let spin = await script(
        'spin',
        `Deno.addSignalListener('SIGTERM', () => {})
        Deno.writeTextFileSync(${JSON.stringify(`${dir}/started`)}, '')
        while (true) {}`,
      )
      let launcher = new Deno.Command(Deno.execPath(), {
        args: await script(
          'launch',
          `import { tethered } from ${JSON.stringify(runtime)}
          let [command, ...args] = tethered(${
            JSON.stringify([Deno.execPath(), ...spin])
          })
          let child = new Deno.Command(command, { args }).spawn()
          console.log(child.pid)
          await child.status`,
        ),
        stdout: 'piped',
      }).spawn()
      let out = launcher.stdout.getReader()
      child = Number(text((await out.read()).value!))
      await out.cancel()
      await until(() => exists(`${dir}/started`), {
        timeout: 10_000,
        label: 'the spinning child started',
      })
      end(launcher)
      await launcher.status
      await until(() => !alive(child), { label: `child ${child} gone` })
    } finally {
      // Only the child this test's own launcher started, if it outlived it.
      if (child && alive(child)) Deno.kill(child, 'SIGKILL')
    }
  })

test('a launcher killed outright takes its spinning child with it', () =>
  tethering((launcher) => launcher.kill('SIGKILL')))

test('a launcher ended any other way takes its child too', () =>
  tethering((launcher) => launcher.kill('SIGTERM')))

// A pinned child's handshake: its parent is its owner; a live stranger named
// by an inherited environment is not, and the child runs on as its own; a
// launcher gone before the tie was made ends the child at once.
test('a pinned child owns its parent, ignores a stranger, ends without either', () =>
  scratch('yak-handshake-', async (script) => {
    let gone = new Deno.Command('true').spawn()
    await gone.status
    let shake = await script(
      'shake',
      `import { readinessPid, runtime } from ${JSON.stringify(runtime)}
      let code = await runtime([])
      let pid = readinessPid()
      console.log(JSON.stringify({
        code: code ?? null,
        owner: pid == Deno.ppid ? 'parent' : pid == Deno.pid ? 'self' : pid,
      }))`,
    )
    let ask = async (launcher: number) => {
      let { stdout, stderr } = await new Deno.Command(Deno.execPath(), {
        args: shake,
        env: {
          YAK_RUNTIME_ROOT: root,
          YAK_RUNTIME_FROM: root,
          YAK_RUNTIME_PINNED: '1',
          YAK_LAUNCH_PID: String(launcher),
        },
        stdout: 'piped',
        stderr: 'piped',
      }).output()
      ok(stdout.length, text(stderr))
      return JSON.parse(text(stdout))
    }
    equal(await Promise.all([Deno.pid, 1, gone.pid].map(ask)), [
      { code: null, owner: 'parent' },
      { code: null, owner: 'self' },
      { code: 137, owner: 'self' },
    ])
  }))

// Source paths follow a private runtime; data and other checkouts do not. A
// launcher's child never outlives its launcher.
import { equal, test, until } from '@yaks/testing'
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
let scratch = async <T>(
  prefix: string,
  body: (
    script: (name: string, code: string) => Promise<string[]>,
    dir: string,
  ) => Promise<T>,
): Promise<T> => {
  let dir = await Deno.makeTempDir({ prefix })
  try {
    return await body(async (name, code) => {
      await Deno.writeTextFile(`${dir}/${name}.ts`, code)
      return ['run', '-A', '--config', config, `${dir}/${name}.ts`]
    }, dir)
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

// A launcher's child started the way runtime() starts one, which marks itself
// started and then spins deaf to the SIGTERM it handles, as a worker stuck at
// full CPU does. Each case ends the launcher its own way and says what became
// of the child: 'gone', or how waiting for that failed.
let tethering = (end: (launcher: Deno.ChildProcess) => void) =>
  scratch('yak-tether-', async (script, dir) => {
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
    let child = 0
    try {
      let out = launcher.stdout.getReader()
      child = Number(text((await out.read()).value!))
      await out.cancel()
      await until(() => exists(`${dir}/started`), {
        timeout: 10_000,
        label: 'the spinning child started',
      })
      end(launcher)
      await launcher.status
      return await until(() => !alive(child), { label: `child ${child} gone` })
        .then(() => 'gone', (error: Error) => error.message)
    } finally {
      // Only what this case started: the child, if it outlived its launcher,
      // and the launcher, if the case failed before ending it.
      if (child && alive(child)) Deno.kill(child, 'SIGKILL')
      try {
        launcher.kill('SIGKILL')
      } catch {
        // It has ended, as the case meant.
      }
      await launcher.status
    }
  })

// A pinned child's handshake: its parent is its owner; a live stranger named
// by an inherited environment is not, and the child runs on as its own; a
// launcher gone before the tie was made ends the child at once. Each answer
// is what the child said, or its stderr when it said nothing.
let handshake = () =>
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
      return stdout.length ? JSON.parse(text(stdout)) : text(stderr)
    }
    return await Promise.all([Deno.pid, 1, gone.pid].map(ask))
  })

// Each scenario runs once as the file loads, all at once, and its test reads
// what it left. They start processes, not stand-ins: the kernel's tie between
// a launcher and its child is what these tests hold.
let [killed, ended, shaken] = await Promise.all([
  tethering((launcher) => launcher.kill('SIGKILL')),
  tethering((launcher) => launcher.kill('SIGTERM')),
  handshake(),
])

test('a launcher killed outright takes its spinning child with it', () =>
  equal(killed, 'gone'))

test('a launcher ended any other way takes its child too', () =>
  equal(ended, 'gone'))

test('a pinned child owns its parent, ignores a stranger, ends without either', () =>
  equal(shaken, [
    { code: null, owner: 'parent' },
    { code: null, owner: 'self' },
    { code: 137, owner: 'self' },
  ]))

test('worker inspector launch binds only a local numeric port', async () => {
  let { inspector } = await import('./runtime.ts')
  equal(inspector('19285'), '--inspect=127.0.0.1:19285')
  equal(inspector('0'), '--inspect=127.0.0.1:0')
  for (let value of ['-1', '65536', '0.0.0.0:9229', '9229 --allow-all']) {
    let error = false
    try {
      inspector(value)
    } catch {
      error = true
    }
    equal(error, true)
  }
})

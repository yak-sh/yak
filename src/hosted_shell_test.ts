import { assertEquals, assertMatch } from '@std/assert'
import { type HostedShell, hostedShell } from './hosted_shell.ts'
import { slow, until } from './testing.ts'

let setup = (): HostedShell => ({
  entry: crypto.randomUUID(),
  dir: Deno.makeTempDirSync(),
  cwd: Deno.cwd(),
  command: 'echo once',
  env: { PATH: '/usr/bin:/bin' },
  timeout: 5000,
  limit: 1024,
})

// An actual killed runner, not a mocked process handle. The shell is gated on
// a file so it cannot finish before the replacement attaches to its pidfile.
slow(
  'hosted shell outlives its runner and reattaches without executing twice',
  async () => {
    let o = setup()
    o.command =
      `echo once; while [ ! -f "${o.dir}/release" ]; do sleep .02; done; echo done; echo err >&2; exit 7`
    let module = new URL('./hosted_shell.ts', import.meta.url).href
    let child = new Deno.Command(Deno.execPath(), {
      args: [
        'eval',
        `import { hostedShell } from ${
          JSON.stringify(module)
        }; await hostedShell(${JSON.stringify(o)})`,
      ],
      stdout: 'null',
      stderr: 'inherit',
    }).spawn()
    try {
      await until(() => {
        try {
          return Deno.readTextFileSync(`${o.dir}/${o.entry}.out`).includes(
            'once',
          )
        } catch {
          return false
        }
      }, { timeout: 10000, label: 'detached shell birth' })
      child.kill('SIGKILL')
      await child.status
      let recovered = hostedShell({ ...o, resume: true })
      Deno.writeTextFileSync(`${o.dir}/release`, '')
      let result = await recovered
      assertEquals(result.output, 'once\ndone\n')
      assertEquals(result.facets?.exit, { code: 7 })
      assertEquals(result.facets?.stderr, { text: 'err\n' })
      // Another restart after exit but before graph settlement reads the same
      // kept result. It does not launch or append to the output file.
      assertEquals(await hostedShell({ ...o, resume: true }), result)
    } finally {
      try {
        child.kill('SIGKILL')
      } catch { /* already dead */ }
      await child.status
      Deno.writeTextFileSync(`${o.dir}/release`, '')
      Deno.removeSync(o.dir!, { recursive: true })
    }
  },
)

slow(
  'hosted shell with no surviving pid returns a recoverable error, never re-executes',
  async () => {
    let o = setup()
    // A pid known to have exited, with no code file: the wrapper died too.
    let child = new Deno.Command('true').spawn()
    await child.status
    Deno.writeTextFileSync(
      `${o.dir}/${o.entry}.pid`,
      `${child.pid} ${child.pid}`,
    )
    let result = await hostedShell({ ...o, resume: true })
    assertMatch(String(result.facets?.error.message), /restarted mid-call/)
    assertEquals(result.facets?.exit, undefined)
    assertEquals(
      [...Deno.readDirSync(o.dir!)].some((f) => f.name.endsWith('.out')),
      false,
    )
    Deno.removeSync(o.dir!, { recursive: true })
  },
)

slow(
  'detached shell deadline and cancellation survive the hosted boundary',
  async () => {
    let o = setup()
    let result = await hostedShell({ ...o, command: 'sleep 10', timeout: 100 })
    assertEquals([124, 137].includes(Number(result.facets?.exit.code)), true)
    let controller = new AbortController()
    let pending = hostedShell({
      ...o,
      entry: crypto.randomUUID(),
      command: 'sleep 10',
      signal: controller.signal,
    })
    controller.abort(new Error('stop'))
    try {
      await pending
      throw new Error('expected abort')
    } catch (e) {
      assertEquals((e as Error).message, 'stop')
    }
    Deno.removeSync(o.dir!, { recursive: true })
  },
)

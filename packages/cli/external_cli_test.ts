// Ordinary serve owns its fallback pool; restart queues a handover
// through the CLI without waiting for the old worker's shutdown.

import { assert, assertEquals } from '@std/assert'
import { compose, read } from './host.ts'
import { test, until } from '@yaks/testing'

let root = new URL('../../deno.json', import.meta.url).pathname
let cli = new URL('./yak.ts', import.meta.url).pathname
let text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
let absent = (pid: number) => {
  try {
    Deno.kill(pid, 0)
    return false
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
    return true
  }
}
let child = (dir: string, args: string[], env: Record<string, string>) => {
  let proc = new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', '--config', root, cli, ...args],
    cwd: dir,
    env: {
      HARNESS_HOME: `${dir}/home`,
      TASKS_HOME: `${dir}/home`,
      PROCESS_DIR: `${dir}/processes`,
      YAK_CONFIG: `${dir}/yak.json`,
      TASKS_SESSION: '',
      CLAUDE_CODE_SESSION_ID: '',
      ...env,
    },
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  let ended = false
  let output = proc.output().then((result) => {
    ended = true
    return result
  })
  let kill = (signal: 'SIGTERM' | 'SIGKILL') => {
    if (!ended) proc.kill(signal)
  }
  let exit = async (code = 0) => {
    await until(() => ended, { timeout: 10000, label: 'CLI exits' })
    let result = await output
    assertEquals(result.code, code, text(result.stderr))
    return result
  }
  // The launcher forwards a SIGTERM and waits for its command to drain; a
  // SIGKILL ends both undrained, so it is the last resort.
  let stop = async () => {
    kill('SIGTERM')
    await until(() => ended, { timeout: 10000, label: 'CLI stops' })
      .catch(() => kill('SIGKILL'))
    return await output
  }
  return { proc, output, kill, exit, stop }
}

// Own the real CLI lifecycle during module loading, like readiness_test.ts.
// Every assertion and cleanup still runs; timed cases read completed probes
// rather than measuring OS process scheduling against the 1 ms case budget.
let fallback = async (roles: string[]) => {
  let dir = await Deno.makeTempDir({ prefix: 'yak-fallback-cli-' })
  let socket = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = socket.addr.port
  socket.close()
  let at = `http://127.0.0.1:${port}`
  let worker: number | undefined
  let web: ReturnType<typeof child> | undefined
  let rows = async () => {
    try {
      let res = await fetch(
        `${at}/query?q=${encodeURIComponent('.process&*')}`,
      )
      return res.ok ? await res.json() : []
    } catch {
      return []
    }
  }
  try {
    await Deno.writeTextFile(
      `${dir}/yak.json`,
      JSON.stringify({
        db: 'yak.db',
        hostname: '127.0.0.1',
        port,
        plugins: [
          '@yaks/kernel',
          '@yaks/process',
          '@yaks/api',
          '@yaks/effects',
          {
            use: '@yaks/mail',
            with: { pull: { url: at, token: 'probe' } },
          },
        ],
      }),
    )
    let installed = await compose(
      read(`${dir}/yak.json`),
      ['graph'],
      undefined,
      { process: false },
    )
    await installed.close()
    web = child(dir, ['--config', `${dir}/yak.json`, 'serve'], {})
    await until(async () => {
      let found = (await rows()).find((row: {
        process?: { pid: number; roles: string[]; cwd: string }
      }) =>
        roles.every((role) => row.process?.roles.includes(role)) &&
        row.process?.cwd == dir
      )
      worker = found?.process.pid
      return worker != null
    }, { timeout: 15000, label: `owned fallback ${roles.join(',')} process` })
    assert(worker != null)
    assert(worker != web.proc.pid)
    Deno.kill(worker, 0)
    web.kill('SIGTERM')
    await web.exit(143)
    await until(() => absent(worker!), {
      timeout: 10000,
      label: 'fallback exits with starter',
    })
    let freed = Deno.listen({ hostname: '127.0.0.1', port })
    freed.close()
  } finally {
    let result = await web?.stop()
    if (result?.code) console.error(text(result.stderr))
    if (worker != null && !absent(worker)) Deno.kill(worker, 'SIGTERM')
    try {
      await until(() => worker == null || absent(worker), {
        timeout: 10000,
        label: 'owned fallback pid gone',
      })
    } finally {
      if (worker != null && !absent(worker)) Deno.kill(worker, 'SIGKILL')
      await until(() => worker == null || absent(worker), {
        timeout: 5000,
        label: 'fallback cleanup complete',
      })
      if (web) assert(absent(web.proc.pid))
      let freed = Deno.listen({ hostname: '127.0.0.1', port })
      freed.close()
      await Deno.remove(dir, { recursive: true })
    }
  }
  return true
}

// Both roles share one lifecycle: package-role expansion and ordinary effects
// must survive together in the independent worker, not pay for two CLI boots.
let roles = ['effects', '@yaks/mail']
let survived = await fallback(roles)
for (let role of roles) {
  test(`ordinary serve fallback for ${role} exits after HTTP shutdown`, () =>
    assertEquals(survived, true))
}

// Explicit managed workers have no starter, but an unlinked SQLite handle is
// never a reason to keep a pool alive. Keep the launcher handle until it exits.
let removedGraph = await (async () => {
  let dir = await Deno.makeTempDir({ prefix: 'yak-removed-graph-' })
  let run: ReturnType<typeof child> | undefined
  try {
    await Deno.writeTextFile(
      `${dir}/yak.json`,
      JSON.stringify({
        db: 'yak.db',
        plugins: ['@yaks/kernel', '@yaks/process', '@yaks/effects'],
      }),
    )
    let host = await compose(read(`${dir}/yak.json`), ['graph'], undefined, {
      process: false,
    })
    await host.close()
    run = child(dir, [
      '--config',
      `${dir}/yak.json`,
      'work',
      '--ready',
      `${dir}/ready`,
    ], {})
    await until(async () => {
      try {
        return (await Deno.readTextFile(`${dir}/ready`)).trim() ==
          String(run!.proc.pid)
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return false
        throw error
      }
    }, { timeout: 15000, label: 'worker ready before graph removal' })
    await Deno.remove(`${dir}/yak.db`)
    await run.exit()
    assert(absent(run.proc.pid))
    return true
  } finally {
    await run?.stop()
    await Deno.remove(dir, { recursive: true })
  }
})()
test('independent worker exits when its graph is removed', () =>
  assertEquals(removedGraph, true))

test('restart CLI queues replacements before old stops with no blocking shutdown', async () => {
  let dir = await Deno.makeTempDir({ prefix: 'yak-restart-cli-' })
  let run: ReturnType<typeof child> | undefined
  try {
    await Deno.writeTextFile(
      `${dir}/yak.json`,
      JSON.stringify({
        processes: [
          { unit: 'yak-work' },
          { unit: 'yak-web' },
        ],
      }),
    )
    // This PATH contains only the fake. Its absolute shell needs no host tools;
    // neither an accidental lookup nor a missing flag can reach live systemctl.
    await Deno.writeTextFile(
      `${dir}/systemctl`,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$XDG_RUNTIME_DIR/calls"
case "$*" in
  '--user list-units '*)
    printf '%s\\n' 'yak-work@old.service loaded active running old'
    printf '%s\\n' 'yak-web@old.service loaded active running old'
    ;;
  '--user --no-block start '*)
    unit="$4"
    role="\${unit%%@*}"
    instance="\${unit#*@}"
    instance="\${instance%.service}"
    printf ready > "$XDG_RUNTIME_DIR/$role-$instance.ready"
    ;;
  '--user --no-block stop yak-work@old.service yak-web@old.service') ;;
  *)
    # Refuse any synchronous shutdown request instead of touching systemd.
    exit 91
    ;;
esac
`,
    )
    await Deno.chmod(`${dir}/systemctl`, 0o755)
    run = child(dir, ['restart'], { PATH: dir, XDG_RUNTIME_DIR: dir })
    let result = await run.exit()
    let said = text(result.stdout).trim().split('\n')
    let units = said.map((line) => line.split(' ')[0])
    assertEquals(units.map((u) => u.split('@')[0]), ['yak-work', 'yak-web'])
    assertEquals(said.map((line) => line.split('; ')[1]), [
      'stopping yak-work@old.service',
      'stopping yak-web@old.service',
    ])
    let calls = (await Deno.readTextFile(`${dir}/calls`)).trim().split('\n')
    assertEquals(calls.slice(1), [
      `--user --no-block start ${units[0]}`,
      `--user --no-block start ${units[1]}`,
      '--user --no-block stop yak-work@old.service yak-web@old.service',
    ])
  } finally {
    await run?.stop()
    await Deno.remove(dir, { recursive: true })
  }
})

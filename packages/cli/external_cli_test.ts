// Ordinary serve leaves its fallback pool alive; restart queues a handover
// through the CLI without waiting for the old worker's shutdown.

import { assert, assertEquals } from '@std/assert'
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
  let exit = async () => {
    await until(() => ended, { timeout: 10000, label: 'CLI exits' })
    let result = await output
    assertEquals(result.code, 0, text(result.stderr))
    return result
  }
  return { proc, output, kill, exit }
}

test('ordinary serve fallback outlives HTTP shutdown', async () => {
  let dir = await Deno.makeTempDir({ prefix: 'yak-fallback-cli-' })
  let socket = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = socket.addr.port
  socket.close()
  let at = `http://127.0.0.1:${port}`
  let worker: number | undefined
  let web: ReturnType<typeof child> | undefined
  let rows = async () => {
    try {
      let res = await fetch(`${at}/query?q=${encodeURIComponent('.process&*')}`)
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
        ],
      }),
    )
    web = child(dir, ['--config', `${dir}/yak.json`, 'serve'], {})
    await until(async () => {
      let found = (await rows()).find((row: {
        process?: { pid: number; roles: string[]; cwd: string }
      }) => row.process?.roles.includes('effects') && row.process.cwd == dir)
      worker = found?.process.pid
      return worker != null
    }, { timeout: 15000, label: 'owned fallback effects process' })
    assert(worker != null)
    assert(worker != web.proc.pid)
    Deno.kill(worker, 0)
    web.kill('SIGTERM')
    await web.exit()
    Deno.kill(worker, 0)
    let freed = Deno.listen({ hostname: '127.0.0.1', port })
    freed.close()
  } finally {
    web?.kill('SIGKILL')
    let result = await web?.output
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
})

test('restart CLI queues candidate before old stop with no blocking shutdown', async () => {
  let dir = await Deno.makeTempDir({ prefix: 'yak-restart-cli-' })
  let run: ReturnType<typeof child> | undefined
  try {
    // This PATH contains only the fake. Its absolute shell needs no host tools;
    // neither an accidental lookup nor a missing flag can reach live systemctl.
    await Deno.writeTextFile(
      `${dir}/systemctl`,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$XDG_RUNTIME_DIR/calls"
case "$*" in
  '--user list-units '*)
    printf '%s\\n' 'yak-work@old.service loaded active running old'
    ;;
  '--user --no-block start yak-work@'*)
    unit="$4"
    instance="\${unit#yak-work@}"
    instance="\${instance%.service}"
    printf ready > "$XDG_RUNTIME_DIR/yak-work-$instance.ready"
    printf '%s\\n' ready >> "$XDG_RUNTIME_DIR/calls"
    ;;
  '--user --no-block stop yak-work@old.service') ;;
  '--user --no-block restart yak.service') ;;
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
    let candidate = text(result.stdout).trim()
    assert(/^yak-work@[\w-]+\.service$/.test(candidate), candidate)
    assert(candidate != 'yak-work@old.service')
    assertEquals((await Deno.readTextFile(`${dir}/calls`)).trim().split('\n'), [
      '--user list-units --state=active --plain --no-legend --no-pager ' +
      'yak-work@*.service',
      `--user --no-block start ${candidate}`,
      'ready',
      '--user --no-block stop yak-work@old.service',
      '--user --no-block restart yak.service',
    ])
    let instance = candidate.slice('yak-work@'.length, -'.service'.length)
    assertEquals(
      await Deno.readTextFile(`${dir}/yak-work-${instance}.ready`),
      'ready',
    )
  } finally {
    run?.kill('SIGKILL')
    await run?.output
    await Deno.remove(dir, { recursive: true })
  }
})

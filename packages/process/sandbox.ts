// Bubblewrap machines with one aggregate systemd user scope per sandbox.
// Only workspace is writable and visible to commands; durable control files
// stay outside that mount. The supervisor outlives the host that requested it.
import { resolve } from '@std/path/posix/resolve'
import { decodeBase64, encodeBase64 } from '@std/encoding/base64'
import { derivedEid } from '@yaks/graph'
import type {
  LentMachine,
  Machine,
  MachineProvider,
  MachineRef,
  Proc,
} from '@yaks/machine'
import { sandboxRunner } from './sandbox-runner.ts'

/** Limits for the whole sandbox, including its supervisor and all commands.
 * cpuQuota is a percentage of one CPU; memoryMax is bytes; tasksMax counts
 * processes and threads. No limit may be left unbounded. */
export type SandboxLimits = {
  cpuQuota: number
  memoryMax: number
  tasksMax: number
}

/** Provider data plus the host's optional commit preparation and grants.
 * The default filesystem is the host's read-only /usr, /bin, /lib and /lib64.
 * Network access is opt-in; no host home, /etc, runtime sockets or environment
 * is inherited. image is refused: this provider does not boot images. */
export type SandboxProviderOpts = {
  dir: string
  limits: SandboxLimits
  network?: boolean
  env?: (session?: string) => Record<string, string>
  prepare?: (from: string, machine: Machine, cwd: string) => Promise<void>
  birth?: number
}

type Hello = {
  cgroup: string
  cpu: string[]
  memory: string
  tasks: string
}
let quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`
let delay = () => new Promise((go) => setTimeout(go, 10))
let exists = async (path: string) => {
  try {
    await Deno.lstat(path)
    return true
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
    return false
  }
}
let checkLimits = (limits: SandboxLimits) => {
  if (
    !Number.isFinite(limits.cpuQuota) || limits.cpuQuota < 1 ||
    !Number.isSafeInteger(limits.memoryMax) ||
    limits.memoryMax < 16 * 1024 * 1024 ||
    !Number.isSafeInteger(limits.tasksMax) || limits.tasksMax < 16
  ) {
    throw new Error(
      'sandbox: positive CPU quota, >=16MiB memory and >=16 tasks required',
    )
  }
}

/** Local isolated machines; every command in a sandbox shares its limits.
 * Reconstruct this provider with the same data to wake machines or recover
 * command receipts. Release stops the whole scope before deleting its files. */
export let sandboxProvider = (o: SandboxProviderOpts): MachineProvider => {
  if (Deno.build.os != 'linux') throw new Error('sandbox: Linux is required')
  checkLimits(o.limits)
  o = { ...o, limits: { ...o.limits } }
  let root = resolve(o.dir)
  let location = (ref: MachineRef) => {
    if (ref.address != null) {
      throw new Error('sandbox: cannot attach an address')
    }
    if (!/^[A-Za-z0-9_-]+$/.test(ref.id)) {
      throw new Error('sandbox: id must be a single directory name')
    }
    let dir = `${root}/${ref.id}`
    let control = `${dir}/control`
    let socket = `${control}/control.sock`
    if (new TextEncoder().encode(socket).length > 107) {
      throw new Error(
        'sandbox: control socket path exceeds 107 bytes; use a shorter provider dir',
      )
    }
    let unit = `yak-sandbox-${derivedEid(dir)}.scope`
    return { dir, control, socket, unit, workspace: `${dir}/workspace` }
  }
  let systemctl = async (args: string[]) => {
    let output = await new Deno.Command('/usr/bin/systemctl', {
      args: ['--user', ...args],
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    return {
      ...output,
      text: new TextDecoder().decode(output.stdout).trim(),
      error: new TextDecoder().decode(output.stderr).trim(),
    }
  }
  let rpc = async <T>(
    ref: MachineRef,
    request: Record<string, unknown>,
  ): Promise<T> => {
    let { socket } = location(ref)
    let conn = await Deno.connect({ transport: 'unix', path: socket })
    let timeout = setTimeout(() => {
      try {
        conn.close()
      } catch { /* already closed */ }
    }, o.birth ?? 10000)
    try {
      let bytes = new TextEncoder().encode(JSON.stringify(request) + '\n')
      for (let offset = 0; offset < bytes.length;) {
        offset += await conn.write(bytes.subarray(offset))
      }
      let chunks: Uint8Array[] = []
      let length = 0
      while (true) {
        let buffer = new Uint8Array(65536)
        let n = await conn.read(buffer)
        if (n == null) break
        chunks.push(buffer.slice(0, n))
        length += n
      }
      let all = new Uint8Array(length)
      let offset = 0
      for (let chunk of chunks) {
        all.set(chunk, offset)
        offset += chunk.length
      }
      let result = JSON.parse(new TextDecoder().decode(all))
      if (result.error != null) throw new Error(`sandbox: ${result.error}`)
      return result.value as T
    } finally {
      clearTimeout(timeout)
      try {
        conn.close()
      } catch { /* timed out */ }
    }
  }
  let stop = async (ref: MachineRef) => {
    let { unit } = location(ref)
    let state = await systemctl([
      'show',
      unit,
      '--property=LoadState',
      '--value',
    ])
    if (state.text == 'not-found') return
    if (!state.success) {
      throw new Error(`sandbox: cannot inspect scope: ${state.error}`)
    }
    // Release is destructive, not a graceful command stop. Kill all scope
    // members before stopping; a hostile child may ignore TERM indefinitely.
    await systemctl(['kill', '--signal=SIGKILL', unit])
    let result = await systemctl(['stop', unit])
    if (!result.success) {
      let after = await systemctl([
        'show',
        unit,
        '--property=LoadState',
        '--value',
      ])
      if (after.text != 'not-found') {
        throw new Error(`sandbox: cannot stop scope: ${result.error}`)
      }
    }
  }
  // A filesystem lock, not a module Map: request/wake/release by independent
  // host processes must never start two supervisors for the same machine.
  let locked = async <T>(ref: MachineRef, fn: () => Promise<T>): Promise<T> => {
    await Deno.mkdir(root, { recursive: true, mode: 0o700 })
    // flock runs in its own process: Deno's POSIX record locks are shared
    // by a process and would not serialize concurrent calls in one host.
    // EOF releases this lock even when the requesting host crashes.
    let lock = new Deno.Command('/usr/bin/flock', {
      args: [
        '--exclusive',
        `${root}/.${ref.id}.lock`,
        '/bin/sh',
        '-c',
        'printf x; read -r release',
      ],
      stdin: 'piped',
      stdout: 'piped',
      stderr: 'null',
    }).spawn()
    let reader = lock.stdout.getReader()
    let writer = lock.stdin.getWriter()
    try {
      let acquired = await reader.read()
      if (acquired.done) throw new Error('sandbox: lifecycle lock failed')
      return await fn()
    } finally {
      await writer.close()
      reader.releaseLock()
      await lock.status
    }
  }
  let configuration = async (ref: MachineRef) => {
    let { control } = location(ref)
    let config = JSON.parse(await Deno.readTextFile(`${control}/config.json`))
    if (
      JSON.stringify(config.limits) != JSON.stringify(o.limits) ||
      config.network != !!o.network
    ) {
      throw new Error(
        'sandbox: existing machine has different provider limits or network',
      )
    }
    return config
  }
  let ensure = async (ref: MachineRef) => {
    let { control, socket, unit } = location(ref)
    try {
      await rpc<Hello>(ref, { op: 'hello' })
      return
    } catch (e) {
      if (
        !(e instanceof Deno.errors.NotFound ||
          e instanceof Deno.errors.ConnectionRefused)
      ) {
        throw e
      }
    }
    // Retire the previous scope before replacing a supervisor: stale PIDs
    // cannot be trusted, and commands must not outlive a lost control socket.
    await stop(ref)
    if (await exists(socket)) await Deno.remove(socket)
    let argv = [
      '/usr/bin/systemd-run',
      '--user',
      '--scope',
      '--collect',
      '--quiet',
      '--expand-environment=no',
      `--unit=${unit}`,
      '-p',
      `CPUQuota=${o.limits.cpuQuota}%`,
      '-p',
      `MemoryMax=${o.limits.memoryMax}`,
      '-p',
      'MemorySwapMax=0',
      '-p',
      `TasksMax=${o.limits.tasksMax}`,
      '-p',
      'OOMPolicy=kill',
      '-p',
      'TimeoutStopSec=5s',
      '/usr/bin/python3',
      `${control}/runner.py`,
      control,
    ]
    // The launcher's redirections must happen before backgrounding. Nothing
    // inherits the calling host's output pipes or lifetime after it exits.
    let launcher = await new Deno.Command('/bin/sh', {
      args: [
        '-c',
        `${argv.map(quote).join(' ')} </dev/null >>${
          quote(`${control}/runner.log`)
        } 2>&1 &`,
      ],
      stdin: 'null',
      stdout: 'null',
      stderr: 'piped',
    }).output()
    if (!launcher.success) {
      throw new Error('sandbox: supervisor launcher failed')
    }
    for (let end = Date.now() + (o.birth ?? 10000); Date.now() < end;) {
      try {
        await rpc<Hello>(ref, { op: 'hello' })
        return
      } catch (e) {
        if (
          !(e instanceof Deno.errors.NotFound ||
            e instanceof Deno.errors.ConnectionRefused)
        ) throw e
      }
      await delay()
    }
    await stop(ref)
    throw new Error(
      `sandbox: supervisor failed to start: ${await Deno.readTextFile(
        `${control}/runner.log`,
      )}`,
    )
  }
  let guestPath = (path: string) => resolve('/workspace', path)
  let lend = (ref: MachineRef): LentMachine => {
    let commandId = (call: string) =>
      derivedEid(`sandbox ${ref.id} call ${call}`)
    let machine: Machine = {
      poll: 25,
      start: async (command, cwd, call, session) => {
        let id = call ? commandId(call) : crypto.randomUUID()
        await rpc(ref, {
          op: 'start',
          id,
          command,
          cwd: guestPath(cwd ?? '.'),
          env: o.env?.(session) ?? {},
        })
        return id
      },
      receipt: async (call) => {
        let id = commandId(call)
        return await rpc<Proc | null>(ref, { op: 'look', id }) != null
          ? id
          : undefined
      },
      look: (id) => rpc<Proc | null>(ref, { op: 'look', id }),
      tail: (id, n) => {
        if (!Number.isSafeInteger(n) || n < 0) {
          throw new Error('sandbox: invalid line count')
        }
        return n
          ? rpc<string[]>(ref, { op: 'tail', id, n })
          : Promise.resolve([])
      },
      kill: (id, signal) => rpc<void>(ref, { op: 'kill', id, signal }),
      read: async (path) =>
        new TextDecoder().decode(
          decodeBase64(
            await rpc<string>(ref, { op: 'read', path: guestPath(path) }),
          ),
        ),
      write: (path, content) =>
        rpc<void>(ref, {
          op: 'write',
          path: guestPath(path),
          bytes: encodeBase64(new TextEncoder().encode(content)),
        }),
    }
    return { machine, cwd: '/workspace' }
  }
  return {
    request: async (request) => {
      let { dir, control, workspace } = location(request)
      if (request.image != null) {
        throw new Error('sandbox: this provider cannot boot images')
      }
      if (request.from != null && !o.prepare) {
        throw new Error('sandbox: a commit needs a prepare function')
      }
      return await locked(request, async () => {
        if (!await exists(dir)) {
          let staging = await Deno.makeTempDir({
            dir: root,
            prefix: `.${request.id}-`,
          })
          try {
            let stagedControl = `${staging}/control`
            await Deno.mkdir(stagedControl, { mode: 0o700 })
            await Deno.mkdir(`${staging}/workspace`, { mode: 0o700 })
            let bwrap = [
              '/usr/bin/bwrap',
              '--unshare-all',
              '--new-session',
              '--cap-drop',
              'ALL',
            ]
            if (o.network) bwrap.push('--share-net')
            for (let path of ['/usr', '/bin', '/lib', '/lib64']) {
              if (await exists(path)) bwrap.push('--ro-bind', path, path)
            }
            bwrap.push(
              '--proc',
              '/proc',
              '--dev',
              '/dev',
              '--tmpfs',
              '/tmp',
              '--bind',
              workspace,
              '/workspace',
              '--clearenv',
              '--setenv',
              'PATH',
              '/usr/bin:/bin',
              '--setenv',
              'HOME',
              '/workspace',
            )
            await Deno.writeTextFile(
              `${stagedControl}/runner.py`,
              sandboxRunner,
              {
                mode: 0o600,
              },
            )
            await Deno.writeTextFile(
              `${stagedControl}/config.json`,
              JSON.stringify({
                limits: o.limits,
                network: !!o.network,
                from: request.from ?? null,
                bwrap,
              }),
              { mode: 0o600 },
            )
            await Deno.rename(staging, dir)
          } finally {
            if (await exists(staging)) {
              await Deno.remove(staging, { recursive: true })
            }
          }
        }
        let config = await configuration(request)
        if (config.from != (request.from ?? null)) {
          throw new Error('sandbox: id already requested from another commit')
        }
        await ensure(request)
        let lent = lend(request)
        if (!await exists(`${control}/ready`)) {
          if (request.from != null) {
            await o.prepare!(request.from, lent.machine, lent.cwd!)
          }
          await Deno.writeTextFile(`${control}/ready`, '', { mode: 0o600 })
        }
        return lent
      })
    },
    wake: async (ref) => {
      location(ref)
      return await locked(ref, async () => {
        await configuration(ref)
        if (!await exists(`${location(ref).control}/ready`)) {
          throw new Error('sandbox: preparation incomplete; retry request')
        }
        await ensure(ref)
        return lend(ref)
      })
    },
    release: async (ref) => {
      let { dir } = location(ref)
      await locked(ref, async () => {
        await stop(ref)
        if (await exists(dir)) await Deno.remove(dir, { recursive: true })
      })
    },
    export: async function* (ref, paths) {
      location(ref)
      for (let path of paths) {
        let guest = guestPath(path)
        if (
          path.startsWith('/') || guest == '/workspace' ||
          !guest.startsWith('/workspace/')
        ) {
          throw new Error('sandbox: exported paths must be under its directory')
        }
        // Read inside bubblewrap, not on the host: a workspace symlink must
        // never turn a file export into a read of the host's private files.
        let bytes = decodeBase64(
          await rpc<string>(ref, { op: 'export', path: guest }),
        )
        yield { path, bytes }
      }
    },
  }
}

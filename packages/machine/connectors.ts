// Explicit computer transports. Scripts cross only the configured connection;
// connector failures never fall back to the graph server's filesystem.
import { Refused } from '@yaks/graph/errors'
import type { ComputerConnector, ComputerTransport } from './workspace.ts'
import { quote } from './workspace.ts'

/** A checked short control command, also the injectable SSH test seam. */
export type ControlRunner = (
  command: string,
  args: string[],
  input: string,
) => Promise<string>

/** Run a bounded control command; managed user commands are detached elsewhere. */
export let control: ControlRunner = async (command, args, input) => {
  let child = new Deno.Command(command, {
    args,
    stdin: 'piped',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  let writer = child.stdin.getWriter()
  await writer.write(new TextEncoder().encode(input))
  await writer.close()
  let result = await child.output()
  if (!result.success) {
    throw new Error(
      `Computer control failed (${result.code}): ${
        new TextDecoder().decode(result.stderr)
      }`,
    )
  }
  return new TextDecoder().decode(result.stdout)
}

/** Reach this computer only when explicitly addressed as local://. */
export let localConnector = (
  run: ControlRunner = control,
): ComputerConnector => ({
  connect: (address) => {
    if (address != 'local://') {
      throw new Error('Local connector requires local://')
    }
    // A look here is one local shell, so a short command's exit is seen
    // within milliseconds rather than after a remote round trip's 100 ms.
    return Promise.resolve({
      execute: (script: string) => run('bash', ['-s'], script),
      poll: 5,
    })
  },
})

/** SSH uses the operator's known-host policy; it never disables verification.
 * An identity file may be explicitly pinned without consulting a shared agent. */
export let sshConnector = (options: {
  identity?: string
  knownHosts?: string
  run?: ControlRunner
} = {}): ComputerConnector => ({
  connect: (address) => {
    let url = new URL(address)
    if (
      url.protocol != 'ssh:' || !url.hostname || url.password || url.search ||
      url.hash || (url.pathname && url.pathname != '/')
    ) {
      throw new Error(
        'SSH requires ssh://[user@]host[:port], not a directory or password',
      )
    }
    let host = url.hostname
    let user = decodeURIComponent(url.username)
    if (
      !/^[a-zA-Z0-9_.:-]+$/.test(host) ||
      (user && !/^[a-zA-Z0-9_.-]+$/.test(user))
    ) throw new Error('Invalid SSH host or user')
    let args = [
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'StrictHostKeyChecking=yes',
    ]
    if (options.knownHosts) {
      args.push('-o', 'UserKnownHostsFile=' + options.knownHosts)
    }
    if (url.port) args.push('-p', url.port)
    if (options.identity) {
      args.push(
        '-o',
        'IdentityAgent=none',
        '-o',
        'IdentitiesOnly=yes',
        '-i',
        options.identity,
      )
    }
    args.push('--', user ? `${user}@${host}` : host, 'bash -s')
    return Promise.resolve({
      execute: (script: string) =>
        (options.run ?? control)('ssh', args, script),
    })
  },
})

/** Request through a configured API binding. Authentication is supplied at
 * invocation, never stored in an address or a process receipt. */
export type PveRequest = (
  method: 'GET' | 'POST',
  path: string,
  values?: Record<string, unknown>,
) => Promise<Record<string, unknown>>

/** HTTPS API transport with a fresh vault-resolved token on each request. */
export let pveRequest = (options: {
  endpoint: string
  token: () => Promise<string>
  fetch?: typeof fetch
}): PveRequest => {
  let base = new URL(options.endpoint)
  if (
    base.protocol != 'https:' || base.username || base.password ||
    base.search || base.hash
  ) throw new Error('PVE endpoint must be credential-free HTTPS')
  return async (method, path, values = {}) => {
    if (!path.startsWith('/nodes/')) {
      throw new Error('PVE control requires a node path')
    }
    let url = new URL(base)
    url.pathname = '/api2/json' + path
    if (method == 'GET') {
      for (let [key, value] of Object.entries(values)) {
        url.searchParams.set(key, String(value))
      }
    }
    let result = await (options.fetch ?? fetch)(url, {
      method,
      redirect: 'error',
      headers: {
        Authorization: 'PVEAPIToken=' + await options.token(),
        'Content-Type': 'application/json',
      },
      ...method == 'POST' ? { body: JSON.stringify(values) } : {},
    })
    if (!result.ok) {
      throw new Error(`PVE API refused control (${result.status})`)
    }
    return (await result.json()).data
  }
}

/** Reach a Linux QEMU guest through the PVE guest agent. LXC and the PVE host
 * have no guest-agent exec door: reach those computers with SSH instead. */
export let pveConnector = (options: {
  request: PveRequest
  pause?: () => Promise<void>
  attempts?: number
}): ComputerConnector => ({
  connect: (address): Promise<ComputerTransport> => {
    let match = /^pve:\/\/([a-zA-Z0-9_.-]+)\/qemu\/([1-9][0-9]*)$/.exec(address)
    if (!match) {
      throw new Error(
        'PVE command target requires pve://node/qemu/VMID; use SSH for LXC or the PVE host',
      )
    }
    let path = `/nodes/${match[1]}/qemu/${match[2]}/agent`
    return Promise.resolve({
      execute: async (script: string) => {
        let result = await options.request('POST', path + '/exec', {
          command: ['bash', '-c', script],
        })
        let pid = result.pid
        if (!Number.isSafeInteger(pid) || Number(pid) <= 0) {
          throw new Error('PVE returned no control process handle')
        }
        for (let n = 0; n < (options.attempts ?? 100); n++) {
          let status = await options.request('GET', path + '/exec-status', {
            pid,
          })
          if (status.exited) {
            if (
              status.exitcode !== 0 || status['out-truncated'] ||
              status['err-truncated']
            ) throw new Error('PVE control failed or returned truncated output')
            return String(status['out-data'] ?? '')
          }
          await (options.pause ??
            (() => new Promise((r) => setTimeout(r, 100))))()
        }
        throw new Error(
          'PVE control timed out; reconnect to the original receipt, do not relaunch',
        )
      },
    })
  },
})

/** Select only a configured scheme, without an implicit local default. */
export let computer = async (
  address: string | undefined,
  configured: Record<string, ComputerConnector>,
): Promise<ComputerTransport> => {
  if (!address) throw new Refused('Computer placement/address is unknown')
  let scheme = address.slice(0, address.indexOf(':'))
  let connector = configured[scheme]
  if (!connector) {
    throw new Refused('Computer connector is not configured: ' + scheme)
  }
  return await connector.connect(address)
}

/** A diagnostic script that reads OS identity, not a directory-derived id.
 * The caller reconciles this observation with a minted computer entity. */
export let computerIdentity = (transport: ComputerTransport): Promise<string> =>
  transport.execute(`cat /etc/machine-id || hostname`).then((s) => s.trim())

/** Export the shell quoting used by connectors for downstream adapters. */
export { quote }

// Transport contracts refuse guessed placement and preserve remote failures.
import { equal, test, throws } from '@yaks/testing'
import {
  computer,
  pveConnector,
  pveRequest,
  sshConnector,
} from './connectors.ts'

let sent: { command: string; args: string[]; input: string }[] = []
let ssh = await sshConnector({
  identity: '/configured/key',
  run: (command, args, input) => {
    sent.push({ command, args, input })
    return Promise.resolve('remote')
  },
}).connect('ssh://operator@remote:2222')
await ssh.execute('printf remote')

test('SSH keeps scripts on the configured computer and pins explicit identity', () => {
  equal(sent[0].command, 'ssh')
  equal(sent[0].args.slice(-3), ['--', 'operator@remote', 'bash -s'])
  equal(sent[0].args.includes('2222'), true)
  equal(sent[0].args.includes('StrictHostKeyChecking=yes'), true)
  equal(sent[0].args.includes('IdentityAgent=none'), true)
  equal(sent[0].input, 'printf remote')
})

test('unknown computers and unsupported PVE LXC targets fail closed', async () => {
  await throws(() => computer(undefined, {}))
  await throws(() => computer('ssh://unconfigured', {}))
  throws(() =>
    pveConnector({ request: () => Promise.resolve({}) }).connect(
      'pve://pve/lxc/115',
    )
  )
  throws(() => sshConnector().connect('ssh://user:password@host'))
})

let requests: unknown[] = []
let guest = await pveConnector({
  request: (method, path, values) => {
    requests.push([method, path, values])
    return Promise.resolve(
      method == 'POST'
        ? { pid: 40 }
        : { exited: true, exitcode: 0, 'out-data': 'guest output' },
    )
  },
}).connect('pve://pve/qemu/201')
let output = await guest.execute('printf test')
test('PVE guest agent observes its control handle and returns decoded API output', () => {
  equal(output, 'guest output')
  equal(requests, [
    ['POST', '/nodes/pve/qemu/201/agent/exec', {
      command: ['bash', '-c', 'printf test'],
    }],
    ['GET', '/nodes/pve/qemu/201/agent/exec-status', { pid: 40 }],
  ])
})

let headers: string[] = [], urls: string[] = [], token = 'first'
let api = pveRequest({
  endpoint: 'https://pve.example:8006',
  token: () => Promise.resolve(token),
  fetch: ((url, init) => {
    headers.push(new Headers(init?.headers).get('Authorization')!)
    urls.push(String(url))
    return Promise.resolve(Response.json({ data: { exited: true } }))
  }) as typeof fetch,
})
await api('GET', '/nodes/pve/qemu/201/agent/exec-status', { pid: 40 })
token = 'rotated'
await api('GET', '/nodes/pve/qemu/201/agent/exec-status', { pid: 41 })
test('PVE authentication resolves on every invocation and never enters resource addresses', () => {
  equal(headers, ['PVEAPIToken=first', 'PVEAPIToken=rotated'])
  equal(
    urls[0],
    'https://pve.example:8006/api2/json/nodes/pve/qemu/201/agent/exec-status?pid=40',
  )
})

test('PVE refuses truncated control output instead of treating it as a receipt', async () => {
  let transport = await pveConnector({
    request: (method) =>
      Promise.resolve(
        method == 'POST'
          ? { pid: 1 }
          : { exited: true, exitcode: 0, 'out-truncated': true },
      ),
  }).connect('pve://pve/qemu/201')
  await throws(() => transport.execute('anything'))
})

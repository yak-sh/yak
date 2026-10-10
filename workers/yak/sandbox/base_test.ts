// The registry check and Docker login share credentials, but neither depends
// on the other. A deploy overlaps their I/O and settles both before proceeding
// or failing so the wrapper never exits while its Docker child is running.
import { equal, ok, test, throws, tick } from '@yaks/testing'
import { based, imaged, pinned } from './base.ts'

let credentials = JSON.stringify({
  username: 'v1',
  password: 'p',
  account_id: '0f9613dfd3f0451df0bd0f12a1372ea3',
})
let pending = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  let promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('sandbox base overlaps registry HEAD with Docker login', async () => {
  let login = pending<{ ok: boolean; out: string }>()
  let started = pending<void>()
  let checked = pending<void>()
  let calls: string[][] = []
  let deploy = based({
    wrangler: ['wrangler'],
    go: (cmd, input) => {
      calls.push(cmd)
      if (cmd[0] == 'wrangler') {
        return Promise.resolve({ ok: true, out: credentials })
      }
      equal(cmd.slice(0, 2), ['docker', 'login'])
      equal(input, 'p')
      started.resolve()
      return login.promise
    },
    has: (_ref, password) => {
      equal(password, 'p')
      checked.resolve()
      return Promise.resolve(true)
    },
  })
  let settled = false
  deploy.finally(() => settled = true)
  await started.promise
  await tick()
  // Under the serial implementation HEAD cannot start until this login ends.
  let concurrent = await Promise.race([
    checked.promise.then(() => true),
    tick().then(() => false),
  ])
  login.resolve({ ok: true, out: '' })
  let image = await deploy
  ok(concurrent, 'HEAD starts while login remains in flight')
  ok(settled)
  equal(calls.map((cmd) => cmd.slice(0, 2).join(' ')), [
    'wrangler containers',
    'docker login',
  ])
  equal(
    image,
    pinned(await Deno.readTextFile(new URL('./Dockerfile', import.meta.url))),
  )
})

test('sandbox base waits for Docker login when registry HEAD fails', async () => {
  let login = pending<{ ok: boolean; out: string }>()
  let started = pending<void>()
  let checked = pending<void>()
  let done = false
  let failure = based({
    wrangler: ['wrangler'],
    go: (cmd) => {
      if (cmd[0] == 'wrangler') {
        return Promise.resolve({ ok: true, out: credentials })
      }
      started.resolve()
      return login.promise
    },
    has: () => {
      checked.resolve()
      return Promise.reject(new Error('registry 403'))
    },
  }).then(() => {
    done = true
  }, (error) => {
    done = true
    throw error
  })
  // Attach the rejection check before yielding, so it owns the failure.
  let checkedFailure = throws(() => failure, 'registry 403')
  await started.promise
  await tick()
  equal(done, false)
  login.resolve({ ok: true, out: '' })
  await checked.promise
  await checkedFailure
})

test('source-addressed images build and push once, and failures refuse the image', async () => {
  let held = new Set<string>(), calls: string[][] = []
  let failing = ''
  let ensure = (name: string) =>
    imaged({
      wrangler: ['wrangler'],
      name,
      context: '/compiler',
      dockerfile: '/worker/Dockerfile',
      has: (ref) => Promise.resolve(held.has(ref)),
      go: (cmd) => {
        calls.push(cmd)
        if (cmd[0] == 'wrangler') {
          return Promise.resolve({ ok: true, out: credentials })
        }
        if (cmd[1] == 'push' && !failing) {
          held.add(cmd[2])
        }
        return Promise.resolve({ ok: cmd[1] != failing, out: '' })
      },
    })
  let first = await ensure('compiler:inputs-one')
  await ensure('compiler:inputs-one')
  equal(calls.filter((c) => c[1] == 'build').length, 1)
  equal(calls.filter((c) => c[1] == 'push'), [['docker', 'push', first]])
  await ensure('compiler:inputs-two')
  equal(calls.filter((c) => c[1] == 'build').length, 2)
  ok(calls.find((c) => c[1] == 'build')!.includes('/worker/Dockerfile'))
  for (let failure of ['build', 'push']) {
    failing = failure
    await throws(() => ensure('compiler:inputs-' + failure), 'failed')
  }
})

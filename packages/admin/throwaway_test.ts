// A throwaway lasts one command, and never changes the box's own account.
import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import type { Comp } from '@yaks/graph'
import { compose } from '@yaks/cli/host'
import { pick } from '@yaks/connections'
import { integrationEid } from '@yaks/connections/identity'
import { sealed } from '@yaks/secrets'
import { type Run, throwaway } from './throwaway.ts'

let box = async () => {
  let host = await compose({
    db: ':memory:',
    person: 'owner',
    plugins: [
      '@yaks/kernel',
      '@yaks/provenance',
      '@yaks/id',
      '@yaks/edge',
      '@yaks/doc',
      '@yaks/persona',
      '@yaks/mail',
      '@yaks/effects',
      '@yaks/secrets',
      '@yaks/connections',
    ],
  }, ['graph'])
  let kept = (account: string) =>
    host.graph.apply([{
      ...sealed(`connection:${account}`, account),
      connection: {
        owner: 'owner',
        integration: 'yaks.app',
        account,
        status: 'connected',
      },
    }])
  await host.graph.apply([
    {
      entity: { eid: 'owner' },
      person: {},
      email: { address: 'own@example.com' },
    },
    {
      entity: { eid: integrationEid('yaks.app') },
      integration: { name: 'yaks.app', hosts: ['yaks.app'] },
    },
  ])
  await kept('own@example.com')
  let accounts = async () =>
    (await host.graph.read('.connection.owner=owner&.order=created.at'))
      .map((b) => (b.connection as Comp).account)
  let chosen = async () =>
    ((await pick(host.graph.read, 'owner', 'yaks.app'))?.connection as Comp)
      .account
  let signIns: string[] = []
  let erased: string[] = []
  // yaks.app's account door: it erases the account the request names, or
  // answers `status` without erasing it.
  let go = async (run: Run, args: Record<string, unknown>, status = 200) => {
    let was = globalThis.fetch
    globalThis.fetch = ((url: string) => {
      let address = new URL(url).searchParams.get('address')!
      if (status != 200) {
        return Promise.resolve(
          Response.json({ error: { message: 'down' } }, { status }),
        )
      }
      erased.push(address)
      return Promise.resolve(
        Response.json({ address, erased: true, spaces: [], seats: [] }),
      )
    }) as typeof fetch
    try {
      return await throwaway(run, async (_host, _owner, address) => {
        signIns.push(address)
        await kept(address)
      })(
        { command: 'probe', ...args },
        host,
        {} as Parameters<ReturnType<typeof throwaway>>[2],
      )
    } finally {
      globalThis.fetch = was
    }
  }
  return { host, kept, accounts, chosen, signIns, erased, go }
}

test('the command runs as the account, whose connection ends with it', async () => {
  let { host, accounts, chosen, erased, go } = await box()
  try {
    let seen: unknown[] = []
    let code = await go(async (command, env) => {
      seen = [command, env, await accounts(), await chosen()]
      return 7
    }, { name: 'reviewer' })
    equal(code, 7)
    equal(seen, [
      'probe',
      { YAK_AS: 'reviewer@bot.yak.sh', YAKS_TOKEN: '' },
      ['own@example.com', 'reviewer@bot.yak.sh'],
      'own@example.com',
    ])
    equal(await accounts(), ['own@example.com'])
    equal(erased, ['reviewer@bot.yak.sh'])
  } finally {
    await host.close()
  }
})

test('a command that throws still ends the connection', async () => {
  let { host, accounts, go } = await box()
  try {
    await assertRejects(
      async () => await go(() => Promise.reject(new Error('boom')), {}),
      Error,
      'boom',
    )
    equal(await accounts(), ['own@example.com'])
  } finally {
    await host.close()
  }
})

test('a connection that was already there is used and stays', async () => {
  let { host, kept, accounts, signIns, go } = await box()
  try {
    await kept('admin@bot.yak.sh')
    equal(await go(() => Promise.resolve(0), { name: 'admin' }), 0)
    equal(signIns, [])
    equal(await accounts(), ['own@example.com', 'admin@bot.yak.sh'])
  } finally {
    await host.close()
  }
})

test('without a name, each run is a fresh probe address', async () => {
  let { host, signIns, go } = await box()
  try {
    await go(() => Promise.resolve(0), {})
    equal(signIns[0].startsWith('probe-'), true)
    equal(signIns[0].endsWith('@bot.yak.sh'), true)
  } finally {
    await host.close()
  }
})

test('an account signed in before the command outlives it', async () => {
  let { host, kept, erased, go } = await box()
  try {
    await kept('reviewer@bot.yak.sh')
    await go(() => Promise.resolve(0), { name: 'reviewer' })
    equal(erased, [])
  } finally {
    await host.close()
  }
})

test('an account the platform could not erase still loses its connection', async () => {
  let { host, accounts, erased, go } = await box()
  try {
    equal(await go(() => Promise.resolve(0), { name: 'reviewer' }, 503), 0)
    equal(erased, [])
    equal(await accounts(), ['own@example.com'])
  } finally {
    await host.close()
  }
})

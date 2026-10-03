// Admin reaches one connection, never a parallel account/session registry.
import { equal, ok, test } from '@yaks/testing'
import { assertRejects, assertThrows } from '@std/assert'
import { compose } from '@yaks/cli/host'
import type { Bundle, Comp } from '@yaks/graph'
import { integrationEid } from '@yaks/connections'
import { reveal, secretEid } from '@yaks/secrets'
import { CallError, Interrupted } from '@yaks/tools'
import { ADMIN } from '../../workers/yak/lib/bots.ts'
import { ended, Refused, runs } from './tools.ts'

let box = async () => {
  let host = await compose({
    db: ':memory:',
    person: 'owner',
    plugins: [
      '@yaks/kernel',
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
  let kept = async (address: string, bearer = address, session?: string) => {
    await host.graph.apply([{
      entity: { eid: secretEid(`connection:${address}`) },
      connection: {
        owner: 'owner',
        integration: 'yaks.app',
        account: address,
        status: 'connected',
      },
      secret: {
        name: `connection:${address}`,
        value: session
          ? JSON.stringify({ access_token: bearer, website_session: session })
          : bearer,
      },
    }])
  }
  let ask = (tool: string, args: Record<string, unknown> = {}) =>
    runs(host)[tool](
      { entity: { eid: 'call' }, call: { args } },
      host.graph,
    ) as Promise<Bundle[]>
  return { host, kept, ask }
}
let body = (answer: Bundle[]) =>
  answer.map((b) => (b.content as Comp)?.body).filter(Boolean).join('\n')
let answering = async (
  reply: (url: string, init?: RequestInit) => Response,
  run: () => Promise<void>,
) => {
  let was = globalThis.fetch
  globalThis.fetch =
    ((url, init) => Promise.resolve(reply(String(url), init))) as typeof fetch
  try {
    await run()
  } finally {
    globalThis.fetch = was
  }
}

test('fee uses computed own account by default and --as selects another bearer', async () => {
  let { host, kept, ask } = await box()
  try {
    await kept('probe@bot.yak.sh', 'probe-bearer')
    await kept('own@example.com', 'own-bearer')
    let sent: string[] = []
    await answering((_url, init) => {
      let headers = new Headers(init?.headers)
      equal(headers.get('cookie'), null)
      sent.push(headers.get('authorization')!)
      return Response.json({ bps: 250, rate: '2.5%' })
    }, async () => {
      equal(body(await ask('admin_fee')), '250 bps — 2.5% of each sale')
      await ask('admin_fee', { as: 'probe' })
    })
    equal(sent, ['Bearer own-bearer', 'Bearer probe-bearer'])
  } finally {
    await host.close()
  }
})

test('upload accepts the oldest account default without --as and sends bearer bytes', async () => {
  let { host, kept, ask } = await box()
  let dir = Deno.makeTempDirSync({ prefix: 't64688-' }),
    path = `${dir}/theme.mp3`
  let bytes = new Uint8Array([0x49, 0x44, 0x33, 0, 1])
  Deno.writeFileSync(path, bytes)
  try {
    await kept('probe@bot.yak.sh', 'probe-bearer')
    await answering((url, init) => {
      equal(url, 'https://probe.yaks.app/vale/api/blob')
      equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer probe-bearer',
      )
      equal(new Headers(init?.headers).get('cookie'), null)
      equal(init?.body, bytes)
      return Response.json({
        url: '/vale/api/blob/sha',
        bytes: 5,
        mime: 'audio/mpeg',
      })
    }, async () => {
      equal(
        body(
          await ask('admin_upload', {
            where: 'probe/vale',
            path,
            mime: 'audio/mpeg',
          }),
        ),
        '/vale/api/blob/sha — 5 bytes, audio/mpeg',
      )
    })
  } finally {
    await host.close()
    Deno.removeSync(dir, { recursive: true })
  }
})

test('delete and accept explain browser OAuth has no website session before making a request', async () => {
  let { host, kept, ask } = await box()
  try {
    await kept('own@example.com', 'browser-bearer')
    await answering(() => {
      throw new Error('must not fetch')
    }, async () => {
      for (let name of ['admin_delete', 'admin_accept']) {
        await assertRejects(
          () => ask(name, { space: 'example', letter: 'missing' }),
          Refused,
          'no website session',
        )
      }
    })
  } finally {
    await host.close()
  }
})

test('delete walks website pages and keeps a renewed cookie only inside the OAuth record', async () => {
  let { host, kept, ask } = await box()
  try {
    await kept('probe@bot.yak.sh', 'oauth-bearer', 'old-website')
    let hits = 0
    await answering((_url, init) => {
      equal(new Headers(init?.headers).get('cookie'), 'yak_session=old-website')
      equal(new Headers(init?.headers).get('authorization'), null)
      hits++
      return new Response('<h1>Deleted</h1><p>Done</p>', {
        headers: { 'set-cookie': 'yak_session=fresh-website; Path=/' },
      })
    }, async () => {
      await ask('admin_delete', { space: 'probe' })
    })
    equal(hits, 2)
    let record = JSON.parse(
      (await reveal(host.vault, 'connection:probe@bot.yak.sh'))!,
    )
    equal(record.website_session, 'fresh-website')
    equal(record.access_token, 'oauth-bearer')
    ok(
      !JSON.stringify(await host.graph.read('.connection&*')).includes(
        'fresh-website',
      ),
    )
  } finally {
    await host.close()
  }
})

test('infrastructure rejects a throwaway but accepts the admin and own account with optional --as', async () => {
  let { host, kept, ask } = await box()
  try {
    await kept('probe@bot.yak.sh')
    await assertRejects(
      () => ask('admin_revert', { sha: 'HEAD' }),
      Refused,
      'Infrastructure requires',
    )
    await kept(ADMIN)
    await assertRejects(
      () => ask('admin_revert', { as: 'admin', sha: 'HEAD' }),
      CallError,
      '<sha>',
    )
    await kept('own@example.com')
    await assertRejects(
      () => ask('admin_revert', { sha: 'HEAD' }),
      CallError,
      '<sha>',
    )
  } finally {
    await host.close()
  }
})

test('invalid basis points and credential values are rejected before reading accounts', async () => {
  let { host, ask } = await box()
  try {
    for (let bps of ['2.5', '-5', 'lots']) {
      await assertRejects(
        () => ask('admin_fee', { bps }),
        CallError,
        'basis points',
      )
    }
    await assertRejects(
      () => ask('admin_client', { name: 'google', id: 'plaintext' }),
      CallError,
      'op://',
    )
  } finally {
    await host.close()
  }
})

test('an interrupted platform operation is cut off, not refused', () => {
  equal(assertThrows(() => ended('errors', 130), Interrupted).code, 'signal')
  assertThrows(() => ended('errors', 1), Error, 'ended with status 1')
  equal(ended('errors', 0), [])
})

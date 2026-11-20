// A test account whose website session lapsed signs itself in again from its
// own mail, and the fresh session is kept in its connection's record.
import { equal, test } from '@yaks/testing'
import { compose } from '@yaks/cli/host'
import { mint } from '@yaks/graph'
import { reveal } from '@yaks/secrets'
import { secretEid } from '@yaks/secrets'
import { integrationEid } from '@yaks/connections/identity'
import { account } from './account.ts'

// A session as the platform seals one: claims a client can read, then a mac.
let sealed = (exp: number) =>
  `${btoa(JSON.stringify({ person: 'p', space: null, exp }))}.mac`
let later = Math.floor(Date.now() / 1000) + 86_400

let held = async (address: string, session?: string) => {
  let owner = mint(), name = `connection:${mint()}`
  let host = await compose({
    db: ':memory:',
    person: owner,
    plugins: [
      '@yaks/kernel',
      '@yaks/provenance',
      '@yaks/id',
      '@yaks/edge',
      '@yaks/doc',
      '@yaks/effects',
      '@yaks/secrets',
      '@yaks/connections',
      '@yaks/persona',
    ],
  }, ['graph'])
  await host.graph.apply([
    { entity: { eid: owner }, person: {} },
    {
      entity: { eid: integrationEid('yaks.app') },
      integration: { name: 'yaks.app', hosts: ['yaks.app'] },
    },
    {
      entity: { eid: secretEid(name) },
      connection: {
        owner,
        integration: 'yaks.app',
        status: 'connected',
        account: address,
      },
      secret: {
        name,
        value: JSON.stringify({
          access_token: 'bearer',
          token_type: 'Bearer',
          expires_at: Date.now() + 86_400_000,
          ...session ? { website_session: session } : {},
        }),
      },
    },
  ], { trusted: true })
  let kept = async () =>
    JSON.parse((await reveal(host.vault, name, { env: () => undefined }))!)
      .website_session
  return { host, kept }
}

let signIns: string[] = []
let signIn = (_: unknown, origin: string, address: string) => {
  signIns.push(`${address} at ${origin}`)
  return Promise.resolve(sealed(later))
}

test('a test account with a lapsed or missing session signs in again when a browser door asks, and keeps the new one', async () => {
  for (let session of [sealed(1), undefined]) {
    signIns = []
    let { host, kept } = await held('probe@bot.yak.sh', session)
    try {
      let at = await account(host, signIn)('probe@bot.yak.sh')
      equal(signIns, [])
      equal(await at.signedIn!(), sealed(later))
      equal(signIns, ['probe@bot.yak.sh at https://yaks.app'])
      equal(await kept(), sealed(later))
    } finally {
      await host.close()
    }
  }
})

test('a live session is used as held, and a person’s account never signs itself in', async () => {
  signIns = []
  let live = await held('probe@bot.yak.sh', sealed(later))
  let person = await held('ada@example.com', sealed(1))
  try {
    equal(
      await (await account(live.host, signIn)('probe')).signedIn!(),
      sealed(later),
    )
    equal(
      await (await account(person.host, signIn)('ada')).signedIn!(),
      sealed(1),
    )
    equal(signIns, [])
  } finally {
    await live.host.close()
    await person.host.close()
  }
})

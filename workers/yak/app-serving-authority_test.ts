import { equal, test } from '@yaks/testing'
import { servingAuthority } from './app-serving-authority.ts'
import { EPOCH } from './directory-copy.ts'

let app = '00000000-0000-4000-8000-000000000001'
let authority = servingAuthority({
  read: (word) => word === 'app' ? app : null,
  write: () => {},
  hold: () => {},
  copy: () => null,
  directory: () => null,
  now: () => 0,
  transport: () => ({
    fetch: () =>
      Promise.resolve(Response.json([{
        entity: { eid: app },
        app: { access: 'private' },
      }], { headers: { [EPOCH]: '3' } })),
  }),
  vouch: () => {},
  atomic: (run) => run(),
  bind: () => {},
  mode: () => {},
})

test('the app retains its editor standing on recheck without a member row', async () => {
  let headers = { 'x-yak-app': app, 'x-yak-role': 'editor' }
  let forApp = new Request('https://app.test', {
    headers: { ...headers, 'x-yak-person': app },
  })
  let forStranger = new Request('https://app.test', {
    headers: {
      ...headers,
      'x-yak-person': '00000000-0000-4000-8000-000000000002',
    },
  })
  await authority.recheck(forApp)
  await authority.recheck(forStranger)
  equal(forApp.headers.get('x-yak-role'), 'editor')
  equal(forStranger.headers.get('x-yak-role'), null)
})

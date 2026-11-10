import { equal, test } from '@yaks/testing'
import { storefront } from './storefront.ts'
import crayonbloom from '../crayonbloom/worker.ts'

for (let app of ['printbound', 'crayonbloom']) {
  for (let method of ['GET', 'POST']) {
    test(`${app} relays ${method} drafts through the caller store binding`, async () => {
      let sent: [string, RequestInit | undefined][] = []
      let blocked = {
        fetch: () => {
          throw new Error('Unexpected app access')
        },
      }
      let expected = Response.json({ principal: 'caller', drafts: [] }, {
        headers: { 'cache-control': 'private, no-store' },
      })
      let env = {
        APP: blocked,
        FILES: blocked,
        STORE: {
          fetch: (path: string, init?: RequestInit) => {
            sent.push([path, init])
            return Promise.resolve(expected)
          },
        },
      }
      let body = JSON.stringify({
        principal: 'caller',
        place: 'prompt',
        text: 'Kept text',
        over: '',
      })
      let req = new Request('https://fixture.test/studio/drafts', {
        method,
        ...(method === 'POST' ? { body } : {}),
      })
      let got = app === 'printbound'
        ? await storefront(req, env, () => Promise.resolve({}))
        : await crayonbloom.fetch(req, env)
      equal(got, expected)
      equal(sent[0][0], '/drafts')
      equal(sent[0][1]?.method, method)
      equal(sent[0][1]?.body, method === 'POST' ? body : undefined)
    })
  }
}

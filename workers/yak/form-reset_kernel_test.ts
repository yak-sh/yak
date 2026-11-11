// A deploy that restarts an app's store under a person's form submission
// never reaches them: the door sends it again, and a submission that had
// already landed is not filed twice (T-134279).
import { equal, test } from '@yaks/testing'
import { connector, fresh, signIn } from './probe.ts'

test('a submission whose answer a restart cuts off is sent again and filed once', async () => {
  let cut = 0
  let k = await fresh({}, (env) => {
    let stores = env.STORE
    env.STORE = {
      ...stores,
      get: (id, options) => {
        let store = stores.get(id, options)
        return {
          ...store,
          fetch: async (req: Request) => {
            let answer = await store.fetch(req)
            let submit = new URL(req.url).pathname == '/form' &&
              req.method == 'POST'
            if (submit && cut++ == 0) {
              throw new Error(
                'Durable Object reset because a newer deploy reached it: b',
              )
            }
            return answer
          },
        } as typeof store
      },
    }
  })
  try {
    let owner = await signIn(k), agent = connector(k, owner.cookie)
    let host = `${owner.email.split('@')[0]}.${k.host}`
    await agent.answer('app_new', { slug: 'club', title: 'Club' })
    let form = crypto.randomUUID()
    await agent.tool('graph_apply', {
      app: 'club',
      entities: [{
        entity: { eid: form },
        alias: { name: 'contact' },
        form: {},
      }],
    })
    let sent = await k.at(host, '/club/api/form/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers: {} }),
    })
    let filed = (await agent.answer('graph_query', {
      app: 'club',
      query: `.registration.form=${form}`,
    })).rows
    equal([sent.status, cut, filed.length], [204, 2, 1])
  } finally {
    await k.stop()
  }
})

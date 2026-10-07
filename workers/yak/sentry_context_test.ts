// Creating a wrapped object cannot replace the gateway's active reporter scope.
import { equal, test } from '@yaks/testing'
import {
  createTransport,
  type ErrorEvent,
  getAsyncContextStrategy,
  getCurrentScope,
  getMainCarrier,
  Scope,
  ServerRuntimeClient,
  setAsyncContextStrategy,
  withScope,
} from '@sentry/core'
import { defect, options } from './sentry.ts'

test('object instrumentation retains the caller scope and its reporting client', async () => {
  let carrier = getAsyncContextStrategy(getMainCarrier())
  options()
  let seen: ErrorEvent[] = []
  let client = new ServerRuntimeClient({
    dsn: 'https://key@example.ingest.sentry.io/1',
    integrations: [],
    stackParser: () => [],
    transport: (o) => createTransport(o, () => Promise.resolve({})),
    beforeSend: (event) => {
      seen.push(event)
      return null
    },
  })
  client.init()
  try {
    withScope((caller) => {
      caller.setClient(client)
      caller.setTag('request_id', 'gateway-request')
      // A newly constructed SDK wrapper installs another carrier before it
      // asks for options. That carrier has none of this invocation's state.
      setAsyncContextStrategy({
        ...carrier,
        getCurrentScope: () => new Scope(),
      })
      options()
      equal(getCurrentScope(), caller)
      defect(Error('caught after object wake'), { request: 'gateway' })
    })
    await client.flush(1000)
    equal(seen.length, 1)
    equal(seen[0].tags, { request_id: 'gateway-request', request: 'gateway' })
    equal(seen[0].exception?.values?.[0].value, 'caught after object wake')
  } finally {
    setAsyncContextStrategy(carrier)
  }
})

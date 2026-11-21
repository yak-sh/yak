import { equal, test } from '@yaks/testing'
import { endpoints } from './endpoints.ts'

let outside = new Request('https://external.invalid/')
let app = new Request('https://app.invalid/')
let reply = new Response(null)

test('in-process endpoints share their caller transport and restore it after cleanup', async () => {
  let sent: string[] = [], routed: string[] = []
  let host = {
    fetch: (() => {
      throw Error('stale transport')
    }) as typeof fetch,
  }
  let { open: endpoint, at } = endpoints(host)
  let transport: typeof fetch = (input) => {
    sent.push(new Request(input).url)
    return Promise.resolve(reply)
  }
  host.fetch = transport
  let a = endpoint((request) => {
    routed.push(`first ${request.url}`)
    return reply
  })
  let b = endpoint((request) => {
    routed.push(`second ${request.url}`)
    return reply
  })
  await host.fetch(a.url)
  await host.fetch(b.url)
  await host.fetch(outside)
  await at(a.url, app)
  await a.stop()
  await host.fetch(b.url)
  await b.stop()
  equal(routed, [
    `first ${a.url}/`,
    `second ${b.url}/`,
    'first https://app.invalid/',
    `second ${b.url}/`,
  ])
  equal(sent, ['https://external.invalid/'])
  equal(host.fetch, transport)
})

test('two endpoints over one host never route through each other', async () => {
  let sent: string[] = []
  let transport: typeof fetch = (input) => {
    sent.push(new Request(input).url)
    return Promise.resolve(reply)
  }
  let host = { fetch: transport }
  let first = endpoints(host), second = endpoints(host)
  let a = first.open(() => reply)
  let b = second.open(() => reply)
  await a.stop()
  await b.stop()
  let c = first.open(() => reply)
  await host.fetch(outside)
  await c.stop()
  equal(sent, ['https://external.invalid/'])
  equal(host.fetch, transport)
})

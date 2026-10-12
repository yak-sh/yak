// The Worker is a fetch double: it pages its bugs by eid and records marks.
import { equal, test, until } from '@yaks/testing'
import { poll } from './poll.ts'

let worker = (count: number) => {
  let bugs = Array.from({ length: count }, (_, i) => ({
    entity: { eid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` },
    bug: { fault: `f${i}` },
  }))
  let marks: string[] = []
  let go = ((input: URL | Request | string, init?: RequestInit) => {
    let url = new URL(String(input))
    if (url.pathname.endsWith('/bugs')) {
      let q = url.searchParams.get('query') ?? ''
      let after = q.match(/\.after=(\S+)/)?.[1] ?? ''
      let limit = Number(url.searchParams.get('limit'))
      return Promise.resolve(Response.json(
        bugs.filter((b) => b.entity.eid > after).slice(0, limit),
      ))
    }
    marks.push(`${url.pathname.split('/').pop()} ${init?.body}`)
    return Promise.resolve(Response.json({ ok: true }))
  }) as typeof fetch
  return { go, marks }
}
let remote = { url: 'https://tracker.example', secret: 'test' }

test('a poll answers every page of the platform tracker, and marks reach it', async () => {
  let { go, marks } = worker(230)
  let polled = poll(remote, '.bug', { go })
  await until(() => polled.ready)
  equal(polled.value.length, 230)
  await polled.mutate([
    { entity: { eid: 'a' }, resolved: {} },
    { entity: { eid: 'b' }, archived: {} },
    { entity: { eid: 'c' }, doc: { title: 'no mark' } },
  ])
  equal(marks, ['resolve {"bug":"a"}', 'archive {"bug":"b"}'])
  polled.close()
})

test('a failed poll is reported and leaves the answer not ready', async () => {
  let failures: unknown[] = []
  let polled = poll(remote, '.bug', {
    go: (() =>
      Promise.resolve(new Response('', { status: 500 }))) as typeof fetch,
    report: (error) =>
      failures.push(error),
  })
  await until(() => failures.length > 0)
  equal(polled.ready, false)
  polled.close()
})

test('a poll that hangs settles as failed', async () => {
  let failures: unknown[] = []
  let polled = poll(remote, '.bug', {
    timeout: 5,
    go: ((_: unknown, init?: RequestInit) =>
      new Promise((_, fail) =>
        init?.signal?.addEventListener('abort', () =>
          fail(init.signal!.reason))
      )) as typeof fetch,
    report: (error) =>
      failures.push(error),
  })
  let heard = 0
  polled.subscribe(() => heard++)
  await until(() => heard > 0)
  equal([polled.ready, failures.length], [false, 1])
  polled.close()
})

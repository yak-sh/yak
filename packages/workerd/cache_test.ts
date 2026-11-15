import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { purging, through } from './cache.ts'

let asked = () => new Request('https://files.invalid/a/style.css')
let local = () => Promise.resolve(new Response('in-process'))
let cache = (answer: () => Response) => ({
  fetch: () => Promise.resolve().then(answer),
})
let said = async (res: Response) => [res.status, await res.text()]

test('the cache answers what it can, and the process the rest', async () => {
  let failed: number[] = []
  let heard = { failed: (res: Response) => failed.push(res.status) }
  let clone = () => {
    throw Object.assign(new Error('no'), { name: 'DataCloneError' })
  }
  let cases: [ReturnType<typeof cache> | undefined, (string | number)[]][] = [
    [undefined, [200, 'in-process']],
    [cache(() => new Response('kept')), [200, 'kept']],
    [cache(() => new Response('gone', { status: 404 })), [404, 'gone']],
    [cache(() => new Response(null, { status: 522 })), [200, 'in-process']],
    [cache(clone), [200, 'in-process']],
  ]
  for (let [bound, want] of cases) {
    assertEquals(await said(await through(bound, asked(), local, heard)), want)
  }
  assertEquals(failed, [522])
})

test('a failure the cache cannot be read around is thrown', async () => {
  let broken = cache(() => {
    throw new TypeError('bad')
  })
  await assertRejects(() => through(broken, asked(), local), TypeError)
})

test('an entrypoint purges through its lent cache, and with none refuses', async () => {
  let sent: string[][] = []
  let lent = {
    purge: ({ tags }: { tags: string[] }) => {
      sent.push(tags)
      return Promise.resolve({ success: true, errors: [] })
    },
  }
  assertEquals(await purging(lent)(['app:a']), { success: true, errors: [] })
  assertEquals(sent, [['app:a']])
  assertEquals((await purging()(['app:a'])).success, false)
})

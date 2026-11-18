import { equal, test } from '@yaks/testing'
import type { Enrich } from '@yaks/tracker'
import { trackerOptions } from './tracker.ts'

let code = {
  cwd: '/checkout',
  url: 'https://catalog.test',
  origins: ['https://app.test'],
}

test('local tracker configuration lends frame enrichment and checkout commit lookup', async () => {
  let sources: unknown[] = [], commits: string[][] = []
  let options = trackerOptions(
    { code },
    (options) => {
      sources.push(options)
      return (frames) =>
        Promise.resolve(frames.map((f) => ({ ...f, app: true })))
    },
    (cwd, sha) => (commits.push([cwd, sha]), Promise.resolve(['full-sha'])),
  ) as { enrich: Enrich; commits: (sha: string) => Promise<string[]> }
  let row = await options.enrich({
    entity: { eid: 'error' },
    exception: { stack: 'Error: broken\n at fail (https://app.test/a.ts:2:3)' },
  })
  equal(row.exception, {
    stack: 'Error: broken\n at fail (https://app.test/a.ts:2:3)',
    frames: [{
      file: 'https://app.test/a.ts',
      line: 2,
      column: 3,
      function: 'fail',
      app: true,
    }],
  })
  equal(await options.commits('short-sha'), ['full-sha'])
  equal(sources, [code])
  equal(commits, [['/checkout', 'short-sha']])
})

test('local tracker options preserve supplied capabilities and need no checkout', () => {
  let enrich: Enrich = (row) => Promise.resolve(row)
  let commits = () => Promise.resolve(['supplied'])
  let supplied = { code, enrich, commits }
  let unexpected = () => {
    throw Error('supplied enrichment must be kept')
  }
  equal(trackerOptions(supplied, unexpected), supplied)
  equal(trackerOptions({ enrich }), { enrich })
})

test('lending tracker capabilities keeps configured values live', () => {
  let token = 'first'
  let options = trackerOptions({
    code: { cwd: '/checkout' },
    get token() {
      return token
    },
  })
  token = 'second'
  equal(options.token, 'second')
})

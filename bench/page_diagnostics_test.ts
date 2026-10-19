import { equal, ok, test } from '@yaks/testing'
import { failedPage, requestTrail } from './page_diagnostics.ts'

test('failed-paint request metadata is bounded and strips private URL values', () => {
  let trail = requestTrail()
  for (let i = 0; i < 40; i++) {
    trail.seen({
      url: `https://user:password@host.test/r${i}?token=secret#private`,
      method: 'GET',
    }, true)
  }
  let requests = trail.snapshot()
  equal(requests.length, 32)
  equal(requests[0].path, 'https://host.test/r8')
  ok(!JSON.stringify(requests).includes('secret'))
  ok(!JSON.stringify(requests).includes('password'))
  requests[0].path = 'changed'
  equal(trail.snapshot()[0].path, 'https://host.test/r8')
  trail.seen({ url: 'broken URL', method: 'POST' }, false)
  equal(trail.snapshot().at(-1), {
    path: '(unknown URL)',
    method: 'POST',
    allowed: false,
  })
  trail.seen({ url: 'data:text/plain,private', method: 'GET' }, true)
  equal(trail.snapshot().at(-1)?.path, '(data: resource)')
  trail.reset()
  equal(trail.snapshot(), [])
})

test('paint-failure diagnostics distinguish attempted requests from completed resources', () => {
  let evaluate = new Function(
    'document',
    'performance',
    'location',
    `return ${failedPage}`,
  )
  let page = JSON.parse(evaluate({
    body: { innerText: 'Awaiting anatomy…' },
    readyState: 'complete',
  }, {
    getEntriesByType: (type: string) =>
      type == 'navigation'
        ? [{
          startTime: 0,
          responseEnd: 5,
          domContentLoadedEventEnd: 12,
          loadEventEnd: 14,
          responseStatus: 200,
        }]
        : [{
          name: 'https://user:secret@host.test/visualize/app.js?token=private',
          initiatorType: 'script',
          startTime: 5,
          responseEnd: 8,
          duration: 3,
          responseStatus: 503,
        }],
  }, { href: 'https://host.test/visualize' }))
  equal(page.body, 'Awaiting anatomy…')
  equal(page.readyState, 'complete')
  equal(page.navigation[0].status, 200)
  equal(page.resources, [{
    path: 'https://host.test/visualize/app.js',
    kind: 'script',
    start: 5,
    end: 8,
    duration: 3,
    status: 503,
  }])
  ok(!JSON.stringify(page).includes('private'))
})

import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { apiPath, type Hosting } from './hosting.ts'
import { pagePath, queryPath, stackOf, stackPath } from './where.ts'
import { follow } from './state.ts'
import { panesOf } from '@yaks/ux'

test('mounted inspector links and stacks stay over the app store', () => {
  let global = globalThis as { YAK_INSPECT?: Hosting }
  let prior = global.YAK_INSPECT
  global.YAK_INSPECT = { page: '/notes/_web/inspect', api: '/notes/api' }
  try {
    assertEquals(apiPath('/vocab'), '/notes/api/vocab')
    assertEquals(apiPath('/query?q=.doc'), '/notes/api/query?q=.doc')
    assertEquals(queryPath(), '/notes/_web/inspect')
    assertEquals(pagePath('D-9'), '/notes/_web/inspect/D-9')
    let panes = ['q=', 'q=.doc&.count', 'a b/c#d']
    assertEquals(stackOf(stackPath(panes)), panes)
    assertEquals(stackOf('https://ada.yaks.app' + stackPath(panes)), panes)
    assertEquals(stackOf('/other/_web/inspect/D-9'), undefined)
    assertEquals(stackOf('/inspect/D-9'), undefined)
    assertEquals(
      panesOf(
        follow(
          { entity: { eid: 's' }, Stack: { panes: ['q='] } },
          pagePath('D-9'),
        ),
      ),
      ['q=', 'D-9'],
    )
  } finally {
    global.YAK_INSPECT = prior
  }
  assertEquals(queryPath(), '/inspect')
  assertEquals(apiPath('/vocab'), '/vocab')
})

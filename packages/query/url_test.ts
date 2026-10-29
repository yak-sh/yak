// Human query addresses round-trip clauses and independently named page state.
import { equal, test } from '@yaks/testing'
import { parse, queryAt, queryRedirect, querySearch } from './mod.ts'

let day = '.result&.result.call.call.to.tool.name=Bash&.created.at=2026-10-27'
test('query URLs carry the clauses themselves and separate page state', () => {
  equal(querySearch(day), '?' + day)
  let search = querySearch(
    day + '&.created.at>=2026-10-27&.created.at<2026-10-28',
    {
      side: 'yaks.app',
      bug: 'b&=+#%',
    },
  )
  let read = queryAt(new URL('https://tasks.test/' + search).search)
  equal(read.query, day + '&.created.at>=2026-10-27&.created.at<2026-10-28')
  equal([...read.state], [['side', 'yaks.app'], ['bug', 'b&=+#%']])
  equal(read.legacy, false)
})

for (
  let line of [
    '.doc.title="a&@side=b"&?doc',
    '.doc.title="100% + # café 🦬"&!task',
    '.doc.title="say \\"hi&bye\\""&.limit=3',
    '.doc.title=a+b&.created.at>2026-10-27',
  ]
) {
  test(`query URL preserves values: ${line}`, () => {
    let got = queryAt(new URL('https://tasks.test/' + querySearch(line)).search)
    equal(got.query, line)
    equal(parse(got.query!), parse(line))
  })
}

test('kept query URLs redirect with page state and fragments', () => {
  let old = new URL(
    'https://tasks.test/?q=' + encodeURIComponent(day) +
      '&side=yaks.app&bug=b#occurrence',
  )
  equal(queryRedirect(old), '/?' + day + '&side=yaks.app&bug=b#occurrence')
  equal(queryRedirect(new URL('https://tasks.test/?' + day)), undefined)
  equal(queryAt('?q=two+words').query, 'two words')
  equal(queryAt('?two+words').query, null)
})

test('direct addresses tolerate an unescaped percent sign as browser URLs do', () => {
  equal(queryAt('?100%').query, null)
  equal(
    queryAt('?.doc.title=100%&.doc.body=%23').query,
    '.doc.title=100%&.doc.body=#',
  )
})

for (
  let line of [
    'two words',
    'two&words',
    '.task&cake',
    'task.status=open',
    '(.task|.bug)&cake',
    '.task&.doc.title="x&y"&cake',
  ]
) {
  test(`query URL preserves full-text terms: ${line}`, () => {
    equal(queryAt(querySearch(line)).query, line)
    equal(parse(queryAt(querySearch(line)).query!), parse(line))
  })
}

test('only grammar sigils select query parameters', () => {
  equal(
    queryAt('?.bug&!task&?doc&*&+doc&-task&$x&%23Actor&side=box&words').query,
    '.bug&!task&?doc&*&+doc&-task&$x&#Actor',
  )
  equal(queryAt('?side=box&bug=b&page=spend').query, null)
  equal(queryAt('?.bug&@side=box&@bug=b').query, '.bug')
  equal([...queryAt('?.bug&@side=box&@bug=b').state], [])
  equal(
    queryRedirect(new URL('https://tasks.test/?q=.bug&@side=box&@bug=b')),
    '/?.bug',
  )
  equal(querySearch('.bug', { side: 'box', '@side': 'old' }), '?.bug&side=box')
  equal(queryAt('?%2Ebug&%21task&%3Fdoc').query, '.bug&!task&?doc')
})

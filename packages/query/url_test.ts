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
  equal(queryRedirect(old), '/?' + day + '&@side=yaks.app&@bug=b#occurrence')
  equal(queryRedirect(new URL('https://tasks.test/?' + day)), undefined)
  equal(queryAt('?q=two+words').query, 'two words')
  equal(queryAt('?two+words').query, 'two+words')
})

test('direct addresses tolerate an unescaped percent sign as browser URLs do', () => {
  equal(queryAt('?100%').query, '100%')
  equal(
    queryAt('?.doc.title=100%&.doc.body=%23').query,
    '.doc.title=100%&.doc.body=#',
  )
})

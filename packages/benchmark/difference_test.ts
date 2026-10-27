import { equal, test } from '@yaks/testing'
import { difference } from './difference.ts'

test('between-sitting variation is not a slowdown, while a persistent small shift is', () => {
  let reference = [100, 130, 110, 120, 115, 125]
  equal(difference(reference, [...reference].reverse()).verdict, 'unconfirmed')
  // A wide historical range alone must not hide a repeatable shift.
  equal(
    difference([100, 101, 102, 103, 104, 130], [106, 107, 108, 109, 110, 136])
      .verdict,
    'slower',
  )
  equal(difference([100, 101, 102], [99, 98, 97]).verdict, 'unconfirmed')
  equal(difference([100, 101, 102], [99, 98, 97], 'higher').verdict, 'slower')
  equal(difference([100], [200, 201, 202]).verdict, 'inconclusive')
})

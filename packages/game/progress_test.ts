import { equal, test } from '@yaks/testing'
import { maxHp, need, power } from './progress.ts'

test('earned experience and combat scaling retain their level curve', () => {
  equal([need(1), need(2), need(10)], [0, 80, 15605])
  equal([maxHp(1), maxHp(60)], [52, 288])
  equal([power(1), power(10, 2)], [5.5, 20])
})

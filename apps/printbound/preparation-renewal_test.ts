import { equal, test, throws } from '@yaks/testing'
import { renewed } from './preparation-renewal.ts'

test('resumption accepts a refreshed ticket for the same immutable artifact', () => {
  let old = 'https://source.yaks.app/app/api/pay/artifacts/abc?ticket=old'
  let next = 'https://source.yaks.app/app/api/pay/artifacts/abc?ticket=new'
  equal(renewed(old, next), next)
  equal(renewed(old, undefined), old)
})

test('resumption refuses changed content, host or non-ticket parameters', () => {
  let old = 'https://source.yaks.app/app/api/pay/artifacts/abc?ticket=old'
  for (
    let next of [
      'https://source.yaks.app/app/api/pay/artifacts/other?ticket=new',
      'https://other.yaks.app/app/api/pay/artifacts/abc?ticket=new',
      old + '&buyer=other',
      'https://source.yaks.app/app/api/pay/artifacts/abc',
    ]
  ) {
    throws(() => renewed(old, next))
  }
})

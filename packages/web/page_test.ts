// The page carries the tracker's reporter first in its head.
import { equal, test } from '@yaks/testing'
import { page } from './page.ts'

test('the page opens its head with the reporter', async () => {
  let made = await page()
  equal(made.includes('<head><script data-yak-at="/">'), true)
  equal(made.includes('api/report'), true)
})

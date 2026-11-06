// The page carries the tracker's reporter first in its head, and a checkout,
// which ships nothing made ahead, makes it from its files.
import { equal, test } from '@yaks/testing'
import { drawn, page } from './page.ts'

test('the page opens its head with the reporter, made from a checkout', async () => {
  let made = await page()
  equal(made.includes('<head><script data-yak-at="/">'), true)
  equal(made.includes('api/report'), true)
  equal(made, await drawn())
})

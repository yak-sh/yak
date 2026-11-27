// Someone's markdown, drawn on a platform page: links are theirs, and nothing
// they write runs or loads.
import { equal, test } from '@yaks/testing'
import { parseHTML } from 'linkedom'
import { drawn } from './theirs.ts'

// Loaded with the file, so the case times only the drawing.
await drawn('warm')

test('someone’s markdown is drawn with its links marked theirs, and nothing of it runs', async () => {
  let html = await drawn(
    'Sign up at [api.esv.org](https://api.esv.org). <script>x()</script> [x](javascript:x)',
  )
  let { document } = parseHTML(html)
  let links = [...document.querySelectorAll('.Body_Paragraph .Body_Link')]
  equal(
    links.map((link) => [
      link.getAttribute('href'),
      link.getAttribute('target'),
      link.getAttribute('rel'),
    ]),
    [
      ['https://api.esv.org', '_blank', 'noopener nofollow ugc'],
      [null, null, 'nofollow ugc'],
    ],
  )
  equal(document.querySelector('script'), null)
  equal(
    document.querySelector('.Body_Paragraph')?.textContent,
    'Sign up at api.esv.org. <script>x()</script> x',
  )
  equal(await drawn(' '), '')
})

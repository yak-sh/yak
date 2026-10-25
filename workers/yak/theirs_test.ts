// Someone's markdown, drawn on a platform page: links are theirs, and nothing
// they write runs or loads.
import { equal, test } from '@yaks/testing'
import { drawn } from './theirs.ts'

// Loaded with the file, so the case times only the drawing.
await drawn('warm')

test('someone’s markdown is drawn with its links marked theirs, and nothing of it runs', async () => {
  equal(
    await drawn(
      'Sign up at [api.esv.org](https://api.esv.org). <script>x()</script> [x](javascript:x)',
    ),
    '<div class="Markdown" wrap="1"><p>Sign up at <a href="https://api.esv.org" rel="nofollow ugc">api.esv.org</a>. &lt;script>x()&lt;/script> <a rel="nofollow ugc">x</a></p></div>',
  )
  equal(await drawn(' '), '')
})

// No import of ./html-rewriter.ts: the runtime stands it before any file
// loads, as a Worker's does, whatever an earlier file's tests did.
import { equal, test } from '@yaks/testing'

// The runtime's rewriter, the slice this file asks for (apps.ts says why).
type Rewriter = {
  on(
    selector: string,
    handlers: {
      element(el: { setAttribute(n: string, v: string): void }): void
    },
  ): Rewriter
  transform(res: Response): Response
}
declare let HTMLRewriter: { new (): Rewriter }

test('every test runtime rewrites HTML as a Worker does, leaving untouched bytes as they came', async () => {
  let page = new Response('<!DOCTYPE html><P class=a>hi</P>')
  let rewritten = new HTMLRewriter()
    .on('p', { element: (el) => el.setAttribute('class', 'b') })
    .transform(page)
  equal(await rewritten.text(), '<!DOCTYPE html><P class="b">hi</P>')
})

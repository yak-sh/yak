import { assertEquals } from '@std/assert'
import { place } from './overlay.tsx'

// Overlay placement is viewport geometry. The tiny element double keeps that
// seam fast and leaves component lifecycle to the browser probe.
let el = (h: number) => ({
  offsetWidth: 340,
  offsetHeight: h,
  style: { left: '', top: '' },
})

let put = (side: 'above' | 'below', h: number) => {
  let node = el(h)
  place(
    node as unknown as HTMLElement,
    new DOMRect(492, 392, 16, 16),
    side,
  )
  return node.style
}

Deno.test('a growing overlay stays inside the viewport', () => {
  Object.defineProperties(globalThis, {
    innerWidth: { value: 1000, configurable: true },
    innerHeight: { value: 800, configurable: true },
  })

  assertEquals(put('above', 120), { left: '330px', top: '268px' })
  assertEquals(put('above', 480), { left: '330px', top: '6px' })
  assertEquals(put('below', 480), { left: '330px', top: '314px' })
})

import { assert, assertEquals } from '@std/assert'
import { graphics } from './graphics.ts'
import type { Line } from './paint.ts'
import type { ImageSource } from './Image.ts'

let png = () => {
  let bytes = new Uint8Array(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
  new DataView(bytes.buffer).setUint32(16, 1)
  new DataView(bytes.buffer).setUint32(20, 1)
  return bytes
}
let lines = (source: ImageSource): Line[] =>
  Array.from({ length: 3 }, (_, row) => [{
    text: '    ',
    style: {},
    image: { source, row, rows: 3, width: 4 },
  }])
let settle = () => new Promise((resolve) => setTimeout(resolve, 0))
Deno.test('graphics loads only full visible blocks, uploads once, removes placements and frees data', async () => {
  let loads = 0, paints = 0
  let source = {
    key: 'one',
    rows: 3,
    alt: 'image',
    load: () => {
      loads++
      return Promise.resolve(png())
    },
  }
  let g = graphics({ enabled: true, changed: () => paints++ })
  assertEquals(g.draw(lines(source).slice(1)), '')
  assertEquals(loads, 0)
  assertEquals(g.draw(lines(source)), '')
  await settle()
  let first = g.draw(lines(source))
  assert(first.includes('a=t,f=100'))
  assert(first.includes('a=p,i=1,c=4,r=3'))
  assertEquals(loads, 1)
  assertEquals(paints, 1)
  assertEquals(g.draw(lines(source)), '')
  let redraw = g.draw(lines(source), true)
  assert(!redraw.includes('a=t'))
  assert(redraw.includes('a=d,d=i'))
  assert(g.draw([]).includes('a=d,d=i'))
  assert(!g.draw(lines(source)).includes('a=t'))
  g.reset()
  assert(g.draw(lines(source)).includes('a=p'))
  assert(g.close().includes('a=d,d=I'))
  assertEquals(g.draw(lines(source)), '')
})
Deno.test('disabled graphics never loads; invalid PNG stays fallback; tmux transport escapes APC', async () => {
  let source = {
    key: 'one',
    rows: 3,
    alt: 'image',
    load: () => Promise.resolve(png()),
  }
  let off = graphics({
    enabled: false,
    changed: () => {
      throw Error('unexpected')
    },
  })
  assertEquals(off.draw(lines(source)), '')
  let tmux = graphics({ enabled: true, tmux: true, changed: () => {} })
  tmux.draw(lines(source))
  await settle()
  assert(tmux.draw(lines(source)).includes('\x1bPtmux;\x1b\x1b_G'))
  tmux.close()
  let bad = graphics({ enabled: true, changed: () => {} })
  bad.draw(
    lines({ ...source, load: () => Promise.resolve(new Uint8Array(30)) }),
  )
  await settle()
  assertEquals(bad.draw(lines(source)), '')
  bad.close()
})

Deno.test('pure Image layout reserves rows and backend never resends bytes on warm paint', async () => {
  const { h, render } = await import('preact')
  const { Image } = await import('./Image.ts')
  const { install, onPaint } = await import('./dom.ts')
  const { ansiBackend } = await import('./paint.ts')
  let screen = install(), output: string[] = [], loads = 0
  onPaint(() => {})
  let backend = ansiBackend({
    graphics: 'kitty',
    size: () => ({ columns: 12, rows: 6 }),
    write: (s) => output.push(s),
  })
  try {
    render(
      h(Image, {
        source: {
          key: 'test',
          rows: 3,
          alt: 'test image',
          load: () => {
            loads++
            return Promise.resolve(png())
          },
        },
      }),
      screen.root as unknown as Element,
    )
    backend.draw(screen.root)
    await settle()
    backend.draw(screen.root)
    assert(output.join('').includes('a=t,f=100'))
    assertEquals(loads, 1)
    output.length = 0
    backend.draw(screen.root)
    assertEquals(output, [])
    render(null, screen.root as unknown as Element)
    backend.draw(screen.root)
    assert(output.join('').includes('a=d,d=i'))
    backend.stop()
    assert(output.join('').includes('a=d,d=I'))
  } finally {
    render(null, screen.root as unknown as Element)
    screen.free()
  }
})

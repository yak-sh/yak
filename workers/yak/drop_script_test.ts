// The drop zone's one listener (public/drop.js), acted on as a person would:
// files dragged over and let go, a choice, a removal.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parseHTML } from 'linkedom'
import { renderToString } from 'preact-render-to-string'
import { fileDrop } from './html.ts'

let code = await Deno.readTextFile(
  new URL('./public/drop.js', import.meta.url),
)

// What a browser's DataTransfer holds of it: files in, a list out.
class Held {
  list: File[] = []
  items = { add: (f: File) => this.list.push(f) }
  get files() {
    return this.list
  }
}

let page = (multiple = true) => {
  let { document, window } = parseHTML(
    `<!doctype html><html><body><form>${
      renderToString(fileDrop({ name: 'file', label: 'Files', multiple }))
    }</form><p id="away"></p></body></html>`,
  )
  let on: Record<string, (e: unknown) => void> = {}
  new Function(
    'document',
    'addEventListener',
    'DataTransfer',
    'Event',
    'URL',
    code,
  )(
    document,
    (type: string, fn: (e: unknown) => void) => on[type] = fn,
    Held,
    window.Event,
    { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  )
  let input = document.querySelector('.Drop_File') as HTMLInputElement
  let zone = document.querySelector('.Drop_Zone')!
  let files: File[] = []
  // What linkedom's input does not reflect.
  Object.defineProperties(input, {
    files: { get: () => files, set: (v) => files = v },
    multiple: { get: () => input.hasAttribute('multiple') },
  })
  input.addEventListener('change', (e) => on.change(e))
  let carrying = (list: File[]) => ({
    target: zone,
    preventDefault() {},
    dataTransfer: { types: ['Files'], files: list, dropEffect: '' },
  })
  return {
    files: () => files.map((f) => f.name),
    over: () => on.dragover(carrying([])),
    lit: () => zone.classList.contains('Drop_Zone-over'),
    drop: (...names: string[]) =>
      on.drop(carrying(names.map((n) =>
        new File(['abc'], n, {
          type: n.endsWith('.png') ? 'image/png' : 'text/plain',
        })
      ))),
    shown: () =>
      [...document.querySelectorAll('.Drop_Item')].map((li) =>
        [
          li.querySelector('img') ? 'picture' : '',
          li.querySelector('.Drop_Name')!.textContent,
          li.querySelector('.Drop_Size')!.textContent,
        ].filter(Boolean).join(' ')
      ),
    remove: (i: number) =>
      (document.querySelectorAll('.Drop_Item button')[i] as HTMLElement)
        .click(),
  }
}

test('files over the zone light it, and letting go lights it no more', () => {
  let p = page()
  p.over()
  assertEquals(p.lit(), true)
  p.drop('a.txt')
  assertEquals(p.lit(), false)
})

test('a drop chooses its files and shows each, a picture as a picture', () => {
  let p = page()
  p.drop('notes.txt', 'cat.png')
  assertEquals(p.files(), ['notes.txt', 'cat.png'])
  assertEquals(p.shown(), ['notes.txt 3 B', 'picture cat.png 3 B'])
})

test('a zone for one file takes the first of a drop', () => {
  let p = page(false)
  p.drop('site.zip', 'other.zip')
  assertEquals(p.files(), ['site.zip'])
})

test('removing a file takes it out of what the form sends', () => {
  let p = page()
  p.drop('a.txt', 'b.txt', 'c.txt')
  p.remove(1)
  assertEquals(p.files(), ['a.txt', 'c.txt'])
  assertEquals(p.shown(), ['a.txt 3 B', 'c.txt 3 B'])
})

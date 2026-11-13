// The site's pages as drawn from the home app's copy, and as a served page is
// filled from a release of it (page-copy.ts): the two agree, so a snippet
// changed on the page is what a visitor reads.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { parse, set } from '@yaks/copy'
import { parseHTML } from 'linkedom'
import '../binding-probe.ts'
import { type Copy, filled } from '../page-copy.ts'
import { COPY } from './copy.ts'
import { page, PAGES } from './mod.ts'

let committed = await Deno.readTextFile(
  new URL('../../../apps/home/copy.json', import.meta.url),
)
// A page as a browser reads it: the rewriter writes a tag it touched its own
// way (`<meta … />`), which is the same element.
let dom = (html: string) => parseHTML(html).document.toString()
let served = async (name: string, copy: Copy) =>
  dom(await filled(new Response(page(name)), copy).text())

test('every page, filled from the copy it was drawn from, is as drawn', async () => {
  for (let name of Object.keys(PAGES)) {
    assertEquals(await served(name, COPY), dom(page(name)), name)
  }
})

test('a snippet changed in the copy is what the served page says', async () => {
  let copy = parse(set(committed, {
    'home.hello.title': 'Ask for an app',
    'home.cost.note': 'Your space is %{yours}, and it is free.',
    'home.description': 'Apps, built by asking.',
    'frame.nav.pricing': 'Plans',
  }))
  let { document } = parseHTML(await served('index.html', copy))
  let at = (selector: string) => document.querySelector(selector)!
  assertEquals(at('#hello label').textContent, 'Ask for an app')
  let note = at('[data-copy="home.cost.note"]')
  assertEquals(
    note.textContent,
    'Your space is yourname.yaks.app, and it is free.',
  )
  assertEquals(note.querySelector('.Address_Name')?.textContent, 'yourname')
  assertEquals(
    at('meta[name="description"]').getAttribute('content'),
    'Apps, built by asking.',
  )
  assertEquals(at('.Nav a[href="/pricing"]').textContent, 'Plans')
})

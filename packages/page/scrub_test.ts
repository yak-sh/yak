import { assert, assertEquals } from '@std/assert'
import { scrub } from './scrub.ts'

// The whole test: nothing an archive renders may reach the network. One page
// carrying every way an HTML document knows how to ask for a byte.
let page = `<!doctype html><html><head>
<title>  A Page  </title>
<link rel=stylesheet href="https://cdn.example/s.css">
<link rel=icon href="data:image/gif;base64,R0lGOD">
<meta http-equiv=refresh content="0;url=https://elsewhere/">
<style>body { background: url(https://cdn.example/bg.png) }</style>
</head><body>
<script>fetch('https://elsewhere/beacon')</script>
<iframe src="https://elsewhere/frame"></iframe>
<img src="https://cdn.example/x.png" srcset="https://cdn.example/x@2x.png 2x">
<img src="data:image/gif;base64,R0lGOD">
<a href="https://a.com/somewhere">out</a>
<a href="#inside">in</a>
<p onclick="fetch('https://elsewhere/click')" style="background:url(https://cdn.example/p.png)">hi</p>
<form action="https://elsewhere/post"><button formaction="https://elsewhere/go">x</button></form>
<svg><use xlink:href="https://cdn.example/i.svg#x"/></svg>
</body></html>`

Deno.test('a frozen page renders from its own bytes', () => {
  let { html } = scrub(page)
  // Nothing addresses anything outside these bytes.
  assert(!/https?:\/\//i.test(html), html)
  assert(!/<script|<iframe|<base|<embed|<object/i.test(html), html)
  assert(!/onclick/i.test(html), html)
  assert(!/http-equiv/i.test(html), html)
  // What carries no fetch stays: inline content, the document's own anchors,
  // the text, and the emptied css.
  assert(html.includes('data:image/gif;base64,R0lGOD'), html)
  assert(html.includes('href="#inside"'), html)
  assert(html.includes('hi'), html)
  assert(html.includes('url()'), html)
})

Deno.test('the archive says what the page called itself', () => {
  assertEquals(scrub(page).title, 'A Page')
  assertEquals(scrub('<p>no title</p>').title, undefined)
  assertEquals(scrub('<title>  </title>').title, undefined)
})

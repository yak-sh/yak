import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import './binding-probe.ts'
import { type Copy, filled } from './page-copy.ts'

let copy: Copy = {
  hero: { title: 'Build, host & share <web> apps', kicker: '100% %%{yours}' },
  cost: {
    limits: 'Tax is included. %{plans}.',
    plans: 'Compare plans',
    swap: '%{b} then %{a}',
    twice: '%{a} or %{a}',
    gone: 'No link now.',
  },
  search: { hint: 'Find a "recipe"' },
  page: { about: 'Dinner, kept' },
  pic: 'Look: %{img} there',
}

let fills = (html: string) => filled(new Response(html), copy).text()

let cases: [string, string, string][] = [
  [
    'a snippet replaces what the element held',
    '<h1 data-copy="hero.title">Old <b>words</b></h1>',
    '<h1 data-copy="hero.title">Build, host &amp; share &lt;web&gt; apps</h1>',
  ],
  [
    'an escaped slot is text',
    '<p data-copy="hero.kicker"></p>',
    '<p data-copy="hero.kicker">100% %{yours}</p>',
  ],
  [
    'a key the file lacks leaves the element as written',
    '<p data-copy="hero.missing">As <i>written</i></p>',
    '<p data-copy="hero.missing">As <i>written</i></p>',
  ],
  [
    'an attribute takes its snippet',
    '<input data-copy-placeholder="search.hint" placeholder="old">' +
    '<meta name="description" data-copy-content="page.about">',
    '<input data-copy-placeholder="search.hint" placeholder="Find a &quot;recipe&quot;">' +
    '<meta name="description" data-copy-content="page.about" content="Dinner, kept">',
  ],
  [
    'a slot keeps its child, which fills its own snippet',
    '<p data-copy="cost.limits">Old text <a href="/pricing" data-copy-slot="plans" data-copy="cost.plans">old</a> more</p>',
    '<p data-copy="cost.limits">Tax is included. <a href="/pricing" data-copy-slot="plans" data-copy="cost.plans">Compare plans</a>.</p>',
  ],
  [
    'what fills no slot goes',
    '<p data-copy="cost.limits"><svg><path d="M0"/></svg><br><a data-copy-slot="plans">x</a><em>y</em></p>',
    '<p data-copy="cost.limits">Tax is included. <a data-copy-slot="plans">x</a>.</p>',
  ],
  [
    'a void element fills a slot',
    '<p data-copy="pic"><img data-copy-slot="img" src="a.png"></p>',
    '<p data-copy="pic">Look: <img data-copy-slot="img" src="a.png"> there</p>',
  ],
  [
    'a slot passed over by a later one shows by name',
    '<p data-copy="cost.swap"><i data-copy-slot="a">A</i><i data-copy-slot="b">B</i></p>',
    '<p data-copy="cost.swap">%{b} then <i data-copy-slot="a">A</i></p>',
  ],
  [
    'a slot named twice is filled once',
    '<p data-copy="cost.twice"><i data-copy-slot="a">A</i></p>',
    '<p data-copy="cost.twice"><i data-copy-slot="a">A</i> or %{a}</p>',
  ],
  [
    'a slot child the snippet no longer names goes',
    '<p data-copy="cost.gone">See <a data-copy-slot="plans">plans</a></p>',
    '<p data-copy="cost.gone">No link now.</p>',
  ],
  [
    'what follows a filled element is left alone',
    '<div><p data-copy="cost.limits"><a data-copy-slot="plans">x</a></p> after <b>it</b></div>',
    '<div><p data-copy="cost.limits">Tax is included. <a data-copy-slot="plans">x</a>.</p> after <b>it</b></div>',
  ],
]

for (let [name, html, want] of cases) {
  test(`page copy: ${name}`, async () => assertEquals(await fills(html), want))
}

test('page copy: a page with no copy is the same response', () => {
  let page = new Response('<p data-copy="hero.title">x</p>')
  assertEquals(filled(page, null), page)
})

// Contract checks for the five standalone concepts and their local navigation.
let root = new URL('.', import.meta.url)
let concepts = [
  'soft.html',
  'classy.html',
  'retro.html',
  'address.html',
  'sentence.html',
]

let read = (name: string) => Deno.readTextFile(new URL(name, root))
let assert = (condition: unknown, message = 'assertion failed') => {
  if (!condition) throw new Error(message)
}

Deno.test('all five concepts carry the product promise and accessibility basics', async () => {
  for (let name of concepts) {
    let html = await read(name)
    assert(html.includes('<meta name="viewport"'))
    assert(html.includes('class="skip"'))
    assert(html.includes('aria-label="Switch concept"'))
    assert(html.match(/<h1[ >]/g)?.length === 1, `${name}: expected one h1`)
    assert(!html.toLowerCase().includes('little'))
    assert(html.includes('assistant'))
    assert(html.includes('address'))
  }
})

Deno.test('concept navigation resolves to local files', async () => {
  for (let name of ['index.html', ...concepts]) {
    let html = await read(name)
    for (let href of html.matchAll(/href="([^"#]+\.html)"/g)) {
      let target = new URL(href[1], root)
      assert((await Deno.stat(target)).isFile, `${name}: missing ${href[1]}`)
    }
  }
})

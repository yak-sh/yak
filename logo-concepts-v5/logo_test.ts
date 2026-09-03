// The complete yak gallery: every local round-five PNG is linked, and every
// retained output stays a large PNG master even when its background is a known
// generation defect.
let root = new URL('.', import.meta.url)
let html = await Deno.readTextFile(new URL('index.html', root))
let assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

Deno.test('the gallery includes every retained round-five output', async () => {
  let files = []
  for await (let entry of Deno.readDir(root)) {
    if (entry.isFile && entry.name.endsWith('.png')) files.push(entry.name)
  }
  files.sort()
  for (let file of files) {
    assert(html.includes(`'${file}'`), `${file}: unlisted`)
  }
})

Deno.test('every earlier-round image linked by the gallery exists', async () => {
  let links = [...html.matchAll(/'((?:\.\.\/)[^']+\.png)'/g)]
    .map((match) => match[1])
  assert(links.length > 0, 'no earlier-round images linked')
  for (let link of links) await Deno.stat(new URL(link, root))
})

Deno.test('retained outputs are large PNG masters', async () => {
  let rgb = new Set([
    'archive-01-cut-paper-head-checker.png',
    'archive-02-cut-paper-body-checker.png',
    'extracted-02-typing.png',
    'isolated-reference-faq-01-checker-three-limbs.png',
    'isolated-reference-faq-02-checker-eyes.png',
    'isolated-reference-faq-03-checker-spikes.png',
    'isolated-reference-faq-04-selected-checker.png',
    'isolated-reference-logo-01-watercolor-white-eyes.png',
    'isolated-reference-logo-02-watercolor-selected-checker.png',
    'isolated-reference-logo-03-shallow-checker-eyes.png',
    'isolated-reference-logo-04-shallow-checker-mane.png',
    'isolated-reference-logo-05-shallow-selected-checker.png',
    'isolated-reference-logo-06-felt-selected-checker.png',
    'isolated-reference-logo-07-polished-checker-eyes.png',
    'isolated-reference-logo-08-polished-checker-eyes.png',
    'isolated-reference-logo-09-polished-selected-checker.png',
    'isolated-reference-pricing-01-checker-eyes.png',
    'isolated-reference-pricing-02-checker.png',
    'isolated-reference-pricing-03-checker.png',
    'isolated-reference-pricing-04-selected-checker.png',
    'isolated-reference-typing-01-checker-tufts.png',
    'isolated-reference-typing-02-checker-spikes.png',
    'isolated-reference-typing-03-selected-checker.png',
    'reference-01-watercolor-bell-checker.png',
    'reference-05-typing-checker.png',
    'reference-06-faq-five-legs-checker.png',
    'reference-08-faq-four-limbs-checker.png',
  ])
  for await (let entry of Deno.readDir(root)) {
    if (!entry.isFile || !entry.name.endsWith('.png')) continue
    let bytes = await Deno.readFile(new URL(entry.name, root))
    let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let signature = [...bytes.slice(0, 8)].join(',')
    let width = view.getUint32(16)
    let height = view.getUint32(20)
    let colorType = bytes[25]

    assert(signature === '137,80,78,71,13,10,26,10', `${entry.name}: not PNG`)
    assert(Math.min(width, height) >= 1024, `${entry.name}: master too small`)
    assert(
      colorType === (rgb.has(entry.name) ? 2 : 6),
      `${entry.name}: unexpected PNG color type ${colorType}`,
    )
  }
})

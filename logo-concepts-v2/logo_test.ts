// Raster-logo contracts: seven square RGBA masters for concept review.
let files = [
  '01-skeuo-standing.png',
  '02-skeuo-bell-bust.png',
  '03-skeuo-resting.png',
  '04-skeuo-stride.png',
  '05-cut-paper-stride.png',
  '06-gouache-profile.png',
  '07-watercolor-portrait.png',
]

let root = new URL('.', import.meta.url)
let assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

Deno.test('logo concepts are square PNG masters with alpha', async () => {
  for (let file of files) {
    let bytes = await Deno.readFile(new URL(file, root))
    let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let signature = [...bytes.slice(0, 8)].join(',')
    let width = view.getUint32(16)
    let height = view.getUint32(20)
    let colorType = bytes[25]

    assert(signature === '137,80,78,71,13,10,26,10', `${file}: not PNG`)
    assert(width === height && width >= 1024, `${file}: not a large square`)
    assert(colorType === 4 || colorType === 6, `${file}: missing alpha channel`)
  }
})

// Raster-logo contracts: square RGBA masters, ready to derive final icon crops.
let files = [
  'yak-gouache.png',
  'yak-monoprint-head.png',
  'yak-cut-paper.png',
  'yak-block-print.png',
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
    assert(width === 1254 && height === 1254, `${file}: unexpected dimensions`)
    assert(colorType === 4 || colorType === 6, `${file}: missing alpha channel`)
  }
})

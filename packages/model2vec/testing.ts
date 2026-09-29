// Test fixtures (not part of the published package): a model small enough to
// read, in the same two files a hub repo holds — a WordPiece tokenizer.json
// and a safetensors token table.

/** A safetensors file: this header, then these floats. */
export let raw = (
  header: object,
  data: Float32Array,
): Uint8Array<ArrayBuffer> => {
  let head = new TextEncoder().encode(JSON.stringify(header))
  // the header is padded to 8 bytes, as the format's writers do
  let size = Math.ceil(head.length / 8) * 8
  let out = new Uint8Array(8 + size + data.byteLength).fill(0x20, 8, 8 + size)
  new DataView(out.buffer).setBigUint64(0, BigInt(size), true)
  out.set(head, 8)
  out.set(new Uint8Array(data.buffer), 8 + size)
  return out
}

/** A safetensors file holding one F32 `embeddings` tensor, these rows. */
export let safetensors = (rows: number[][]): Uint8Array<ArrayBuffer> => {
  let data = new Float32Array(rows.flat())
  return raw({
    __metadata__: { format: 'pt' },
    embeddings: {
      dtype: 'F32',
      shape: [rows.length, rows[0].length],
      data_offsets: [0, data.byteLength],
    },
  }, data)
}

/** A lowercasing WordPiece tokenizer.json over these words, as a BERT
 * vocabulary lays one out: the special tokens first. */
export let tokenizer = (words: string[]): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(JSON.stringify({
    version: '1.0',
    added_tokens: ['[PAD]', '[UNK]', '[CLS]', '[SEP]'].map((content, id) => ({
      id,
      content,
      single_word: false,
      lstrip: false,
      rstrip: false,
      normalized: false,
      special: true,
    })),
    normalizer: {
      type: 'BertNormalizer',
      clean_text: true,
      handle_chinese_chars: true,
      strip_accents: null,
      lowercase: true,
    },
    pre_tokenizer: { type: 'BertPreTokenizer' },
    post_processor: null,
    decoder: null,
    model: {
      type: 'WordPiece',
      unk_token: '[UNK]',
      continuing_subword_prefix: '##',
      max_input_chars_per_word: 100,
      vocab: Object.fromEntries(
        ['[PAD]', '[UNK]', '[CLS]', '[SEP]', ...words].map((w, i) => [w, i]),
      ),
    },
  }))

let words = ['a', 'red', 'dragon', 'blue', 'whale', ',']
let rows = [
  [0, 0, 0, 0],
  [9, 9, 9, 9], // [UNK]: never read
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0.1, 0, 0, 0],
  [1, 0, 0, 0],
  [0, 1, 0, 0],
  [0, 0, 1, 0],
  [0, 0, 0, 1],
  [0, 0, 0, 0],
]

/** The files of a four-dimensional model of six words. */
export let files = {
  tokenizer: tokenizer(words),
  safetensors: safetensors(rows),
}

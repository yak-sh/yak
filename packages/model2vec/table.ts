// The token table a Model2Vec model ships as `model.safetensors`: one row of
// floats per token id, the whole model. Reading it is pure: bytes in, rows out.
//
// Its columns come out of a PCA, most variance first, so the leading `dim` of
// them are the model at a smaller width, the way Model2Vec's own
// `dimensionality` loads one. Keeping only those columns here, rather than
// cutting each vector later, is the same arithmetic (a mean of cut rows is the
// cut of the mean) at a fraction of the memory.

/** A token table: `count` rows of `dim` floats, row `id` for token `id`. */
export type Table = { rows: Float32Array; dim: number; count: number }

type Tensor = { dtype: string; shape: number[]; data_offsets: [number, number] }

/**
 * The `embeddings` tensor of a safetensors file, keeping its leading `dim`
 * columns (all of them by default). A file holding anything else beside it —
 * per-token weights, a vocabulary mapping — is a newer layout this does not
 * read, and is refused rather than read wrong.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { safetensors } from './testing.ts'
 * let t = table(safetensors([[1, 2, 3], [4, 5, 6]]), 2)
 * assertEquals([t.count, t.dim, [...t.rows]], [2, 2, [1, 2, 4, 5]])
 * ```
 */
export let table = (bytes: Uint8Array, dim?: number): Table => {
  let view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let size = Number(view.getBigUint64(0, true))
  let head = JSON.parse(
    new TextDecoder().decode(bytes.subarray(8, 8 + size)),
  ) as Record<string, Tensor>
  let { __metadata__: _, embeddings: t, ...rest } = head
  if (!t || Object.keys(rest).length) {
    throw new Error(
      `@yaks/model2vec: expected one \`embeddings\` tensor, found ${
        Object.keys(head).join(', ')
      }`,
    )
  }
  if (t.dtype != 'F32' || t.shape.length != 2) {
    throw new Error(
      `@yaks/model2vec: embeddings are ${t.dtype} ${t.shape}, not a F32 table`,
    )
  }
  let [count, width] = t.shape
  let keep = dim ?? width
  if (keep > width) {
    throw new Error(
      `@yaks/model2vec: the model is ${width} wide, narrower than the ${keep} asked for`,
    )
  }
  let at = bytes.byteOffset + 8 + size + t.data_offsets[0]
  // A Float32Array needs a 4-byte-aligned offset; a file's is aligned by
  // convention, and copied when it is not.
  let all = at % 4
    ? new Float32Array(
      bytes.slice(at - bytes.byteOffset).buffer,
      0,
      count * width,
    )
    : new Float32Array(bytes.buffer, at, count * width)
  if (keep == width) return { rows: all, dim: width, count }
  let rows = new Float32Array(count * keep)
  for (let i = 0; i < count; i++) {
    rows.set(all.subarray(i * width, i * width + keep), i * keep)
  }
  return { rows, dim: keep, count }
}

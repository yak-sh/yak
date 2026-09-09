// An R2 bucket, as the slice we ask of it and nothing else — mirroring
// @cloudflare/workers-types, so neither src/ nor a Worker carries a Cloudflare
// dependency to name a bucket.
//
// It is its OWN module, with no imports at all, because two very different
// programs name it: blobs_r2.ts, which adapts a bucket to the blob seam, and
// the kernel's `Env`, which only declares that a binding of this shape exists.
// While the two shared a file, naming the binding dragged the seam's Deno-side
// implementation (blobs.ts) into the type graph of everything that reads
// `Env` — including the Store object, which is checked with no Deno anywhere
// in its graph (workers/yak/conform.ts).
export type R2 = {
  head(key: string): Promise<unknown | null>
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>
  put(key: string, value: ArrayBuffer | Uint8Array): Promise<unknown>
  delete(key: string): Promise<unknown>
  list(
    opts: { prefix: string; cursor?: string },
  ): Promise<
    {
      objects: { key: string; uploaded: Date }[]
      truncated: boolean
      cursor?: string
    }
  >
}

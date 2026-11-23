import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import {
  address,
  addressOf,
  bucketObjects,
  encode,
  HEAD,
  memoryBlobs,
  memoryMultipart,
  objectBlobs,
  PIECE,
  prefixed,
  stage,
  STAGING,
  streamOf,
  TooMany,
} from './mod.ts'
import { memoryBucket } from './testing.ts'

// A bucket that says, for each put, whether it was handed a stream or bytes:
// a file streams through when every put of it is a stream.
let watched = () => {
  let { bucket, held } = memoryBucket()
  let puts: string[] = []
  let put: typeof bucket.put = (key, value) => {
    puts.push(`${key} ${value instanceof ReadableStream ? 'stream' : 'bytes'}`)
    return bucket.put(key, value)
  }
  return { bucket: { ...bucket, put }, held, puts }
}

// A stream of `bytes` in pieces of `n`, the way a request arrives.
let pieces = (bytes: Uint8Array, n = 64 * 1024) => {
  let at = 0
  return {
    size: bytes.byteLength,
    stream: new ReadableStream<Uint8Array>({
      pull: (c) => {
        if (at >= bytes.length) return c.close()
        c.enqueue(bytes.slice(at, at += n))
      },
    }),
  }
}

// A file larger than is ever held whole.
let large = new Uint8Array(PIECE + 12).map((_, i) => i % 251)
let largeSha = await addressOf(large)

let stores = {
  objectBlobs: (b: ReturnType<typeof watched>['bucket']) =>
    objectBlobs(b, 'blobs/'),
  prefixed: (b: ReturnType<typeof watched>['bucket']) =>
    prefixed(bucketObjects(b), 'blobs/'),
}

for (let [name, store] of Object.entries(stores)) {
  test(`${name}: a large stream is staged, kept at its address and let go, never held`, async () => {
    let { bucket, held, puts } = watched()
    let staged = await stage(store(bucket), pieces(large))
    equal([staged.sha, staged.size], [largeSha, large.length])
    equal(staged.head, large.slice(0, HEAD))
    await staged.keep()
    await staged.drop()
    equal([...held.keys()], [`blobs/${largeSha}`])
    equal(held.get(`blobs/${largeSha}`), large)
    equal(puts.map((p) => p.replace(/staging\/\S+/, 'staging/…')), [
      `${STAGING}… stream`,
      `blobs/${largeSha} stream`,
    ])
    // Kept already, it is not put again.
    let again = await stage(store(bucket), pieces(large))
    await again.keep()
    await again.drop()
    equal(puts.filter((p) => p.startsWith('blobs/')).length, 1)
  })

  test(`${name}: a large stream that is not the length it said leaves nothing`, async () => {
    let { bucket, held } = watched()
    for (let size of [large.length - 1, large.length + 1]) {
      await assertRejects(() =>
        stage(store(bucket), { ...pieces(large), size })
      )
    }
    equal([...held.keys()], [])
  })

  test(`${name}: a small stream is one put, at its address`, async () => {
    let { bucket, puts } = watched()
    let staged = await stage(store(bucket), pieces(encode('small'), 2))
    await staged.keep()
    await staged.drop()
    equal(puts, [`blobs/${address('small')} bytes`])
  })
}

test('a stream past the most it may be is refused', async () => {
  let { bucket, held } = watched()
  for (let blobs of [objectBlobs(bucket), memoryBlobs()]) {
    await assertRejects(() => stage(blobs, pieces(large), PIECE), TooMany)
  }
  equal([...held.keys()], [])
})

test('a stream of unknown length goes up in pieces, the bucket never given it whole', async () => {
  let { bucket, held } = memoryBucket()
  let multipart = memoryMultipart(bucket.put)
  let sizes: number[] = []
  let resumeMultipartUpload: typeof multipart.resumeMultipartUpload = (
    key,
    id,
  ) => {
    let up = multipart.resumeMultipartUpload(key, id)
    return {
      ...up,
      uploadPart: async (n, value) => {
        let got = await up.uploadPart(n, value)
        sizes.push(held.size)
        return got
      },
    }
  }
  let objects = bucketObjects({
    ...bucket,
    ...multipart,
    resumeMultipartUpload,
  })
  let file = new Uint8Array(2 * PIECE + 5).map((_, i) => i % 251)
  let { stream } = streamOf(file)
  await objects.put('big', { stream })
  equal(sizes, [0, 0, 0])
  equal(held.get('big'), file)
  await objects.put('small', { stream: streamOf(encode('hi')).stream })
  equal(new TextDecoder().decode(held.get('small')), 'hi')
})

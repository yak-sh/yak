// The blob seam's local half (blobs.ts): a key is a string that may carry
// slashes, and `list` screens by prefix rather than walking one directory —
// the two things r2Blobs does that the kernel's app files depend on. Slow
// tier: a directory adapter is real filesystem I/O, and it guards the same
// hosted path workers/yak/mcp_test.ts drives.
import { assertEquals } from '@std/assert'
import { dirBlobs } from './blobs.ts'
import { slow } from './testing.ts'

slow('dirBlobs: nested keys, and list by prefix', async () => {
  let root = await Deno.makeTempDir({ prefix: 'tasks-blobs-' })
  try {
    let blobs = dirBlobs(root)
    let bytes = (s: string) => new TextEncoder().encode(s)
    for (
      let key of [
        'jeff/recipes/index.html',
        'jeff/recipes/css/site.css',
        'jeff/notes/a.md',
        'loose',
      ]
    ) await blobs.put(key, bytes(key))

    assertEquals(await blobs.has('jeff/recipes/index.html'), true)
    assertEquals(await blobs.has('jeff/recipes/nope'), false)
    assertEquals(
      new TextDecoder().decode(await blobs.get('jeff/notes/a.md')),
      'jeff/notes/a.md',
    )
    // Sorted, and only what the prefix names — a prefix is a string, so it
    // need not end at a slash and it never escapes into a sibling.
    assertEquals(await blobs.list('jeff/recipes/'), [
      'jeff/recipes/css/site.css',
      'jeff/recipes/index.html',
    ])
    assertEquals(await blobs.list('jeff/n'), ['jeff/notes/a.md'])
    assertEquals(await blobs.list('nothing/'), [])
    assertEquals((await blobs.list('')).length, 4)

    // Deleting takes the key out of the listing, and deleting what is not
    // there is quiet.
    await blobs.delete('jeff/recipes/index.html')
    await blobs.delete('jeff/recipes/index.html')
    assertEquals(await blobs.has('jeff/recipes/index.html'), false)
    assertEquals(await blobs.list('jeff/recipes/'), [
      'jeff/recipes/css/site.css',
    ])
  } finally {
    await Deno.remove(root, { recursive: true })
  }
})

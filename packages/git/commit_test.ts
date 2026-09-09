// Commits: the body git writes, and the id it takes. Constants: ./harness.ts.

import { assertEquals } from '@std/assert'
import { commitBody, signature } from './commit.ts'
import { oid, oid256 } from './oid.ts'
import {
  AUTHOR,
  COMMITTER,
  ONE_OID,
  ONE_OID256,
  ROOT_OID,
  ROOT_OID256,
  TWO_OID,
  TWO_OID256,
} from './harness.ts'

let one = { tree: ROOT_OID, author: AUTHOR, committer: COMMITTER }
let two = { at: 1757000060000 }

Deno.test('a commit is named as git names it', async () => {
  assertEquals(
    await oid('commit', commitBody({ ...one, message: 'deploy 1' })),
    ONE_OID,
  )
})

Deno.test('a commit follows its parent', async () => {
  let body = commitBody({
    tree: ROOT_OID,
    parents: [ONE_OID],
    author: { ...AUTHOR, ...two },
    committer: { ...COMMITTER, ...two },
    message: 'deploy 2',
  })
  assertEquals(await oid('commit', body), TWO_OID)
})

Deno.test('the SHA-256 commit names its tree and parent by their SHA-256 names', async () => {
  assertEquals(
    await oid256(
      'commit',
      commitBody({ ...one, tree: ROOT_OID256, message: 'deploy 1' }),
    ),
    ONE_OID256,
  )
  assertEquals(
    await oid256(
      'commit',
      commitBody({
        tree: ROOT_OID256,
        parents: [ONE_OID256],
        author: { ...AUTHOR, ...two },
        committer: { ...COMMITTER, ...two },
        message: 'deploy 2',
      }),
    ),
    TWO_OID256,
  )
})

Deno.test('the body is the lines git writes, in order', () => {
  assertEquals(
    new TextDecoder().decode(commitBody({ ...one, message: 'deploy 1' })),
    `tree ${ROOT_OID}\n` +
      `author yaks <a6433884@users.yaks.app> 1757000000 +0000\n` +
      `committer yaks.app <git@yaks.app> 1757000000 +0000\n` +
      `\ndeploy 1\n`,
  )
})

Deno.test('a message ends in exactly one newline, however it arrived', async () => {
  for (let message of ['deploy 1', 'deploy 1\n', 'deploy 1\n\n\n']) {
    assertEquals(await oid('commit', commitBody({ ...one, message })), ONE_OID)
  }
})

Deno.test("an ident carrying the format's punctuation is trimmed", () => {
  assertEquals(
    signature({ name: 'a\nb <c>', email: 'x@y', at: 1757000000000 }),
    'ab c <x@y> 1757000000 +0000',
  )
})

Deno.test('a time is taken as an instant, however it is said', () => {
  let at = '2025-09-04T15:33:20.000Z'
  assertEquals(
    signature({ ...AUTHOR, at }),
    signature(AUTHOR),
  )
})

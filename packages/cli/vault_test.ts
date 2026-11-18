// A box's vault: private files beside the database, which @yaks/secrets seals
// into through the graph like any other vault.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import {
  reveal,
  sealed,
  secretEid,
  secrets,
  secretsDoc,
  unsealed,
} from '@yaks/secrets'
import { loadVocab } from '@yaks/vocab'
import { provisionalDoc } from '@yaks/effects'
import { fileVault, vaultOf } from './vault.ts'

// A value on its way to the vault wears @yaks/effects' `provisional` mark.
let vocab = loadVocab([secretsDoc, provisionalDoc])

test('the file vault is private files, one per secret, and follows no symlink', async () => {
  let dir = await Deno.makeTempDir()
  try {
    let vault = fileVault(`${dir}/secrets`)
    let g = graph({
      storage: ram(vocab),
      vocab,
      plugins: [secrets(vault, (b) => g.apply(b, { trusted: true }), vocab)],
    })
    await g.apply([sealed('A', 'one')])
    let eid = secretEid('A')
    assertEquals(await reveal(fileVault(`${dir}/secrets`), 'A'), 'one')
    assertEquals(Deno.statSync(`${dir}/secrets`).mode! & 0o777, 0o700)
    assertEquals(
      Deno.statSync(`${dir}/secrets/${eid}.json`).mode! & 0o777,
      0o600,
    )
    assertEquals(vault.all().map(([e]) => e), [eid])
    await g.apply([unsealed('A')])
    assertEquals(vault.all(), [])
    Deno.writeTextFileSync(`${dir}/outside`, 'outside the vault')
    Deno.symlinkSync(`${dir}/outside`, `${dir}/secrets/${eid}.json`)
    assertEquals(
      await Promise.resolve().then(() => vault.read(eid)).catch(() =>
        'refused'
      ),
      'refused',
    )
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

// `~/.yak/yak.db` keeps its secrets in `~/.yak/secrets`, as it always has.
test('a graph keeps its secrets beside its database, or in memory', async () => {
  let dir = await Deno.makeTempDir()
  try {
    fileVault(`${dir}/secrets`).seal(secretEid('A'), {
      handle: 'h',
      value: 'v',
    })
    assertEquals(await reveal(vaultOf(`${dir}/yak.db`), 'A'), 'v')
    assertEquals(vaultOf(':memory:').all(), [])
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

// Removed and replaced values remain private and recoverable without being active.
test('vault trash retains removed and rotated secrets', async () => {
  let dir = await Deno.makeTempDir()
  let vault = fileVault(`${dir}/secrets`)
  let eid = secretEid('A')
  let values = () =>
    [...Deno.readDirSync(`${dir}/secrets/trash`)].map((entry) =>
      JSON.parse(Deno.readTextFileSync(`${dir}/secrets/trash/${entry.name}`))
        .sealed
    )
  try {
    vault.seal(eid, { handle: 'h', value: 'one' })
    vault.seal(eid, { handle: 'h', value: 'two' })
    assertEquals(vault.read(eid)?.value, 'two')
    assertEquals(values(), [{ handle: 'h', value: 'one' }])
    vault.drop(eid)
    assertEquals(vault.read(eid), undefined)
    assertEquals(vault.all(), [])
    assertEquals(values().map((v) => v.value).sort(), ['one', 'two'])
    assertEquals(Deno.statSync(`${dir}/secrets/trash`).mode! & 0o777, 0o700)
    for (let entry of Deno.readDirSync(`${dir}/secrets/trash`)) {
      assertEquals(
        Deno.statSync(`${dir}/secrets/trash/${entry.name}`).mode! & 0o777,
        0o600,
      )
    }
    let saved = vault.trash()
    assertEquals(saved.length, 2)
    assertEquals(saved.every((v) => v.eid == eid && v.handle == 'h'), true)
    let expected = JSON.parse(
      Deno.readTextFileSync(`${dir}/secrets/trash/${eid}.${saved[0].id}.json`),
    )
    assertEquals(vault.past(saved[0].id), expected.sealed)
    assertEquals(vault.past(crypto.randomUUID()), undefined)
    assertEquals(vault.read(eid), undefined)
    assertEquals(vault.trash(), saved)
    assertEquals(vault.restore(saved[0].id), true)
    assertEquals(vault.read(eid), expected.sealed)
    assertEquals(vault.restore(crypto.randomUUID()), false)
    let left = vault.trash()[0]
    vault.purge(left.id)
    assertEquals(vault.trash(), [])
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})

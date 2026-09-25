// A box's vault: private files beside the database, which @yaks/secrets seals
// into through the graph like any other vault.

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

Deno.test('the file vault is private files, one per secret, and follows no symlink', async () => {
  let dir = await Deno.makeTempDir()
  try {
    let vault = fileVault(`${dir}/secrets`)
    let g = graph({
      storage: ram(vocab),
      vocab,
      plugins: [secrets(vault, (b) => g.apply(b, { trusted: true }))],
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
    Deno.symlinkSync('/etc/hostname', `${dir}/secrets/${eid}.json`)
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
Deno.test('a graph keeps its secrets beside its database, or in memory', async () => {
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

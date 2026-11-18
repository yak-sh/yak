import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { provisionalDoc } from '@yaks/effects'
import { equal, test } from '@yaks/testing'
import {
  ramVault,
  reveal,
  sealed,
  secretEid,
  secrets,
  secretsDoc,
  unsealed,
} from './mod.ts'

let vocab = loadVocab([secretsDoc, provisionalDoc])
let vault = ramVault()
let g = graph({
  storage: ram(vocab),
  vocab,
  plugins: [secrets(vault, (b) => g.apply(b, { trusted: true }), vocab)],
})
await g.apply([sealed('trash-proof', 'first')])
let eid = secretEid('trash-proof')
await g.apply([sealed('trash-proof', 'second')])
await g.apply([unsealed('trash-proof')])

test('removed credentials stop resolving, while each retained version remains recoverable', async () => {
  equal(await reveal(vault, 'trash-proof', { env: () => undefined }), undefined)
  let trash = vault.trash().reverse()
  equal(trash.length, 2)
  equal(trash.every((v) => !('value' in v)), true)
  equal(vault.past(trash[0].id)?.value, 'first')
  equal(vault.past('unknown'), undefined)
  equal(vault.read(eid), undefined)
  equal(vault.trash(), [...trash].reverse())
  equal(vault.restore(trash[0].id), true)
  equal(vault.read(eid)?.value, 'first')
  equal(vault.restore(trash[1].id), true)
  equal(vault.read(eid)?.value, 'second')
  let displaced = vault.trash()[0]
  vault.purge(displaced.id)
  equal(vault.trash(), [])
  equal(vault.read(eid)?.value, 'second')
})

let restoredVault = ramVault()
let restored = graph({
  storage: ram(vocab),
  vocab,
  plugins: [
    secrets(restoredVault, (b) => restored.apply(b, { trusted: true }), vocab),
  ],
})
await restored.apply([sealed('restored-secret', 'retained')])
let restoredEid = secretEid('restored-secret')
let restoredHandle = restoredVault.read(restoredEid)!.handle
await restored.apply([sealed('restored-secret', 'latest')])
await restored.apply([unsealed('restored-secret')])

test('restoring a graph secret by its old handle restores its retained credential', async () => {
  await restored.apply([{
    entity: { eid: restoredEid },
    secret: {
      name: 'restored-secret',
      value: restoredHandle,
    },
  }])
  equal(await reveal(restoredVault, 'restored-secret'), 'latest')
  equal(restoredVault.trash().length, 1)
})

let historyVault = ramVault()
let history = graph({
  storage: ram(vocab),
  vocab,
  plugins: [
    secrets(historyVault, (b) => history.apply(b, { trusted: true }), vocab),
  ],
})
await history.apply([sealed('history-secret', 'original')])
let historyEid = secretEid('history-secret')
let originalHandle = historyVault.read(historyEid)!.handle
await history.apply([unsealed('history-secret')])
await history.apply([sealed('history-secret', 'recovered')])
let replacementHandle = historyVault.read(historyEid)!.handle

test('restoring an older graph handle retains the newer credential and restores its matching version', async () => {
  equal(originalHandle == replacementHandle, false)
  await history.apply([{
    entity: { eid: historyEid },
    secret: { name: 'history-secret', value: originalHandle },
  }])
  equal(historyVault.read(historyEid)?.handle, originalHandle)
  equal(await reveal(historyVault, 'history-secret'), 'original')
  let retained = historyVault.trash().find((v) =>
    v.handle == replacementHandle
  )!
  equal(historyVault.past(retained.id)?.value, 'recovered')
})

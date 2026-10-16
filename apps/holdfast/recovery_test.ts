/** Lost requests and lost replies must settle the same decision, not buy again. */
import type { Bundle } from '@yaks/graph'
import { equal, ok, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { WriteRefused, WriteUnknown } from '@yaks/client'
import { recover, type RecoveryPorts } from './recovery.ts'
import type { Row } from './model.ts'

const ledger: Row = {
  entity: { eid: 'purchase-0' },
  $was: { spent: { gold: null } },
  spent: { run: 'run', tower: 'tower', gold: 55 },
}
const companion: Row = {
  entity: { eid: 'order' },
  command: null,
  reply: { message: 'Done' },
}
const purchase: Row[] = [
  {
    entity: { eid: 'tower' },
    tower: { run: 'run', slot: 0, design: 'arrow', policy: 'first' },
  },
  ledger,
  companion,
]
const sale: Row[] = [
  { entity: { eid: 'tower' }, $delete: true },
  { ...ledger, spent: { ...ledger.spent!, gold: -38 } },
  companion,
]
const ended: Row[] = [
  {
    entity: { eid: 'clear-1' },
    cleared: { run: 'run', wave: 1, leaked: 0, bounty: 23 },
  },
  { entity: { eid: 'conductor' }, conductor: null },
  { entity: { eid: 'run' }, completed: {} },
]
const creation: Row[] = [{
  entity: { eid: 'run' },
  run: { map: 'map', seed: 42 },
}]

// Fixtures are immutable decisions, including the guard and companion patches.
function freeze(value: object) {
  for (let child of Object.values(value)) {
    if (child && typeof child === 'object') freeze(child)
  }
  Object.freeze(value)
}
for (let batch of [purchase, sale, ended, creation]) freeze(batch)
const refused = (batch: Row[]) =>
  new WriteRefused(batch as Bundle[], {
    error: 'Stale',
    message: 'Ledger already exists',
  })
const lost = (batch: Row[]) =>
  new WriteUnknown(batch as Bundle[], new Error('Offline'))

function fixture(batch: Row[]) {
  let writes: Row[][] = [], reads: Row[][] = [], accepts: Row[][] = []
  let reports: unknown[] = [], waits = 0
  let error = lost(batch)
  let server: Row[] = []
  let ports: RecoveryPorts = {
    write: (value) => {
      writes.push(value)
      return writes.length === 1 ? Promise.reject(error) : Promise.resolve()
    },
    read: (value) => {
      reads.push(value)
      return Promise.resolve(server)
    },
    accept: (value) => {
      accepts.push(value)
    },
    report: (value) => {
      reports.push(value)
    },
    wait: () => {
      waits++
      return Promise.resolve()
    },
  }
  return {
    ports,
    writes,
    reads,
    accepts,
    reports,
    error,
    get waits() {
      return waits
    },
    landed(rows: Row[]) {
      server = rows
    },
  }
}

const before = fixture(purchase)
test('a lost request retries the original guarded purchase, not a new ledger', async () => {
  await recover(purchase, before.ports)
  equal(before.writes.length, 2)
  ok(before.writes.every((batch) => batch === purchase))
  ok(before.reads[0] === purchase)
  equal(before.waits, 1)
  equal(before.accepts.length, 0)
  ok(before.reports[0] === before.error)
})

const after = fixture(purchase)
// The server may have already upgraded the mutable tower again. Only its
// immutable receipt proves our purchase; restore CURRENT rows, not old patches.
const current: Row[] = [{
  entity: { eid: 'tower' },
  tower: { ...purchase[0].tower!, design: 'upgraded' },
}, {
  entity: { ...{ eid: ledger.entity.eid, num: 12 } },
  spent: { gold: 55, tower: 'tower', run: 'run' },
  created: { at: 'server-stamp' },
}]
after.landed(current)
test('a lost acceptance restores authoritative current rows without repurchasing', async () => {
  await recover(purchase, after.ports)
  equal(after.writes.length, 1)
  equal(after.accepts.length, 1)
  ok(after.accepts[0] === current)
  ok(after.reports[0] === after.error)
})

const held = fixture(sale)
held.landed([sale[1]])
let replica = new Map<string, Row>([['tower', purchase[0]]])
let companions = 0
held.ports.accept = (rows) => {
  // Main's acknowledgement seam: restore server rows/absences, then apply
  // the held peer-only command/reply exactly once (never another server POST).
  for (let patch of sale.slice(0, 2)) replica.delete(patch.entity.eid)
  for (let row of rows) replica.set(row.entity.eid, row)
  replica.set(companion.entity.eid, companion)
  companions++
}
test('a lost held delete acceptance removes the tower and applies its companion once', async () => {
  await recover(sale, held.ports)
  equal(held.writes.length, 1)
  equal(replica.has('tower'), false)
  equal(replica.get('order')?.command, null)
  equal(replica.get('order')?.reply, companion.reply)
  equal(companions, 1)
})

const clear = fixture(ended)
clear.landed([ended[0]])
test('wave-end recovery uses the cleared receipt without needing mutable conductor state', async () => {
  await recover(ended, clear.ports)
  equal(clear.writes.length, 1)
  equal(clear.accepts.length, 1)
})
const run = fixture(creation)
run.landed(creation)
test('run creation recovers from its stored run receipt', async () => {
  await recover(creation, run.ports)
  equal(run.writes.length, 1)
  equal(run.accepts.length, 1)
})

const mismatch = fixture(purchase)
mismatch.landed([{ ...ledger, spent: { ...ledger.spent!, gold: 99 } }])
test('an existing receipt with different values is not our accepted purchase', async () => {
  await recover(purchase, mismatch.ports)
  equal(mismatch.writes.length, 2)
  equal(mismatch.accepts.length, 0)
})

const readFailure = fixture(purchase)
const unavailable = new Error('Query offline')
let attempts = 0
readFailure.ports.read = () => {
  attempts++
  return attempts === 1 ? Promise.reject(unavailable) : Promise.resolve(current)
}
test('failed authoritative reads report and wait again without resending', async () => {
  await recover(purchase, readFailure.ports)
  equal(readFailure.writes.length, 1)
  equal(readFailure.waits, 2)
  equal(attempts, 2)
  equal(readFailure.accepts.length, 1)
  ok(readFailure.reports[1] === unavailable)
})

const rejection = fixture(purchase)
const no = refused(purchase)
rejection.ports.write = (batch) => {
  rejection.writes.push(batch)
  return Promise.reject(no)
}
test('an explicit initial refusal is reported and thrown without reads or retries', async () => {
  let error = await assertRejects(() => recover(purchase, rejection.ports))
  ok(error === no)
  equal(rejection.writes.length, 1)
  equal(rejection.reads.length, 0)
  equal(rejection.waits, 0)
  ok(rejection.reports[0] === no)
})

const late = fixture(purchase)
const lateRefusal = refused(purchase)
late.ports.write = (batch) => {
  late.writes.push(batch)
  return Promise.reject(late.writes.length === 1 ? late.error : lateRefusal)
}
late.ports.read = (batch) => {
  late.reads.push(batch)
  return Promise.resolve(late.reads.length === 1 ? [] : current)
}
test('a retry refusal checks for the original POST committing after the first read', async () => {
  await recover(purchase, late.ports)
  equal(late.writes.length, 2)
  equal(late.reads.length, 2)
  equal(late.accepts.length, 1)
  ok(late.accepts[0] === current)
})

const stale = fixture(purchase)
const other = refused(purchase)
stale.ports.write = (batch) => {
  stale.writes.push(batch)
  return Promise.reject(stale.writes.length === 1 ? stale.error : other)
}
stale.landed([{
  ...ledger,
  spent: { ...ledger.spent!, tower: 'other-tower' },
}])
test('a retry refusal without matching receipt remains a refusal, not an infinite retry', async () => {
  let error = await assertRejects(() => recover(purchase, stale.ports))
  ok(error === other)
  equal(stale.writes.length, 2)
  equal(stale.reads.length, 2)
  equal(stale.accepts.length, 0)
  ok(stale.reports[1] === other)
})

const broken = fixture(purchase)
const bug = new Error('Unexpected bug')
broken.ports.write = () => Promise.reject(bug)
test('unexpected errors report and propagate instead of permanently pausing recovery', async () => {
  let error = await assertRejects(() => recover(purchase, broken.ports))
  ok(error === bug)
  ok(broken.reports[0] === bug)
  equal(broken.waits, 0)
})

const noReceipt: Row[] = [companion]
const unsupported = fixture(noReceipt)
test('an unknown batch without immutable receipts errors rather than blindly retrying', async () => {
  await assertRejects(
    () => recover(noReceipt, unsupported.ports),
    Error,
    'without an immutable receipt',
  )
  equal(unsupported.writes.length, 1)
  equal(unsupported.waits, 0)
  equal(unsupported.reports.length, 2)
})

import { equal, test, throws } from '@yaks/testing'
import { type Enter, instrument } from './instrument.ts'

class Subject {
  constructor(readonly state: unknown, readonly env: unknown) {}
  fetch(_req: Request) {
    return this.inner()
  }
  inner() {
    return 'answered'
  }
  fail() {
    throw Error('RPC failure')
  }
}

test('every call enters the boundary with its object and its request', async () => {
  let entered: [string, unknown[], string | undefined][] = []
  let enter: Enter = (args, name, run, request) => {
    entered.push([name, args, request?.url])
    return run()
  }
  let made: string[] = []
  let Tracked = instrument(Subject, enter, (_args, name) => made.push(name))
  let object = new Tracked('state', 'env')
  equal(object.fetch(new Request('https://x.test/')), 'answered')
  await throws(() => object.fail(), 'RPC failure')
  equal(made, ['Subject'])
  equal(entered, [
    ['Subject constructor', ['state', 'env'], undefined],
    ['Subject fetch', ['state', 'env'], 'https://x.test/'],
    ['Subject inner', ['state', 'env'], undefined],
    ['Subject fail', ['state', 'env'], undefined],
  ])
  equal(object instanceof Subject, true)
})

// A class an object's runtime constructs may inherit its lifecycle callbacks
// (@yaks/durable-object `Durable`'s `alarm`): they enter the boundary too,
// under the class's own name, by the nearest definition.
class Inheriting extends Subject {
  override inner() {
    return 'nearer'
  }
}

test('inherited methods enter the boundary as the class’s own', () => {
  let entered: string[] = []
  let Tracked = instrument(Inheriting, (_args, name, run) => {
    entered.push(name)
    return run()
  })
  equal(
    new Tracked('state', 'env').fetch(new Request('https://x.test/')),
    'nearer',
  )
  equal(entered, [
    'Inheriting constructor',
    'Inheriting fetch',
    'Inheriting inner',
  ])
})

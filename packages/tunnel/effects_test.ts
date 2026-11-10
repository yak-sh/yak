// A conversation held on the platform stands here as a session at the
// tunnel's door, is said to be the machine's person's where the platform says
// so, and hears a knock by the platform being told it once.
import { type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { effects as fxOf } from '@yaks/effects'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { docDoc } from '@yaks/doc'
import { mailDoc } from '@yaks/mail/vocab'
import { notifyDoc } from '@yaks/notify/vocab'
import { personaDoc } from '@yaks/persona/vocab'
import { sessionDoc } from '@yaks/session/vocab'
import { equal, test } from '@yaks/testing'
import { tellOf, type Told } from './effects.ts'
import { arrived } from './routes.ts'
import { BY, HEADER, WITH } from './gateway.ts'
import { tunnelDoc } from './vocab.ts'

let vocab = loadVocab(
  [
    kernelDoc,
    provenanceDoc,
    docDoc,
    mailDoc,
    notifyDoc,
    personaDoc,
    sessionDoc,
    tunnelDoc,
  ],
  [kernelKeywords],
)

let office = async () => {
  let fx = fxOf(vocab)
  let g = graph({ vocab, storage: ram(vocab), plugins: [fx] })
  let told: Told[] = []
  fx.handle({
    tunnel_tell: (e) =>
      tellOf(g, (t) => Promise.resolve(void told.push(t)), e.entity.eid),
  })
  await g.apply([
    { entity: { eid: 'jeff' }, person: {} },
    { entity: { eid: 'operator' }, persona: {} },
  ], { trusted: true })
  let came = arrived({ graph: g, config: { person: 'jeff' } }, {
    callers: { operator: { persona: 'operator', owner: 'u-jeff' } },
  })
  // A request through the tunnel from the Operator, in the conversation
  // `via`, held with `person` as the platform names them.
  let asked = (via: string, person?: string, own?: string) =>
    came(
      new Request('http://machine/mcp', {
        headers: {
          [HEADER]: '1',
          'x-yak-caller': 'operator',
          'x-via': via,
          ...person ? { [WITH]: person } : {},
          ...own ? { [BY]: own } : {},
        },
      }),
    )
  let knock = async (eid: string, target: string, about?: string) => {
    await g.apply([{
      entity: { eid },
      knock: { target, ...about ? { about } : {} },
      doc: { body: 'T-7 completed by TaskMaster: Give the Worker a token' },
    }], { trusted: true })
    await fx.idle()
  }
  let session = async (eid: string) =>
    (await g.get([eid], ['session']))[0]?.session as Comp
  return { g, told, asked, knock, session }
}

let HIS = crypto.randomUUID()

test("a conversation the platform says is the owner's stands here as the machine's person's", async () => {
  let o = await office()
  let { via } = (await o.asked(HIS, 'u-jeff'))!
  equal((await o.session(via!)).person, 'jeff')
  let other = (await o.asked(crypto.randomUUID(), 'u-checks'))!
  equal((await o.session(other.via!)).person, undefined)
  equal((await o.session(other.via!)).door, 'tunnel')
})

test("a knock at a conversation's session is told up the tunnel once, and marked said, with what it is about", async () => {
  let o = await office()
  let { via } = (await o.asked(HIS, 'u-jeff'))!
  let task = crypto.randomUUID()
  await o.knock('k1', via!, task)
  await o.knock('k2', via!)
  equal(o.told, [{
    conversation: HIS,
    key: 'k1',
    text: 'T-7 completed by TaskMaster: Give the Worker a token',
    about: task,
  }, {
    conversation: HIS,
    key: 'k2',
    text: 'T-7 completed by TaskMaster: Give the Worker a token',
  }])
  equal(!!(await o.g.get(['k1']))[0].notified, true)
  await tellOf(o.g, () => Promise.reject(new Error('told twice')), 'k1')
})

test('a knock at a session of this machine tells the platform nothing', async () => {
  let o = await office()
  await o.g.apply([{ entity: { eid: 'run' }, session: { id: 'run' } }], {
    trusted: true,
  })
  await o.knock('k1', 'run')
  equal(o.told, [])
})

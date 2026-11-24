// The rooms a conversation was spoken to in, which every step of a turn asks
// for, cost what they cost on a short conversation however long it grew.
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { equal, ok, test } from '@yaks/testing'
import { archetypeDoc } from '@yaks/archetype/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { modelDoc } from '@yaks/model'
import { toolsDoc } from '@yaks/tools/vocab'
import { effectDoc } from '@yaks/effects'
import { chatDoc } from '@yaks/chat/vocab'
import { sessionDoc } from '@yaks/session/vocab'
import { stepping } from '../../packages/sqlite/testing.ts'
import { roomsOf } from './operator-rooms.ts'

let vocab = loadVocab(
  [sessionDoc, chatDoc, toolsDoc, modelDoc, effectDoc, kernelDoc, archetypeDoc],
  [kernelKeywords],
)
let { driver, steps } = stepping()
let s = storage(driver, vocab)
s.install()
let g = graph({ storage: s, vocab })

// A conversation of `n` lines a person typed in the web chat, its fifth
// heard in a Discord room instead.
let said = (session: string, n: number): Bundle[] => [
  { entity: { eid: session }, session: {} },
  {
    entity: { eid: `${session}.room` },
    chat_room: { via: 'discord', id: session, platform_bot: true },
  },
  {
    entity: { eid: `${session}.message` },
    chat_message: { via: 'discord', room: `${session}.room`, message_id: '1' },
  },
  ...Array.from({ length: n }, (_, i) => ({
    entity: { eid: `${session}.${i + 1}` },
    entry: { session, seq: i + 1 },
    content: { body: 'hi' },
    channel: { name: i == 4 ? 'discord' : 'chat' },
    intake: { item: i == 4 ? `${session}.message` : `${session}.${i + 1}` },
  })),
]
await s.tx((tx) => tx.patch([...said('short', 30), ...said('long', 3000)]))

let rooms = async (session: string) => {
  await roomsOf({ g } as never, session)
  let before = steps()
  let found = await roomsOf({ g } as never, session)
  return { rooms: found.map((r) => r.room), steps: steps() - before }
}
let short = await rooms('short'), long = await rooms('long')

test("a long conversation's rooms cost what a short one's do", () => {
  equal(short.rooms, ['short'])
  equal(long.rooms, ['long'])
  ok(
    long.steps < short.steps * 1.5,
    `${long.steps} steps on 3,000 lines, ${short.steps} on 30`,
  )
})

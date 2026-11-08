// A store's query door across deploys (answered.ts): its memory outlives each
// deploy, as the store's own slot does, and a deploy is a new platform
// vocabulary under the same app words. The second one drops `effect.attempts`,
// the way d9f015365 stopped compiling `.effect.attempts=0`.
import { equal, test } from '@yaks/testing'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { api, json } from '@yaks/api'
import { answers, recalling } from './answered.ts'

let platform = (attempts: boolean): VocabDoc => ({
  $defs: {
    effect: {
      component: true,
      type: 'object',
      properties: {
        handler: { type: 'string' },
        ...attempts ? { attempts: { type: 'number' } } : {},
      },
    },
  },
})
let app = (prop: string): VocabDoc => ({
  $defs: {
    recipe: {
      component: true,
      type: 'object',
      properties: { [prop]: { type: 'string' } },
    },
  },
})
let APP = app('title')

// One deploy of a store whose memory is `slot`. `ask` answers a line at the
// door as a page or the kernel sends it; `read` is a door that throws its
// refusal instead of answering it.
let deploy = (slot: Map<string, string>, attempts = true, words = APP) => {
  let vocab = loadVocab([platform(attempts), words])
  let g = graph({ storage: ram(vocab), vocab })
  let door = api({ graph: g })
  let heard: string[] = []
  let recalled = recalling(
    answers({
      read: () => slot.get('answered') ?? null,
      write: (v) => void slot.set('answered', v),
    }),
    (e) => heard.push(`${(e as Error).name}: ${(e as Error).message}`),
    (work) => work(),
  )
  let held = [JSON.stringify(words), '']
  let status = async (r: Response) => (await r.text(), r.status)
  let ask = async (line: string) =>
    status(
      await recalled(
        held,
        line,
        () =>
          door(
            new Request(`http://store/query?q=${encodeURIComponent(line)}`),
          ),
      ),
    )
  let read = (line: string) =>
    recalled(held, line, async () => json(await g.read(line)))
      .then(status, (e: Error) => e.name)
  return { ask, read, heard, recalled, held }
}

let ATTEMPTS = '.effect.attempts=0'

test('a line answered before and refused after a deploy is ours', async () => {
  let slot = new Map<string, string>()
  let before = deploy(slot)
  equal(await before.ask(ATTEMPTS), 200)
  equal(await before.ask(ATTEMPTS), 200)
  equal(before.heard, [])
  let after = deploy(slot, false)
  equal(await after.ask(ATTEMPTS), 400, 'the caller hears the refusal')
  equal(after.heard, [
    'Regressed: a query this store answered before is refused: ' +
    'unknown property: effect.attempts — effect has handler (string)',
  ])
  equal(await after.read(ATTEMPTS), 'Unknown', 'thrown, it is the same')
  equal(after.heard.length, 2)
})

test("a refusal of a line never answered is the caller's", async () => {
  let slot = new Map<string, string>()
  let before = deploy(slot)
  equal(await before.ask('.recipe.title=soup'), 200)
  let after = deploy(slot, false)
  equal(await after.ask(ATTEMPTS), 400)
  equal(await after.ask('.recipe.titel=soup'), 400)
  equal(await after.ask('.recipe.title=soup'), 200)
  equal(after.heard, [])
})

test("a line the app's own new words refuse is the app's", async () => {
  let slot = new Map<string, string>()
  equal(await deploy(slot).ask('.recipe.title=soup'), 200)
  let renamed = deploy(slot, true, app('name'))
  equal(await renamed.ask('.recipe.title=soup'), 400)
  equal(renamed.heard, [])
})

test('a new line is kept once its answer has been read', async () => {
  let slot = new Map<string, string>()
  let { recalled, held } = deploy(slot)
  let answer = await recalled(held, '.recipe', () => json([]))
  equal(slot.has('answered'), false, 'the answer does not wait on the write')
  await answer.text()
  equal(JSON.parse(slot.get('answered')!).lines.length, 1)
  let again = await recalled(held, '.recipe', () => json([]))
  slot.delete('answered')
  await again.text()
  equal(slot.has('answered'), false, 'a line it holds is not written again')
})

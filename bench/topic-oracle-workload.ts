// A small public research corpus and question sequence exercise query-driven
// topic growth. Evidence is read from the toolkit's own documentation, while
// judgement criteria are supplied separately and never become model context.
import { derivedEid } from '@yaks/graph/identity'
import { snapshot } from '@yaks/context'
import type { Bundle } from '@yaks/graph'
import type { TopicCase } from './topic-oracle.ts'

export let topicCases: TopicCase[] = [{
  id: 'patch',
  text:
    'In a yaks app, how do I clear one saved value while keeping the other values on that entity?',
  followups: ['And how do I remove the whole component?'],
}, {
  id: 'concurrency',
  text:
    'How can my editor avoid overwriting a change someone made since I read the entity?',
  followups: ['What exactly should the precondition identify?'],
}, {
  id: 'reuse',
  text:
    'In a local toolkit script, how do I clear one property while preserving its siblings? Please cite the source.',
}, {
  id: 'deletion',
  text:
    'If an old editor races with deleting an entity, can its old write bring the entity back? How does a later deliberate edit differ?',
}, {
  id: 'optimistic-refusal',
  text:
    'How does a client find out why an optimistic write was refused and whether it was reverted?',
}, {
  id: 'preference',
  text:
    'For this experiment, my synthetic app is called Cedar. Its preferred display unit is inches. Please remember that under its topic.',
}, {
  id: 'preference-update',
  text:
    'Correction: Cedar should display centimetres. Please update its retained context from this correction.',
}, {
  id: 'preference-reuse',
  text: 'What unit should Cedar display?',
}, {
  id: 'unknown',
  text: 'How much electricity did my household use yesterday?',
}]

export let topicCorpus = async (): Promise<Bundle[]> =>
  await Promise.all(['graph', 'sync'].map(async (pkg) => {
    let path = `packages/${pkg}/README.md`
    let body = await Deno.readTextFile(new URL(`../${path}`, import.meta.url))
    let source = await snapshot(body, path)
    return {
      entity: { eid: derivedEid(`topic corpus|${path}|${source.revision}`) },
      doc: { title: path, body },
    }
  }))

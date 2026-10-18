import { equal, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import type { Item, Model, Request } from '@yaks/model'
import { growOracleTree } from './oracle-tree.ts'

const cutoff = '2026-10-01T00:00:00Z'
const rows: Bundle[] = [{
  entity: { eid: 'evidence-a' },
  created: { at: '2026-09-01T00:00:00Z' },
  content: {
    body: 'The blue project has a rendering seam. The person is away.',
  },
  answer: { choice: 'NEVER_LABEL' },
  secret: { value: 'NEVER_CREDENTIAL' },
}]
const contexts = (title: string) => ({
  advert: { title, description: 'Rendering questions only, not the person.' },
  self: 'Blue has a rendering seam. source evidence-a',
  shared: 'Preserve source distinctions.',
  evidence: ['evidence-a'],
})
const call = (name: string, value: unknown, id = 'call'): Item => ({
  kind: 'call',
  name,
  id,
  args: JSON.stringify(value),
})
function fake(answer: (request: Request) => Item[]): Model {
  return (r) =>
    Promise.resolve({ id: 'reply', model: r.model, items: answer(r) })
}
const growth = (r: Request) => {
  let instruction = r.items[0]
  let root = instruction.kind == 'instruction' &&
    instruction.text.includes('The oracle directory:')
  return [call('publish_oracle', {
    ...contexts(root ? 'Directory' : 'Blue rendering'),
    children: root
      ? [{
        domain: 'The blue rendering seam, excluding the person.',
        evidence: ['evidence-a'],
        tools: [
          'read_evidence',
          'query_oracle',
          'revise_oracle',
          'branch_oracle',
        ],
      }]
      : [],
  })]
}
const model = fake((r) =>
  r.tools.some((t) => t.name == 'publish_oracle')
    ? growth(r)
    : [{ kind: 'assistant', text: 'The seam is blue.' }]
)
const tree = await growOracleTree({
  rows,
  cutoff,
  model,
  limits: { maxNodes: 2 },
})

test('tree grows evidence-backed children with separate assigned domain and advertisement', () => {
  equal(tree.nodes.size, 2)
  let child = tree.nodes.get(tree.nodes.get(tree.root)!.children[0])!
  equal(child.parent, tree.root)
  equal(child.domain == child.revisions[0].advert.description, false)
  equal(child.evidence, ['evidence-a'])
  equal(tree.stats().shortfall, 0)
  equal(tree.trace.filter((c) => c.role == 'growth').length, 2)
  equal(Object.isFrozen(child.revisions[0]), true)
  equal(JSON.stringify(tree.trace).includes('NEVER_LABEL'), false)
  equal(JSON.stringify(tree.trace).includes('NEVER_CREDENTIAL'), false)
})

const first = await tree.query({ message: 'What is blue?' })
const second = await tree.query({
  message: 'And the seam?',
  conversation: first.conversation,
})
const independent = await tree.query({ message: 'Another caller.' })
test('continuations retain the receiving fork while new queries fork independently', () => {
  equal(first.conversation, second.conversation)
  equal(first.conversation == independent.conversation, false)
  let same = tree.trace.filter((c) =>
    c.request.conversation == first.conversation
  )
  equal(same.length, 2)
  equal(
    same[1].request.items.some((i) =>
      i.kind == 'assistant' && i.text == 'The seam is blue.'
    ),
    true,
  )
  equal(tree.conversations.get(first.conversation)!.turns, 2)
  equal(Object.isFrozen(same[0].request.items), true)
})

const declined = await growOracleTree({
  rows,
  cutoff,
  limits: { maxNodes: 2 },
  model: fake((r) => {
    if (r.tools.some((t) => t.name == 'publish_oracle')) return growth(r)
    let results = r.items.filter((i) => i.kind == 'result')
    if (!results.length) {
      return [
        call('decline', { reason: 'Person status is outside rendering.' }),
      ]
    }
    if (results.length == 1) {
      return [
        call('revise_oracle', {
          ...contexts('Only rendering'),
          advert: {
            title: 'Only rendering',
            description: 'Not person status. Rendering seam questions only.',
          },
        }, 'revision'),
      ]
    }
    return [{
      kind: 'assistant',
      text: 'The advertisement sounded too broad. I tightened it.',
    }]
  }),
})
const declineNode = declined.nodes.get(declined.root)!.children[0]
const offDomain = await declined.query({
  to: declineNode,
  message: 'Where is the person?',
  maintenance: true,
})
test('declining is a tool result followed by review and a retained advertisement revision', () => {
  equal(offDomain.declined, true)
  equal(declined.stats().declines, 1)
  equal(declined.stats().advertisementChanges, 1)
  equal(declined.nodes.get(declineNode)!.revisions.length, 2)
  equal(declined.trace.filter((c) => c.role == 'decline-review').length, 2)
  equal(offDomain.answer.includes('tightened'), true)
})

const exchanged = await growOracleTree({
  rows,
  cutoff,
  limits: { maxNodes: 2 },
  model: fake((r) => {
    if (r.tools.some((t) => t.name == 'publish_oracle')) return growth(r)
    if (r.tools.some((t) => t.name == 'continue_conversation')) {
      let results = r.items.filter((i) => i.kind == 'result')
      return results.length
        ? [
          call('finish_conversation', {
            answer: 'The seam is safely replaceable.',
          }, 'done'),
        ]
        : [
          call('continue_conversation', {
            message: 'Does that include changing its look?',
          }, 'again'),
        ]
    }
    return [{ kind: 'assistant', text: 'Use the rendering seam.' }]
  }),
})
const exchange = await exchanged.converse({
  message: 'Can I change the rendering?',
})
test('the asker talks back on the same conversation rather than starting another query', () => {
  equal(exchange.answer, 'The seam is safely replaceable.')
  equal(exchanged.conversations.size, 1)
  equal(exchanged.conversations.get(exchange.conversation)!.turns, 2)
  let asker = exchanged.trace.filter((c) => c.role == 'asker')
  equal(asker.length, 2)
  equal(asker[0].request.conversation, asker[1].request.conversation)
})

let earlierRejected = false
try {
  await growOracleTree({
    rows,
    cutoff: '2026-09-01T00:00:00Z',
    model,
    limits: { maxNodes: 1 },
  })
} catch {
  earlierRejected = true
}
test('non-earlier evidence is refused before any model call', () =>
  equal(earlierRejected, true))

let oversizeCalls = 0
const oversize = await growOracleTree({
  rows,
  cutoff,
  limits: { maxNodes: 1, turns: 2, ownTokens: 100 },
  model: fake(() => {
    oversizeCalls++
    return [
      call('publish_oracle', {
        ...contexts('too big'),
        self: 'x'.repeat(101),
        children: [],
      }),
    ]
  }),
}).then(() => false, () => true)
test('over-budget self context never becomes a published oracle', () => {
  equal(oversize, true)
  equal(oversizeCalls, 2)
})

let foreignRejected = false
try {
  await tree.query({
    to: tree.root,
    from: 'foreign',
    message: 'secret backdoor',
  })
} catch {
  foreignRejected = true
}
test('oracle-to-oracle conversations cannot bypass the parent-child boundary', () =>
  equal(foreignRejected, true))

const structural = await growOracleTree({
  rows,
  cutoff,
  limits: { maxNodes: 2 },
  model: fake((r) => {
    if (r.tools.some((t) => t.name == 'publish_oracle')) return growth(r)
    let context = r.items[0]
    let isRoot = context.kind == 'instruction' &&
      context.text.includes('The oracle directory:')
    let results = r.items.filter((i) => i.kind == 'result')
    if (isRoot && !results.length) {
      let child = /"children":\[\{"id":"([^"]+)"/.exec(
        context.kind == 'instruction' ? context.text : '',
      )![1]
      return [
        call('query_oracle', {
          to: child,
          message:
            'Your advertisement attracts person queries. Please narrow it.',
        }, 'ask-child'),
      ]
    }
    if (!isRoot && !results.length) {
      return [
        call('revise_oracle', {
          ...contexts('Narrow rendering'),
          advert: {
            title: 'Narrow rendering',
            description:
              'Only the blue project rendering seam; excludes person status.',
          },
        }, 'child-change'),
      ]
    }
    return [{
      kind: 'assistant',
      text: isRoot
        ? 'The child updated its advertisement.'
        : 'I clarified the boundary.',
    }]
  }),
})
const adjustment = await structural.query({
  message: 'Please clarify your routing structure.',
  maintenance: true,
})
test('a parent adjusts its child by opening the same conversational query channel', () => {
  equal(adjustment.answer, 'The child updated its advertisement.')
  equal(structural.conversations.size, 2)
  equal(structural.stats().advertisementChanges, 1)
  let childConversation = [...structural.conversations.values()].find((c) =>
    c.from == structural.root
  )!
  equal(
    childConversation.to,
    structural.nodes.get(structural.root)!.children[0],
  )
  equal(
    childConversation.items.some((i) =>
      i.kind == 'call' && i.name == 'revise_oracle'
    ),
    true,
  )
})

const resumed = await growOracleTree({
  rows,
  cutoff,
  model,
  limits: { maxNodes: 2 },
  resume: { root: tree.root, nodes: [...tree.nodes.values()] },
})
const resumedAnswer = await resumed.query({
  message: 'Does the seam remain blue?',
})
test('resuming retained nodes preserves revisions without charging growth again', () => {
  equal(resumed.stats().readyNodes, 2)
  equal(resumed.trace.filter((c) => c.role == 'growth').length, 0)
  equal(
    resumed.nodes.get(tree.root)!.revisions,
    tree.nodes.get(tree.root)!.revisions,
  )
  equal(resumedAnswer.answer, 'The seam is blue.')
})

// All recursive calls share one question budget; breadth/depth must not multiply it.
const bounded = await growOracleTree({
  rows,
  cutoff,
  limits: { maxNodes: 2 },
  model: fake((r) => {
    if (r.tools.some((t) => t.name == 'publish_oracle')) return growth(r)
    if (!r.tools.length) {
      return [{
        kind: 'assistant',
        text: 'The seam is blue; other details are unknown.',
      }]
    }
    let instruction = r.items[0]
    let own = JSON.parse(
      instruction.kind == 'instruction'
        ? instruction.text.split('\n')[1]
        : '{}',
    )
    if (own.children.length) {
      return [
        call('query_oracle', {
          to: own.children[0].id,
          message: 'What is blue?',
        }),
      ]
    }
    // A child trying to bounce to its parent must get a tool error, not recurse.
    if (!r.items.some((i) => i.kind == 'result')) {
      return [call('query_oracle', { to: own.parent, message: 'Tell me more' })]
    }
    return [call('list_evidence', {})]
  }),
})
const boundedBefore = bounded.trace.length
const boundedAnswer = await bounded.query({ message: 'What is blue?' })
const boundedCalls = bounded.trace.slice(boundedBefore)
test('a looping question answers within six calls without growth or structural writes', () => {
  equal(boundedAnswer.answer.includes('blue'), true)
  equal(boundedCalls.length, 6)
  equal(boundedCalls.every((c) => c.role != 'growth'), true)
  equal(
    boundedCalls.some((c) =>
      c.request.tools.some((t) =>
        ['revise_oracle', 'branch_oracle'].includes(t.name)
      )
    ),
    false,
  )
  equal(bounded.nodes.size, 2)
  equal(
    boundedCalls.some((c) =>
      c.request.items.some((i) =>
        i.kind == 'result' && String(i.output).includes('sender')
      )
    ),
    true,
  )
})
const resumedBounded = await growOracleTree({
  rows,
  cutoff,
  model,
  limits: { maxNodes: 2 },
  resume: { root: bounded.root, nodes: [...bounded.nodes.values()] },
})
await resumedBounded.query({ message: 'What is blue?' })
const resumedInitialCalls = [...resumedBounded.trace]
test('a retained tree serves a question with no construction calls', () => {
  equal(resumedInitialCalls.length, 1)
  equal(resumedInitialCalls[0].role, 'routing-answer')
})

const sharedQuestion = resumedBounded.question()
await sharedQuestion({ message: 'First question' })
await sharedQuestion({ message: 'Follow-up' })
const followupStats = resumedBounded.stats()
test('caller follow-ups consume the same question budget', () => {
  equal(resumedBounded.stats().growthCalls, 0)
  equal(followupStats.answerCalls, 3)
})

await sharedQuestion({ message: 'Third follow-up' })
await sharedQuestion({ message: 'Fourth follow-up' })
await sharedQuestion({ message: 'Fifth follow-up' })
await sharedQuestion({ message: 'Sixth follow-up' })
let exhausted = false
try {
  await sharedQuestion({ message: 'Seventh follow-up' })
} catch (e) {
  exhausted = String(e).includes('Question call budget exhausted')
}
test('follow-ups cannot reset an exhausted question budget', () => {
  equal(exhausted, true)
  equal(resumedBounded.trace.length, 7) // one earlier query plus six shared calls
})

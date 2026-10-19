// These are external judgements, never inputs to the native topic workload.
// Source paths name the corpus documents; input:<case> names exact user text.
export let topicRubric = [{
  case: 'patch',
  evidence: ['packages/graph/README.md'],
  criteria: [
    'Null clears a property; omitted sibling properties remain unchanged.',
    'The follow-up distinguishes removing a component from clearing a property.',
  ],
}, {
  case: 'concurrency',
  evidence: ['packages/graph/README.md'],
  criteria: [
    'The answer uses per-property $was hashes of the values read.',
    'A changed precondition refuses the whole batch rather than overwriting it.',
  ],
}, {
  case: 'reuse',
  evidence: ['packages/graph/README.md', 'input:patch'],
  criteria: [
    'The same patch semantics apply in a local script and in a web app.',
    'The existing subject and learned context are reused rather than duplicated.',
  ],
}, {
  case: 'deletion',
  evidence: ['packages/graph/README.md'],
  criteria: [
    'A guarded write racing deletion is dropped; a later deliberate write can revive the entity.',
  ],
}, {
  case: 'optimistic-refusal',
  evidence: ['packages/sync/README.md'],
  criteria: [
    'The report callback exposes the refusal or transport error and whether the optimistic write was reverted.',
  ],
}, {
  case: 'preference',
  evidence: ['input:preference'],
  criteria: [
    'The synthetic app preference is retained with the source words and a focused topic.',
  ],
}, {
  case: 'preference-update',
  evidence: ['input:preference-update'],
  criteria: [
    'Later contexts reflect centimetres; the earlier source and admitted conversations remain available.',
  ],
}, {
  case: 'preference-reuse',
  evidence: ['input:preference-update'],
  criteria: [
    'The answer uses the correction and reuses the existing app topic.',
  ],
}, {
  case: 'unknown',
  evidence: ['input:unknown'],
  criteria: [
    'The answer admits that household usage is unavailable, without inventing a number.',
  ],
}]

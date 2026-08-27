# Branching frame evaluation

The target evaluator is one persistent, branching computation. The evaluation
tree is the agent: it has one descriptive root and a changing frontier of
unresolved leaves. Providers reduce leaves; they are not durable participants.
There is no agent, persona, team, or delegation ontology inside this model.

This document fixes the architecture vocabulary. The component mapping,
migration, and compatibility design belong to T-23272 after the inventory in
T-23274 and the reduction semantics in T-23275.

## One root, many heads

The evaluation root carries facts: project description, governing architecture,
policy, and invariants. A frame is literal context extending that root or
another frame:

```text
frame {
  parent
  instruction
  at
}
```

`instruction` references an entity that defines an operation such as operate,
plan, implement, or verify. `at` names its subject. Every frame has an explicit
instruction because the same subject may be visited repeatedly for different
operations. A frame does not infer what to do from a task or document.

The path from the root to a frame is its prompt ancestry, not merely execution
bookkeeping. The root says what is true; intermediate frames add relevant facts
and resolved values; the head supplies the immediate prescription. A plan frame
and an implementation frame are specialized branches of the same evaluation, not
different people.

## Stateless reduction

Given a frame, the runtime compiles its root-to-head path and sends that
complete context to any compatible provider. A provider call is one stateless
reduction. Provider, model, effort, executor, time, and cache metadata are facts
about how that frame was evaluated; none supplies identity or continuity.

The compiler preserves stable prefixes without inventing a second inheritance
structure:

1. render shared root facts and description;
2. walk the literal frame path;
3. emit each instruction definition once by entity identity;
4. emit frame targets and resolved inputs;
5. end with the head's short instruction invocation.

Shared ancestry therefore gives sibling frames shared cache prefixes. The
prescription remains last and salient. Branch selection—choosing a frame's
`parent`—is semantic, like branching from a particular commit, not a prompt
reordering heuristic.

## Yielding calls and continuation

Calling another instruction is not delegation and is not an ordinary tool call
that returns into a still-open provider conversation. It yields:

```text
evaluate frame
→ create child call and a waiting continuation
→ end the provider invocation
→ reduce the complete child subtree
→ resume the continuation with its resolved return or unhandled error
```

A child may branch again. The continuation does not become eligible until that
subtree has resolved. Only a typed returned value or an unhandled error joins
the continuation. Child prompts, reasoning, provider history, and transcripts
remain inspectable history but never become inherited context.

From the user's perspective one intelligence notices that planning is needed,
starts planning, and next sees a completed plan. It does not decide whether to
delegate, remember another agent doing the work, or change identity when a
different provider reduces the child.

## Durable authority and restart

The project-rooted `wants` and `requires` tree is the authority for intent and
eligibility. No state needed to continue an evaluation may exist only in a
provider transcript or session summary; those are inspectable history, not the
execution record. After a restart, the evaluator reconstructs the eligible frame
frontier and waiting continuations from graph state instead of reviving a
provider conversation.

The canonical evaluator implementation is Rust. It is project-wanted and begins
only after its route-pruning and evaluator prerequisites are satisfied. The
graph dependency tree, not this prose, owns their exact identities and state.

## The active frontier is the multitude

The active frontier is the set of unresolved leaf frames. Parallel leaves may be
reduced by different providers. Returning prunes a leaf from the frontier while
preserving its durable history. A join resumes from shared literal ancestry plus
resolved child results, never by merging branch transcripts.

The root and shared prefixes preserve oneness; the frontier supplies the
multitude. Specialization changes what the evaluation is doing at a head, not
who the user is talking to.

## Relation to the deployed system

The graph-native runtime currently persists linear session entry partitions and
advances provider generations. D-18439 documents session creation and execution
paths; D-18440 documents the deployed entry/lease state machine. Those remain
the compatibility truth while the branching evaluator is designed and built.
They must not be read as the target identity model: a legacy session is a
single-branch projection, not an agent that owns or works frames.

Ground truth for the originating model is the S-22969 transcript, especially the
discussion beginning with the stateless-frame correction. The build design must
preserve this document's vocabulary rather than translating it back into
session, persona, subagent, or delegation concepts.

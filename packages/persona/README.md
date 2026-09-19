# @yaks/persona

Who is speaking, and what they are for.

- `person` — a human the graph knows, addressed by name.
- `persona{home}` — a voice an agent wears: a doc whose body is the voice, filed
  under the project it speaks for. A governed facet.
- `role{state, surface, scope}` — what an agent wearing a persona is FOR: the
  work it is responsible for, and whether it is running. When it wakes is a
  [@yaks/wake](../wake) `wake` pointed at it, where it works is a
  [@yaks/git](../git) `worktree`, and what it last decided is
  [@yaks/kernel](../kernel)'s `decided` — a role does not keep a second copy of
  any of them.

There is no verify/fix loop here. `verifier`, `fixer`, `finding`, `bug`, `nofix`
and `noverify` were the fleet's review pipeline, and that pipeline is what
stopped things being built; a persona needs none of it.

An agent is not a person. Keeping the two words apart is what makes a byline
(`created.by`) worth reading — and a role is neither: it is a job, which a
persona is hired into.

## Compatibility

Deno and Node — a JSON document, no runtime calls.

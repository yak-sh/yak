# @yaks/persona

Who is speaking, and what they are for.

- `person` — a human the graph knows, addressed by name.
- `persona{home}` — a voice an agent wears: a doc whose body is the voice, filed
  under the project it speaks for. A governed facet.
- `role{state, surface, scope, checkout, schedule, wake_policy, …}` — what an
  agent wearing a persona is FOR: the work it watches, when it wakes, how long
  it waits before trying again, and what it last decided.
- `verifier` / `fixer` — the two roles a check run wears.
- `finding{key, hits, last}` / `bug{fault, hits, last}` — what a check found,
  counted rather than repeated.
- `nofix` / `noverify` — the two waivers, worn by the thing that is exempt.

An agent is not a person. Keeping the two words apart is what makes a byline
(`created.by`) worth reading — and a role is neither: it is a job, which a
persona is hired into.

## Compatibility

Deno and Node — a JSON document, no runtime calls.

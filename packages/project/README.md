# @yaks/project

A portfolio.

- `project` — what work is filed under, addressed by name.
- `filed{project, priority, domain, assignee}` — the filing itself, separate
  from being a task: a microtask carries none.
- `board{query}` — a saved filter over the portfolio. A board IS its query;
  membership is never stored, and the empty query selects nothing.
- `venture{phase, run_mode, …}` — a business being built: a phase, not a status,
  and what it was paused or held from.
- `repo{path, url, base_branch, gate, push}` — a project's source: where its
  checkout is, what work branches from, and how a change is proven and
  published. The git records themselves are [@yaks/git](../git)'s.

The tasks themselves are [@yaks/task](../task)'s; this is what they are filed in
and looked at through.

## Compatibility

Deno and Node — a JSON document, no runtime calls.

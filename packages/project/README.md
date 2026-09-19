# @yaks/project

A portfolio.

- `project` — what work is filed under, addressed by name.
- `filed{project, priority, domain, assignee}` — the filing itself, separate
  from being a task: a microtask carries none.
- `board{query}` — a saved filter over the portfolio. A board IS its query;
  membership is never stored, and the empty query selects nothing.
- `venture{phase, tagline, site}` — a business being built: a phase, not a
  status, because nothing here is done.
- `paused{at}` — work on it is suspended. A mark beside the phase, so the phase
  underneath is untouched and resuming is removing the mark — never a
  `paused_from` column remembering where to put it back.
- `repo{repository, base_branch, gate, push}` — a project's landing policy for
  its source: which repository work is in, what it branches from, and how a
  change is proven and published. The repository, its checkouts and its remote
  are [@yaks/git](../git)'s.

The tasks themselves are [@yaks/task](../task)'s; this is what they are filed in
and looked at through.

## Compatibility

Deno and Node — a JSON document, no runtime calls.

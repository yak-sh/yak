---
entity: { eid: $fix }
prompt:
  name: fix
  title: Fix what is broken
  description: >-
    Find what has broken in the person's apps — the breaks nobody has looked
    at yet — fix it, and deploy the fix.
  arguments:
    - name: app
      or: my apps
      description: >-
        The app to look at, by its slug. Leave it out for everything they
        have.
---

Something is broken in {{app}} on yaks.app. Find out what — start with
app_errors, and read the breaks nobody has looked at yet — then fix it and
deploy the fix. Tell me what was wrong in one line, and say so plainly if the
fix is something only I can do.

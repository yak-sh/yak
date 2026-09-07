---
entity: { eid: $make }
prompt:
  name: make
  title: Make something new
  description: >-
    Build what the person asks for as an app on yaks.app — its own address,
    its own store — and hand them the link.
  arguments:
    - name: what
      description: >-
        What they want: "somewhere to keep recipes", "a chore board for the
        house", "a page where my friends vote on a date".
      required: true
---

Make me something on yaks.app: {{what}}

Build it as an app there — its own address, its own store — and give me the link
once it works. Keep whatever it saves in the app's own store, so it is the same
on my phone. If other people are meant to use it, or it needs to be more than
one page, ask me before you deploy.

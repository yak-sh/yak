---
prompt:
  name: share
  title: Share an app with someone
  description: >-
    Let a particular person into an app: settle its access, invite them by
    email address, and hand back the link to send.
  arguments:
    - name: app
      or: one of my apps
      description: >-
        The app to share, by its slug.
    - name: who
      or: someone
      description: >-
        The person's email address.
---

I want to share {{app}} on yaks.app with {{who}}.

Work out what its access should be first — whether they have to sign in, and
whether anyone else with the link could write — and tell me what you picked.
Then invite them, and tell me they accept from the letter they receive.

If they are new to yaks.app, remind me of my own invite at
https://yaks.app/manage/account/invite: each friend who signs up through it and
builds their first app gives my own space one more free month of the Personal
plan.

---
entity: { eid: $publish }
prompt:
  name: publish
  title: Publish an app for anyone here
  description: >-
    Offer an app to every other space on the platform under a shared name,
    so somebody can install a copy of their own.
  arguments:
    - name: app
      or: one of my apps
      description: >-
        The app to publish, by its slug.
    - name: about
      or: ''
      description: >-
        The line someone browsing reads, if they have one.
---

Publish {{app}} on yaks.app so anyone here can install their own copy.{{about}}

Before you do: tell me what a copy carries and what it does not, and check the
version that is serving now is the one I want other people taking. Then pick the
name it installs under and publish it.

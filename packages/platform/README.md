# @yaks/platform

What a hosting platform keeps about the apps it serves, as one vocabulary
document and nothing else.

`space` is what a customer owns; `app` is what lives in it; `deploy` is one
release of that app and `published` the name it went out under; `hostname` is a
domain pointed at it and `installed` says who took it; `plan` is what is being
paid for, `meter` the reading that bills it; `signin` is a sign-in in flight and
`report` is what broke.

The Worker that serves these is `workers/yak`.

## Compatibility

Deno and Node — a JSON document, no runtime calls.

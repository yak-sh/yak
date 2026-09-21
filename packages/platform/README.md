# @yaks/platform

What a hosting platform keeps about the apps it serves, as one vocabulary
document and nothing else.

`space` is what a customer owns; `app` is what lives in it; `deploy` is one
release of that app, and `published` is the name it was released under;
`hostname` is a domain pointed at it, and `installed` records who copied it;
`plan` is what is being paid for, and `meter` is the usage it is billed on;
`signin` is a sign-in in progress, and `report` is an error a deployed app
reported.

The Worker that serves these is `workers/yak`.

## Compatibility

Deno and Node — a JSON document, with no runtime calls.

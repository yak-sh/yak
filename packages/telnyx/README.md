# @yaks/telnyx

`telnyx({ key, profile, tollFree?, api?, fetch? })` sends SMS or RCS with an SMS
fallback. Without `from`, it discovers a number on the named messaging profile.
`tollFree` chooses the profile's toll-free number. `heard(event)` translates
verified Telnyx events to `Arrival` and `Outcome`. `provider.scheme` selects
@yaks/hook's Ed25519 verification.

`caller({ key, api?, fetch? })` is Call Control for a number whose voice
connection is a Call Control application: `answer` streams the call's audio both
ways as μ-law (PCMU), the telephone's own, so nothing is transcoded; `reject`
and `hangup` end it. `line` reads and writes the media stream's frames. `heard`
answers `ring` for an incoming `call.initiated` and `ended` for `call.hangup`.

[Telnyx messaging API](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks),
[media streaming](https://developers.telnyx.com/docs/voice/programmable-voice/media-streaming)

The `provider` export plugs into [@yaks/phone](../phone/README.md). Credentials
and `fetch` are supplied by the host. Nothing reads the environment.

## As a plugin

`@yaks/telnyx/graph` lends its host the phone `telnyx` (@yaks/phone/plugin
`Phone`), a texter which @yaks/phone selects with `sender: {"via": "telnyx"}`.
The config passes this plugin the sender's options and credentials.
`@yaks/telnyx/routes` serves `POST /telnyx/webhook` when the options carry a
`door: {key}`.

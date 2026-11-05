# @yaks/telnyx

`telnyx({ key, profile, tollFree?, api?, fetch? })` sends SMS or RCS with an SMS
fallback. Without `from`, it discovers a number on the named messaging profile.
`tollFree` chooses the profile's toll-free number. `heard(event)` translates
verified Telnyx events to `Arrival` and `Outcome`. `provider.scheme` selects
@yaks/hook's Ed25519 verification.

[Telnyx messaging API](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks)

The `provider` export plugs into [@yaks/phone](../phone/README.md). Credentials
and `fetch` are supplied by the host. Nothing reads the environment.

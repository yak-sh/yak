# @yaks/voipms

`voipms({ user, key, number?, api?, fetch? })` sends SMS or MMS from a voip.ms
account. `user` is the sign-in email and `key` its API password. `lines()` lists
account numbers; `point(number, url)` updates the SMS callback while preserving
the account's other forwarding settings. `called(query)` translates the callback
to an `Arrival` after the host authenticates its URL.

[voip.ms API](https://voip.ms/m/apidocs.php)

The `provider` export plugs into [@yaks/phone](../phone/README.md). Credentials
and `fetch` are supplied by the host. Nothing reads the environment.

## As a plugin

`@yaks/voipms/graph` lends its host the phone `voipms` (@yaks/phone/plugin
`Phone`), a texter which @yaks/phone selects with `sender: {"via": "voipms"}`.
The config passes this plugin the sender's options and credentials.

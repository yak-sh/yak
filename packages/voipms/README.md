# @yaks/voipms

`voipms({ user, key, number?, api?, fetch? })` sends SMS or MMS from a voip.ms
account. `user` is the sign-in email and `key` its API password. `lines()` lists
account numbers, each with whether it texts, its description on the account
(`label`) and its SMS URL callback; `point(number, url?)` updates the SMS
callback, or turns it off without a `url`, while preserving the account's other
forwarding settings. `called(query)` translates the callback to an `Arrival`
after the host authenticates its URL.

[voip.ms API](https://voip.ms/m/apidocs.php)

`numbers({ user, key })` sells local US numbers from our own account
(@yaks/phone `Numbers`): `find` by area code, by state and city (`centersOf`
matches a city to voip.ms's rate centers, "BATTLE CRK" for Battle Creek), by
digits, or any, at voip.ms's price by the minute, each with its `place`;
`buy(number, callback)` makes a sub-account that rings the number and calls out
as it, orders the number onto it, and sends its texts to `callback`; `release`
cancels the number and removes its sub-account; `login(number)` is the
sub-account's SIP sign-in for a softphone. voip.ms sells no toll-free number
here, so `verify` refuses.

The `provider` export plugs into [@yaks/phone](../phone/README.md). Credentials
and `fetch` are supplied by the host. Nothing reads the environment.

## As a plugin

`@yaks/voipms/graph` lends its host the phone `voipms` (@yaks/phone/plugin
`Phone`), a texter which @yaks/phone selects with `sender: {"via": "voipms"}`.
The config passes this plugin the sender's options and credentials.
`@yaks/voipms/routes` is the callback door, `GET /voipms/<door.key>`, where a
number whose SMS URL callback points brings the texts that arrived
(@yaks/phone/plugin `routes`).

```json
[
  {
    "use": "@yaks/voipms",
    "with": {
      "user": { "secret": "VOIPMS_USER" },
      "key": { "secret": "VOIPMS_KEY" },
      "number": "+12695550100",
      "door": { "key": { "secret": "VOIPMS_DOOR" } }
    }
  },
  { "use": "@yaks/phone", "with": { "sender": { "via": "voipms" } } }
]
```

The phone it lends offers `numbers()` from the account the config names; a
config's `sells: ["local"]` says the host buys local numbers through it.

The phone's `own` (@yaks/phone `Own`) is how a person connects a voip.ms number
of their own: the connection fields their sign-in email and API password are
kept in (`username`, `password`), their `Account`, the callback's query and
`called`.

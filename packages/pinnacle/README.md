# @yaks/pinnacle

`pinnacle({ key, number, api?, fetch? })` sends SMS through
`POST /messages/send/sms`, or RCS through `POST /messages/send/rcs` with an SMS
fallback when the text names an `agent`. It authenticates requests with
`PINNACLE-API-KEY` and returns the opaque `messageId` as a phone receipt. A 401
or 403 rejects with `Denied`; network failures, 429 and 5xx responses reject
with `Unsent`; other errors are reported as failures.

`heard(event)` translates inbound SMS, MMS, RCS text and button replies to
`Arrival`. Terminal delivery updates become `Outcome`; queued, pending and sent
updates do not settle a message. Fallback outcomes name their original message.
All consent and keyword handling belongs to @yaks/phone.

Pinnacle's documented webhook verification compares the
`PINNACLE-SIGNING-SECRET` header with a webhook's secret, before parsing JSON.
`provider.scheme` supplies that scheme to @yaks/hook. This is bearer-secret
authentication, with no signed body or timestamp.

[Send SMS](https://docs.pinnacle.sh/api-reference/messages/send-sms),
[Send RCS](https://docs.pinnacle.sh/api-reference/messages/send-rcs),
[Message events](https://docs.pinnacle.sh/webhooks/message-events),
[Webhook authentication](https://docs.pinnacle.sh/guides/messages/receiving).

The `provider` export plugs into [@yaks/phone](../phone/README.md). Credentials
and `fetch` are supplied by the host. Nothing reads the environment.

## As a plugin

`@yaks/pinnacle/graph` lends its host the texter `pinnacle`, which @yaks/phone
selects with `sender: {"via": "pinnacle"}`. The config passes this plugin the
sender's options and credentials. `@yaks/pinnacle/routes` serves
`POST /pinnacle/webhook` when the options carry a `door: {key}`.

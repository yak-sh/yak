# Messages

Texting for the church, beside the Church Directory in this space. The people
are the directory's `individual` rows: never copy them here. Lists are
`group{}` + `doc{title}`, and `membership{group, person}` puts a directory
person on one. Sending is a `text{}` + `doc{body}` + `deliver{to}` row per
person; `broadcast{group}` + `doc{body}` is the message, and each text carries
`copy{broadcast}`. Replies arrive as `text{from, to, at}` rows.

- Only add someone to a list when they asked for the church's texts: adding
  records their agreement (`sms_consent`) in the church's words.
- Someone who texted STOP is never put back; they text START themselves.
- Every text begins with the church's name.
- The source is in git (apps/messages); edit it there, not here.

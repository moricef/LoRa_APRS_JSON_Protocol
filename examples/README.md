# Protocol examples

`lora-aprs-json-stream.ndjson` is one coherent producer-to-client stream. Its
first record is `hello`; the following `rx` is the next live reception.

`lora-aprs-json-sequence-stream.ndjson` is a coherent live stream containing
three receptions. It exercises sequence start, continuity, ordering, unique
event identifiers, a stable boot identifier, and monotonic uptime.

`lora-aprs-json-resume-stream.ndjson` models a successful `?after=` exchange:
the records through the `hello.latest_sequence` boundary are replayed before a
new live reception. `lora-aprs-json-gap-stream.ndjson` models an unavailable
cursor followed by a live reception after the announced boundary.

`lora-aprs-json-vectors.ndjson` is a collection of independent positive test
vectors covering every event type. It is not a chronological stream: records
from both protocol directions are adjacent, and sequence/history values on one
line do not establish state for another line. It also includes an independent
`NN7LE-GS` reception demonstrating an opaque alphanumeric address suffix and a
TNC2-compatible non-APRS keyboard packet carrying normal RXT metadata.

All five files are consumed by `../validate_protocol.cjs`. From the repository
root, install the declared development dependencies and run:

```sh
npm ci
npm test
```

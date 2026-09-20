# Protocol examples

`lora-aprs-json-stream.ndjson` is one coherent producer-to-client stream. Its
first record is `hello`; the following `rx` is the next live reception.

`lora-aprs-json-vectors.ndjson` is a collection of independent positive test
vectors covering every event type. It is not a chronological stream: records
from both protocol directions are adjacent, and sequence/history values on one
line do not establish state for another line.

Both files are consumed by `../validate_protocol.cjs`. From the repository
root, install the declared development dependencies and run:

```sh
npm install
npm test
```

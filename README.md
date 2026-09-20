# LoRa APRS JSON Protocol

LoRa APRS JSON is a versioned event protocol for carrying APRS packets and
LoRa reception metadata from a receiver, iGate, or digipeater to applications
such as mapping clients, diagnostic tools, and station software.

The protocol uses newline-delimited JSON (NDJSON) over HTTP. It preserves the
exact received packet bytes while exposing optional parsed APRS data and
receiver-specific metadata such as local radio measurements and an RXT relay
chain.

## Status

Schema version 1.0 is a validated implementation candidate for the transport
and event model. It is not yet a deployed interoperability standard.

The next validation stage requires an actual firmware producer, an independent
consumer, reconnect and history tests, and captures of real Mic-E and multi-hop
RXT traffic. See [VALIDATION.md](VALIDATION.md) for the detailed status.

## Design goals

- Preserve every received packet byte, including binary Mic-E information.
- Keep station identities as strings without imposing the AX.25 SSID 0–15
  limit on application data.
- Transport malformed, unsupported, and future APRS content without loss.
- Keep clean APRS packet data separate from local LoRa and RXT metadata.
- Support continuous streaming, loss detection, and bounded history replay.
- Allow consumers to adopt the protocol incrementally, starting with the
  authoritative TNC2 byte copy.

## Repository contents

- [LORA_APRS_JSON_PROTOCOL.md](LORA_APRS_JSON_PROTOCOL.md) — normative protocol
  specification.
- [schema/lora-aprs-json-v1.schema.json](schema/lora-aprs-json-v1.schema.json) —
  JSON Schema Draft 2020-12 for schema version 1.0.
- [examples/lora-aprs-json-stream.ndjson](examples/lora-aprs-json-stream.ndjson)
  — one coherent producer-to-client stream.
- [examples/lora-aprs-json-vectors.ndjson](examples/lora-aprs-json-vectors.ndjson)
  — independent positive vectors covering every event type.
- [examples/README.md](examples/README.md) — distinction between stream examples
  and independent vectors.
- [validate_protocol.cjs](validate_protocol.cjs) — executable schema and
  semantic validation suite.

## Event model

`rx` is the only replayable reception event. It carries the persistent
`event_id` and per-boot `sequence` used for deduplication, gap detection, and
history replay.

`hello`, `heartbeat`, and `gap` are connection-control events. They do not
consume reception sequence numbers. `error`, `tx_request`, and `tx_result` are
also non-replayable.

Each record declares both:

- `protocol_version`: the compatibility family, currently `"1"`;
- `schema_version`: the exact record schema, currently `"1.0"`.

## Minimal consumer

A minimal application can:

1. Open `GET /api/v1/aprs/stream` with `Accept: application/x-ndjson`.
2. Read one JSON object per line.
3. Process `rx` events.
4. Decode `packet.raw_tnc2_base64`, or use `packet.tnc2` when present.
5. If `hello` advertises `history_resume`, store the last `event_id` and
   reconnect with `?after=<event_id>`.

Parsed APRS data under `packet.aprs` is optional convenience data. The decoded
bytes in `packet.raw_tnc2_base64` are the authoritative compatibility boundary.
Unknown object members must be ignored.

## Validation

Requirements:

- Node.js
- npm

Install the development dependencies and run the validator:

```sh
npm install
npm test
```

The suite compiles the schema with AJV in strict Draft 2020-12 mode and format
validation enabled. It currently exercises 14 positive and 17 negative
vectors. Semantic checks include Base64 byte equality, APRS compressed position
decoding, DTI offsets, RXT tuple decoding, event identity rules, malformed
packet transport, version rejection, and TX lifecycle constraints.

## Optional transmission

Transmission is disabled unless explicitly configured and authenticated.
Clients submit `tx_request` data with `POST /api/v1/aprs/tx` and obtain the
latest result with `GET /api/v1/aprs/tx/{request_id}`. Request identifiers are
idempotent within an authenticated client scope.

Implementations must also enforce authorization, rate limits, radio duty-cycle
rules, bounded queues, record-size limits, and safe handling of untrusted text.

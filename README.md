# LoRa APRS JSON Protocol

LoRa APRS JSON is a versioned event protocol for carrying APRS packets and
LoRa reception metadata from a receiver, iGate, or digipeater to applications
such as mapping clients, diagnostic tools, and station software.

The protocol uses newline-delimited JSON (NDJSON) over HTTP. It preserves the
exact clean APRS/TNC2 packet bytes, including binary Mic-E information, while
exposing optional parsed APRS data and preserving RF-only Remote Receiver
Telemetry (RXT) metadata separately.

## Status

Schema version 1.0 is a validated implementation candidate for the transport
and event model. It is not yet a deployed interoperability standard.

An actual firmware producer now runs on the LoRa_APRS_iGate
`feature/aprs-json-producer` branch, and Graywolf's `feature/rxt-telemetry`
branch provides an independent consumer. Both sides implement reliable
reconnection: bounded history, heartbeats and gaps on the producer; capability
negotiation, a persistent cursor and `?after=` resume on the consumer. The
repository includes hardware captures of real RXT receptions and the deployed
heartbeat-capable producer.

Remaining validation focuses on duplicate delivery, slow-client and
target-memory limits, and additional RF captures for malformed, blacklisted
and mixed legacy/RXT multi-hop traffic. Binary Mic-E and third-party RF cases,
history resume and unavailable cursors have been exercised end to end. See
[VALIDATION.md](VALIDATION.md) for the detailed status.

## Design goals

- Preserve the exact clean APRS/TNC2 packet bytes, including binary Mic-E
  information, while preserving RF-only RXT metadata separately.
- Keep station identities as strings without imposing the AX.25 SSID 0–15
  limit on application data.
- Represent non-numeric address suffixes as opaque strings without defining a
  fixed suffix namespace; packet and record limits still apply.
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
- [examples/lora-aprs-json-sequence-stream.ndjson](examples/lora-aprs-json-sequence-stream.ndjson)
  — a coherent multi-reception stream used to validate ordering and identity.
- [examples/lora-aprs-json-resume-stream.ndjson](examples/lora-aprs-json-resume-stream.ndjson)
  — a successful bounded-history replay crossing into live reception.
- [examples/lora-aprs-json-gap-stream.ndjson](examples/lora-aprs-json-gap-stream.ndjson)
  — an unavailable cursor followed by live reception.
- [examples/lora-aprs-json-vectors.ndjson](examples/lora-aprs-json-vectors.ndjson)
  — independent positive vectors covering every event type.
- [examples/README.md](examples/README.md) — distinction between stream examples
  and independent vectors.
- [validate_protocol.cjs](validate_protocol.cjs) — executable schema and
  semantic validation suite.
- [FIELD_VALIDATION.md](FIELD_VALIDATION.md) — dated deployed interoperability
  results and links to retained captures.
- [package-lock.json](package-lock.json) — exact dependency graph used for
  reproducible validator installation with `npm ci`.
- [NOTICE](NOTICE) — origin and implementation attribution for RXT.

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
npm ci
npm test
```

The suite compiles the schema with AJV in strict Draft 2020-12 mode and format
validation enabled. It currently exercises 30 positive and 30 negative
vectors. Semantic checks include Base64 byte equality, APRS compressed position
decoding, DTI offsets, address suffix preservation, RXT on non-APRS TNC2 data,
CRC rejection, fresh and resumed stream continuity, replay-boundary coverage,
gap recovery, malformed packet transport, version rejection, and pre-queue TX
validation and lifecycle constraints.

## Optional transmission

Transmission is disabled unless explicitly configured and authenticated.
Clients submit `tx_request` data with `POST /api/v1/aprs/tx` and obtain the
latest result with `GET /api/v1/aprs/tx/{request_id}`. Request identifiers are
idempotent within an authenticated client scope. Packets that are invalid or
unsupported by the configured transport are rejected before queueing with a
stable machine-readable result code.

Implementations must also enforce authorization, rate limits, radio duty-cycle
rules, bounded queues, record-size limits, and safe handling of untrusted text.

## License

This specification, schema, validation code, and examples are licensed under
the [Apache License 2.0](LICENSE). RXT origin and reference-implementation
credits are recorded in [NOTICE](NOTICE).

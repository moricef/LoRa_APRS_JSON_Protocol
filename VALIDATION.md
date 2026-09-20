# Validation status

Validation date: 2026-09-20

The protocol is a validated implementation candidate for its transport and
event model. It is not yet validated as a deployed interoperability standard.

## Implemented interoperability pilot

The receive-side pilot now has two independent implementations:

- LoRa_APRS_iGate `feature/aprs-json-producer` emits the versioned NDJSON
  stream from real LoRa receptions;
- Graywolf `feature/rxt-telemetry` consumes authoritative packet bytes and RXT
  metadata, reconnects after interruption and prevents RF feedback loops.

The captured stream `captures/f4mlv-2-pilot.ndjson` contains the firmware
`hello` record and two real `4.0.2RXT` receptions. Firmware paths examined
during the integration audit also preserve legacy `has_data:false` hops and
transport CRC-valid malformed or blacklisted receptions without admitting
them to APRS-IS, digi, TNC or MQTT processing.

## Automated checks

Run:

```sh
npm ci
npm test
```

Validate one or more captured NDJSON streams with the same schema and semantic
checks:

```sh
node validate_protocol.cjs captures/f4mlv-2-pilot.ndjson
```

The validator compiles the schema as JSON Schema 2020-12 with AJV strict mode
and format validation enabled. It currently checks 22 positive and 28 negative
vectors, including every declared event type.

The executable validator is `validate_protocol.cjs`. The coherent single- and
multi-reception stream examples and the independent event vectors are
described separately in `examples/README.md`.

The checks cover:

- canonical Base64 and exact equality between raw bytes and optional text;
- equality of the information bytes with the bytes after the TNC2 separator;
- DTI byte, text and offset consistency;
- exact opaque address suffix preservation and numeric SSID projection;
- RXT metadata on a TNC2-compatible non-APRS application packet;
- rejection of a CRC-failed observation as an rx event;
- APRS compressed latitude, longitude, symbol table, overlay and comment;
- RXT tuple count, order and metric decoding at the declared SF/BW;
- mixed physical hop chains containing both legacy `has_data:false` and
  measured `has_data:true` hops;
- exact RF packet reconstruction from the clean packet and RXT trailer;
- exact equality of binary and text representations in TX requests;
- pre-queue rejection of a syntactically unusable TNC2 transmission and a
  stable machine-readable rejection code;
- control events without reception sequence identities;
- producer-originated error identity and uptime requirements;
- capability requirements for history resume;
- reception sequence starting at 1, exact continuity, ascending stream order,
  unique event identifiers, stable boot identity and monotonic uptime;
- UTC timestamps, invalid Base64, unknown events and invalid APRS warnings;
- transport of a malformed packet using only its authoritative raw bytes;
- tolerance of unknown optional object members.

The APRS checks were reviewed against APRS Protocol Reference 1.2c. The RXT
checks use the normative `rxt-v1` equations in the protocol specification.
The multi-reception fixture models a fresh live stream. It validates general
ordering invariants but does not simulate the history/resume exchange or prove
replay behavior.

## Corrections made during audit

- `hello`, `heartbeat` and `gap` no longer consume the reception sequence.
- Resume ordering now has an atomic history/live boundary.
- A malformed packet no longer needs fabricated parsed addresses.
- `parse_status` distinguishes a parsed TNC2 envelope from malformed input;
  unsupported APRS decoding remains `packet.aprs.type=unsupported`.
- Canonical Base64 is enforced rather than merely annotated.
- Protocol compatibility and exact schema revision have separate fields.
- Unavailable values are omitted; schema 1.0 does not use null.
- Final TX status has an authenticated polling endpoint and retention rule.
- The exceptional nonzero APRS `!` DTI offset is representable.
- The example's compressed symbol overlay and comment boundary were fixed.
- The example RXT bytes were recalculated from the published measurements.
- RXT tuple shape, hop identity and legacy-hop metric rules are constrained.
- The schema `$id` identifies this repository's canonical raw schema resource.
- Resume cursors remain opaque, and capability absence has defined behavior.
- Address suffixes are opaque strings; numeric SSIDs are optional, consistent
  projections rather than a limit on the identifier namespace.

## Remaining interoperability validation

Before declaring version 1.0 production-proven, complete these steps:

1. Implement producer history replay, then exercise disconnect/resume,
   history expiry and restart cases end to end.
2. Exercise slow-client disconnection and the configured stream queue limits
   on target hardware.
3. Capture real binary Mic-E, malformed, blacklisted, third-party and mixed
   legacy/RXT multi-hop frames and compare every authoritative byte end to end.
4. Verify memory and maximum-record limits on the target hardware.
5. Have a developer not involved in this draft perform an independent review.

`packet.aprs.decoded` remains optional convenience data and deliberately open.
The schema validates its common envelope, not every APRS 1.2c subtype. Exact
clean packet bytes are the normative compatibility boundary; a complete RF
copy is optional.

# Validation status

Validation date: 2026-09-20

The protocol is a validated implementation candidate for its transport and
event model. It is not yet validated as a deployed interoperability standard.

## Automated checks

Run:

```sh
npm install
npm test
```

The validator compiles the schema as JSON Schema 2020-12 with AJV strict mode
and format validation enabled. It currently checks 12 positive and 13 negative
vectors, including every declared event type.

The checks cover:

- canonical Base64 and exact equality between raw bytes and optional text;
- equality of the information bytes with the bytes after the TNC2 separator;
- DTI byte, text and offset consistency;
- APRS compressed latitude, longitude, symbol table, overlay and comment;
- RXT tuple count, order and metric decoding at the declared SF/BW;
- control events without reception sequence identities;
- reception sequence starting at 1;
- UTC timestamps, invalid Base64, unknown events and invalid APRS warnings;
- transport of a malformed packet using only its authoritative raw bytes;
- tolerance of unknown optional object members.

The APRS checks were reviewed against APRS Protocol Reference 1.2c. The RXT
checks use the encoding equations implemented by LoRa_APRS_iGate.

## Corrections made during audit

- `hello`, `heartbeat` and `gap` no longer consume the reception sequence.
- Resume ordering now has an atomic history/live boundary.
- A malformed packet no longer needs fabricated parsed addresses.
- `parse_status` makes parsed, malformed and unsupported input explicit.
- Canonical Base64 is enforced rather than merely annotated.
- Protocol compatibility and exact schema revision have separate fields.
- Unavailable values are omitted; schema 1.0 does not use null.
- Final TX status has an authenticated polling endpoint and retention rule.
- The exceptional nonzero APRS `!` DTI offset is representable.
- The example's compressed symbol overlay and comment boundary were fixed.
- The example RXT bytes were recalculated from the published measurements.
- RXT tuple shape, hop identity and legacy-hop metric rules are constrained.

## Remaining interoperability validation

Before declaring version 1.0 production-proven, complete these steps:

1. Implement one producer in the firmware and one independent consumer.
2. Exercise disconnect/resume, history expiry, restart and slow-client cases.
3. Capture real Mic-E binary, malformed, third-party and RXT multi-hop frames
   and compare every authoritative byte end to end.
4. Verify memory, queue and record limits on the target hardware.
5. Have a developer not involved in this draft perform an independent review.

`packet.aprs.decoded` remains optional convenience data and deliberately open.
The schema validates its common envelope, not every APRS 1.2c subtype. Exact
raw packet bytes are the normative compatibility boundary.

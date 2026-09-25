# Field validation record

This file records deployed producer/consumer interoperability tests. Raw
protocol evidence is stored under `captures/`; `VALIDATION.md` remains the
summary of validation status and outstanding work.

## 2026-09-25: history resume and gap handling

### Setup

- producer: LoRa_APRS_iGate `F1ZDB-10`, firmware `4.0.2RXT`;
- consumer: Graywolf `feature/rxt-telemetry`;
- transport: versioned NDJSON stream through the deployed HTTP endpoint;
- producer boot: `fb52a5a9`;
- retained history: 10 reception events;
- maximum advertised record size: 4096 bytes.

### Successful disconnect and resume

Graywolf's persisted cursor for this producer was `fb52a5a9:2970` before the
test. Graywolf was stopped at 12:20:43 CEST. While it was disconnected, a
controlled RF status frame was transmitted from `F4MLV-2` and received by the
producer as event `fb52a5a9:2973`:

```text
F4MLV-2>APGRWO,F4MLV-10,F4JQT-4*:>GWVAL replay A 20260925
```

Graywolf was restarted at 12:22:09 CEST. It reconnected with its persisted
cursor, consumed the retained reception, and advanced the stored cursor to
`fb52a5a9:2974`. Graywolf advances this cursor only after its preservation
handler accepts the reception. The captured reception is stored in
`captures/f1zdb-10-history-resume-rx.ndjson`.

### Unavailable cursors

A request after `fb52a5a9:1` returned `hello` followed by a `gap` whose reason
was `history_expired`; the producer reported the available range as
`fb52a5a9:2966` through `fb52a5a9:2975`. A request after
`fb52a5a9:99999999` returned `hello` followed by `gap` with reason
`unknown_event`. The two exchanges are stored in
`captures/f1zdb-10-gap-history-expired.ndjson` and
`captures/f1zdb-10-gap-unknown-event.ndjson`.

Deployed Graywolf logs from the same day also record consumer handling of
both `history_expired` and `different_boot` gaps. These observations cover
history expiry and producer restart handling without changing protocol data.

### Queue bound

On the deployed producer, requesting
`GET /api/v1/aprs/events?limit=999999` returned exactly 10 events, confirming
the configured snapshot/history bound on target hardware. Slow-client socket
disconnection and target heap behavior remain separate stress tests.

## 2026-09-25: RF special cases through F4MLV-15

Graywolf transmitted a controlled third-party frame from `F4MLV-2`; the
F4MLV-15 producer received it as event `e21b5d29:159` with byte-exact packet
data and local RF measurements. This validates the third-party transport case
over RF.

The first controlled binary Mic-E `0x1c` reception exposed a producer defect:
the control byte was copied into optional JSON text fields and made the NDJSON
record invalid. Producer commit `91777ec` corrected the boundary by retaining
binary packet and information bytes in Base64, retaining `dti_hex`, and
omitting unsafe optional text projections.

The corrected firmware was built for `ttgo-lora32-v21`, installed over OTA on
F4MLV-15, and restarted with boot identifier `83fb7876`. Graywolf transmitted
the same byte sequence again:

```text
F4MLV-2>4R5WV3,WIDE1-1:<0x1c>w25l*o[/"=?}
```

F4MLV-15 received it directly as event `83fb7876:2` at -58 dBm and 8 dB SNR,
then received the F4MLV-10 digipeated copy with RXT as event `83fb7876:3`.
Both records are valid JSON, preserve the exact information bytes as
`HHcyNWwqb1svIj0/fQ==`, and report `dti_hex: "1c"` without unsafe text fields.
Graywolf consumed the stream and advanced its persisted cursor through
`83fb7876:3`. The captured replay is stored in
`captures/f4mlv-15-mice-binary-rx.ndjson`.

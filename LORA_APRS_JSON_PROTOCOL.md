# LoRa APRS JSON Event Protocol

Status: draft 1.0

Protocol identifier: lora-aprs-json

Schema: [lora-aprs-json-v1.schema.json](schema/lora-aprs-json-v1.schema.json)

## 1. Purpose

This protocol carries APRS packets and LoRa reception metadata between a
LoRa APRS receiver, iGate or digipeater and an application. It is intended
for applications such as Graywolf, YAAC, PinPoint and diagnostic tools that
need more information than a KISS or TNC2 connection can provide.

The protocol does not redefine APRS. APRS decoding follows the APRS Protocol
Reference 1.2c. JSON exposes decoded values for convenience while retaining
an exact copy of every received packet.

The design has four mandatory properties:

1. Packets can be recovered without loss, including binary Mic-E data.
2. Station identities are strings and are not restricted to AX.25 SSIDs 0–15.
3. APRS content and receiver-specific LoRa/RXT metadata remain separate.
4. Unknown, malformed and future APRS formats remain transportable.

## 2. Conformance

The terms MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are normative.

A producer conforms to schema version 1.0 when it emits schema-valid events and
follows the transport and ordering rules below. Schema validation alone does
not establish conformance: relationships between byte copies, identifiers and
stream order are also normative. Consumers MUST ignore unknown object members
in records whose declared schema_version they support. This rule does not opt
the consumer into a later schema version; Section 11 defines version handling.

## 3. Representation

- Text is UTF-8 JSON.
- One stream record is one JSON object on one physical line.
- Unit-bearing names use explicit suffixes such as _dbm, _db, _hz, _ms,
  _m, _mps, _deg, _c, _hpa and _pct.
- Unknown, unavailable or inapplicable information is omitted. null MUST NOT
  be emitted unless a field explicitly allows it; schema 1.0 has no such field.
- Address text preserves what was received.
- An SSID is a non-negative JSON integer with no AX.25-derived maximum.
  Producers MUST NOT reject F4JJE-16 because AX.25 cannot represent it. The
  complete address remains available in text for implementations whose native
  integer range is narrower than an incoming value.

### Exact packet preservation

packet.raw_tnc2_base64 is authoritative: it contains the exact clean TNC2-form
packet bytes without trailing CR or LF. It is required on every rx event. Its
decoded bytes MUST equal the UTF-8 encoding of packet.tnc2 when packet.tnc2 is
present. packet.information.raw_base64, when present, MUST equal the bytes
following the first colon in packet.raw_tnc2_base64. The first colon is the
header/data separator; later colons belong to the information field.

packet.tnc2 is the human-readable form and SHOULD be present when those bytes
are valid UTF-8. packet.information.raw_base64 preserves every byte following
the first colon. This is required for Mic-E and other binary fields.

Base64 strings use canonical RFC 4648 encoding. Implementations MUST validate
them even when their JSON Schema library treats contentEncoding as annotation.
Likewise, implementations MUST validate RFC 3339 timestamps and MUST NOT rely
on a validator which has format checking disabled.

The RF-only RXT trailer is stored separately in reception.rxt.raw. The clean
packet does not contain it. packet.rf_tnc2_base64 MAY preserve the exact RF
form including the trailer. When rf_tnc2_base64 and reception.rxt are both
present, the decoded RF bytes MUST equal the decoded raw_tnc2_base64 bytes,
followed immediately by ASCII `{`, the ASCII bytes of reception.rxt.raw, and
ASCII `}`. When rf_tnc2_base64 is present without reception.rxt, its decoded
bytes MUST equal raw_tnc2_base64 exactly.

## 4. Event envelope and identity

Every event contains protocol, protocol_version, schema_version and event.
protocol_version identifies the compatibility family; schema_version selects
the exact schema used to validate the record. Only replayable reception events
have a persistent identity:

    {
      "protocol": "lora-aprs-json",
      "protocol_version": "1",
      "schema_version": "1.0",
      "event": "rx",
      "event_id": "8f3a2c10:1842",
      "boot_id": "8f3a2c10",
      "sequence": 1842,
      "created_at": "2026-09-20T12:34:56.421Z",
      "uptime_ms": 245193884
    }

- boot_id identifies one producer boot and MUST change after restart.
- sequence is assigned only to rx events. It starts at 1 and increases by
  exactly one for each accepted physical reception during that boot.
- event_id identifies that rx event, is never reused, and is opaque to clients.
  Clients compare it as a string and MUST NOT construct or parse it.
- created_at is UTC RFC 3339 and is omitted before time synchronization.
- uptime_ms is monotonic time since boot. It is required on all
  producer-originated stream events.

hello, heartbeat and gap are connection-control events. They are not retained,
do not consume a sequence number and MUST NOT contain event_id or sequence.
This distinction ensures that opening or resuming one client connection cannot
create apparent packet loss for another client. error, tx_request and tx_result
are also non-replayable and have no reception sequence.

| Event | Direction | Purpose |
| --- | --- | --- |
| hello | producer → client | Identity, versions, features and limits |
| rx | producer → client | One physical LoRa APRS reception |
| heartbeat | producer → client | Liveness and current sequence |
| gap | producer → client | Requested history is unavailable |
| error | either | Structured processing or protocol error |
| tx_request | client → producer | Optional packet transmission |
| tx_result | producer → client | Optional transmission outcome |

## 5. Hello

The first event on each continuous stream connection MUST be hello.

    {
      "protocol": "lora-aprs-json",
      "protocol_version": "1",
      "schema_version": "1.0",
      "event": "hello",
      "boot_id": "8f3a2c10",
      "uptime_ms": 1821,
      "latest_sequence": 1841,
      "producer": {
        "station": "F4MLV-2",
        "software": "LoRa_APRS_iGate",
        "firmware": "4.0.2RXT",
        "hardware": "LilyGo T3"
      },
      "capabilities": {
        "events": ["rx", "heartbeat", "gap", "error"],
        "features": ["local_metrics", "rxt", "aprs_decoded"],
        "transports": ["ndjson-http"],
        "history_events": 64,
        "max_record_bytes": 8192
      }
    }

latest_sequence is the greatest rx sequence assigned in this boot, or 0 if no
packet has yet been accepted. Defined features are local_metrics, rxt,
aprs_decoded, radio_parameters, tx and history_resume. A producer advertising
tx MUST also advertise tx_status_ttl_ms.

## 6. Receive event

An rx event represents exactly one physical packet accepted after LoRa CRC
validation. Repeated copies of identical APRS content are distinct events.

    {
      "protocol": "lora-aprs-json",
      "protocol_version": "1",
      "schema_version": "1.0",
      "event": "rx",
      "event_id": "8f3a2c10:1842",
      "boot_id": "8f3a2c10",
      "sequence": 1842,
      "created_at": "2026-09-20T12:34:56.421Z",
      "uptime_ms": 245193884,
      "receiver": {"station": "F4MLV-2", "interface": "lora0"},
      "packet": {},
      "reception": {}
    }

### Packet header

    {
      "raw_tnc2_base64": "RjZaWlotMT5BUExSRzEsRjZERVYtMTAqLEY0TUxWLTEwKjo9...",
      "tnc2": "F6ZZX-1>APLRG1,F6DEV-10*,F4MLV-10*:...",
      "parse_status": "parsed",
      "source": {"text": "F6ZZX-1", "call": "F6ZZX", "ssid": 1},
      "destination": {"text": "APLRG1", "call": "APLRG1"},
      "path": [
        {"text": "F6DEV-10*", "call": "F6DEV", "ssid": 10,
         "repeated": true, "kind": "station"},
        {"text": "F4MLV-10*", "call": "F4MLV", "ssid": 10,
         "repeated": true, "kind": "station"}
      ],
      "information": {
        "raw_base64": "PUw4aHt1Tmk6YiMgIU...",
        "text": "=L8h{uNi:b# !GLoRa APRS de F6ZZX-1 Batt=5.06V",
        "dti": "=",
        "dti_hex": "3d",
        "dti_offset": 0
      },
      "aprs": {}
    }

Path kind is station, alias, internet, q_construct or unknown. Parsed address
members are hints; text is authoritative. raw_tnc2_base64 and parse_status are
the only unconditional packet members. parse_status is parsed or malformed.
With parsed, the producer MUST also emit source, destination, path and
information. With malformed, it MAY emit partial members but MUST NOT invent
values merely to satisfy the schema. A recognizable APRS form which the
producer cannot decode is still a parsed packet and uses
packet.aprs.type=unsupported. information.raw_base64 is mandatory whenever
information is present.

dti_hex identifies the detected one-byte DTI and dti is its JSON text form
when representable. dti_offset is its zero-based byte position in information
and defaults to 0 when omitted. This preserves the APRS 1.2c X1J exception in
which a `!` position DTI may occur after a prefix, up to byte position 39.

### APRS decoding

packet.aprs is optional. Its absence means that the producer did not decode
APRS. A failure to decode APRS does not invalidate the reception.

Each decoded object contains type, valid, optional warnings, and decoded
type-specific members.

| Type | APRS forms |
| --- | --- |
| position | !, =, /, @, [, and position-bearing NMEA |
| mic_e | Current and old Mic-E, including DTI 0x1c and 0x1d |
| object | ; |
| item | ) |
| weather | _, #, *, Ultimeter forms, or weather attached to position |
| telemetry | T, base-91 telemetry and telemetry metadata |
| message | :, including ACK, REJ, bulletin and announcement |
| query | ? |
| status | > |
| capabilities | < |
| direction_finding | % and DF extensions |
| raw_gps | $ |
| third_party | } |
| user_defined | { |
| test | , |
| other | Known but not otherwise represented |
| unsupported | Recognizable but not decoded |
| invalid | Malformed APRS information |

The APRS 1.2c DTI table is normative. Some content is distinguished by more
than its DTI (for example `$` NMEA versus Ultimeter), and some content is an
extension attached to another primary form (for example base-91 telemetry or
weather attached to a position). The primary type describes the enclosing APRS
form; attached forms are represented inside decoded. Reserved, unused and
do-not-use DTIs are transported and never discarded solely because of their
DTI.

valid means that the producer found the complete primary APRS form conformant.
A producer MAY still return partial decoded data when valid is false, but MUST
also provide at least one warning. Warning strings are diagnostic and are not
stable machine-readable error codes. packet.aprs is a convenience view; raw
packet bytes, not decoded members, are the interoperability boundary.

### Position

    {
      "type": "position",
      "valid": true,
      "decoded": {
        "format": "compressed",
        "messaging_capable": true,
        "latitude_deg": 42.9606,
        "longitude_deg": 1.3711,
        "ambiguity_digits": 0,
        "symbol": {"table": "/", "code": "#"},
        "timestamp": {"raw": "201234z", "kind": "dhm", "utc": true},
        "altitude_m": 850.0,
        "course_deg": 194,
        "speed_mps": 44.24,
        "comment": "GLoRa APRS",
        "dao": {"datum": "W", "raw": "!W12!"}
      }
    }

Position format is uncompressed, compressed, mic_e, nmea or maidenhead.
Ambiguity is explicit; precision MUST NOT be inferred only from coordinates.

### Objects, items and extensions

Objects/items contain name, alive, position, comment and, for an object,
timestamp. alive false represents a killed object or item. Area object,
signpost, PHG, RNG, DFS, course/speed and other APRS extensions are typed
entries in extensions. Their original bytes remain available.

### Weather

Weather uses explicit fields and units: wind_direction_deg, wind_speed_mps,
wind_gust_mps, temperature_c, rain_1h_mm, rain_24h_mm,
rain_since_midnight_mm, humidity_pct, pressure_hpa, luminosity_w_m2,
snow_24h_mm and raw_fields. Unknown vendor fields remain in raw_fields.

### Telemetry

Samples contain sequence, analog_raw, analog_scaled, digital, base91 and
comment. Metadata uses metadata_kind equal to parm, unit, eqns or bits, plus
the corresponding arrays. Raw values remain available after scaling.

### Messages

    {
      "type": "message",
      "valid": true,
      "decoded": {
        "kind": "message",
        "addressee": "F4MLV-7",
        "text": "DigiEcoMode was ON",
        "message_id": "849"
      }
    }

Message kind is message, ack, rej, bulletin, announcement, nws or
telemetry_metadata. ACK and REJ records use referenced_id.

### Other APRS forms

Mic-E exposes position, speed_mps, course_deg, symbol, message_code,
message_text, status_text, altitude_m, telemetry and ambiguity_digits. The
encoded destination and binary information bytes remain authoritative.

Third-party decoded.inner is another complete packet object. Producers SHOULD
limit recursion and emit a warning at the limit.

User-defined data contains user_id, user_type, data_base64 and optional text.
This protocol assigns no additional semantics to it.

### Reception metadata

    {
      "local": {
        "rssi_dbm": -66,
        "snr_db": 8.0,
        "frequency_error_hz": 2067
      },
      "radio": {
        "frequency_hz": 433775000,
        "bandwidth_hz": 125000,
        "spreading_factor": 12,
        "coding_rate": "4/6"
      },
      "rxt": {
        "encoding": "rxt-v1",
        "raw": ")!AC1W%J",
        "hops": [
          {"ordinal": 1, "tx": "F6ZZX-1", "rx": "F6DEV-10",
           "identity_status": "resolved", "has_data": true,
           "rssi_dbm": -122, "snr_db": -9.0,
           "frequency_error_hz": -208, "tth_ms": 4158},
          {"ordinal": 2, "tx": "F6DEV-10", "rx": "F4MLV-10",
           "identity_status": "resolved", "has_data": true,
           "rssi_dbm": -114, "snr_db": 4.5,
           "frequency_error_hz": -2075, "tth_ms": 7360}
        ]
      }
    }

local describes the receiver emitting JSON. In each hop, tx transmitted and
rx received and measured the link. rxt.raw contains the tuple bytes in the RXT
alphabet `!` through `z`, inside the RF braces but without `{` or `}`; its
length is 4, 8 or 12 characters.
Hop ordinals start at 1 and are contiguous. identity_status is required. A
resolved hop has both tx and rx; an unresolved hop may omit either identity.

For a used legacy hop, has_data is false and metrics are omitted. Every RXT
tuple corresponds in order to exactly one has_data=true hop. For an unresolved
tuple, tx or rx may be omitted and identity_status is unresolved.
Clipping SHOULD be marked with rssi_clipped, snr_clipped or
frequency_error_clipped.

### RXT v1 encoding

reception.rxt.encoding is required and is `rxt-v1`. Decoding a tuple requires
reception.radio.bandwidth_hz and reception.radio.spreading_factor. For the four
ASCII tuple bytes b0 through b3, define xi = codepoint(bi) - 33. Each xi is an
integer from 0 through 89. The decoded values are:

    rssi_dbm = x0 - 130
    snr_db = (x1 * 0.25) - 9
    u = (x2 - 45) / 45
    frequency_error_hz = trunc_toward_zero(u * abs(u) * 2500)
    scale_ms = 10000 * (2 ^ spreading_factor) / bandwidth_hz
    tth_ms = floor(((1.08 ^ x3) - 1) * scale_ms)

The metrics of each has_data=true hop MUST equal these decoded values for its
corresponding tuple. Tuples and has_data=true hops are ordered from the source
toward the receiver. Legacy has_data=false hops occupy an ordinal in the
physical chain but consume no tuple. This definition, rather than firmware
source code, is normative for independent consumers.

## 7. Heartbeat, gap and error

A producer SHOULD emit a heartbeat after 15 seconds without another event.
It contains boot_id, latest_sequence, uptime_ms and time_synchronized.

If requested history is unavailable, gap contains boot_id, requested_after,
oldest_available, latest_available and reason. The two availability identifiers
are omitted when history is empty. Reason is history_expired, different_boot
or unknown_event. gap is a statement about one resume request, not a missing
radio event.

An error contains stable code, human-readable message, recoverable and
optional related_event_id. A producer-originated error written to the
continuous stream MUST also contain boot_id and uptime_ms. An error sent by a
client need not contain those producer fields.

## 8. Optional transmission

Transmission is disabled unless explicitly configured.

    {
      "protocol": "lora-aprs-json",
      "protocol_version": "1",
      "schema_version": "1.0",
      "event": "tx_request",
      "request_id": "graywolf-73d821",
      "packet": {
        "raw_tnc2_base64": "RjRNTFYtMj5BUExSRzE6PkhlbGxv",
        "tnc2": "F4MLV-2>APLRG1:>Hello"
      },
      "options": {"append_rxt": false, "priority": "normal"}
    }

tx_result repeats request_id and reports queued, sent, rejected or failed.
reason is required for rejected and failed. tx_result is returned by the TX
HTTP endpoints; it is not inserted into the APRS receive stream and is not a
replayable reception event. RXT MUST NOT be appended because client-originated
traffic has no RF receive context.

tx_request.packet.raw_tnc2_base64 is authoritative for transmission. When
tx_request.packet.tnc2 is present, the decoded raw_tnc2_base64 bytes MUST equal
the UTF-8 encoding of tnc2 exactly. A producer MUST reject a request when the
two representations differ.

## 9. HTTP transports

Continuous stream:

    GET /api/v1/aprs/stream
    Accept: application/x-ndjson

Response:

    Content-Type: application/x-ndjson; charset=utf-8
    Cache-Control: no-store

Each event is followed by LF and flushed immediately. A JSON string may contain
an escaped newline but a physical record never spans lines. Producers bound
client queues and disconnect slow clients instead of exhausting memory.

Resume uses:

    GET /api/v1/aprs/stream?after=8f3a2c10%3A1842

After hello, the producer either replays all rx events after the named event in
ascending sequence order, or emits one gap before live rx events. If the named
event is the current latest event, replay is empty. Clients deduplicate by
event_id because reconnecting may repeat the last record. A sequence jump
between two rx events with the same boot_id indicates loss and SHOULD trigger a
resume request after the last received event_id. A change of boot_id requires a
fresh stream; sequences from different boots are never compared.

Opening a stream establishes an atomic history/live boundary. The producer
captures latest_sequence for hello and begins queuing newer rx events before
it writes hello or performs replay. It then emits replay and queued live events
in ascending sequence order. An rx event arriving during hello or replay MUST
therefore neither be lost nor overtake an older event.

Without an after parameter, the connection starts with hello and then live
events; retained history is not replayed. event_id has no public syntax. A
present but empty after value, or a value that cannot be URL-decoded, receives
HTTP 400. Every other decoded non-empty string is treated as one opaque event
identifier. If it is unrecognized, belongs to another boot or has expired, the
stream opens and reports a gap with the corresponding reason.

Resume is available only when hello advertises history_resume; in that case
history_events is required and greater than zero. A client MUST NOT send after
unless that capability was advertised. A producer without history_resume
returns HTTP 400 with error code history_resume_unsupported when after is
present. Authentication failures use HTTP 401 or 403.

Snapshot:

    GET /api/v1/aprs/events?limit=10

It returns newest-first rx events as a JSON array with Content-Type
application/json. Polling is for dashboards, not lossless ingestion. Existing
/rxt.json is a legacy RXT-only snapshot.

Optional transmission:

    POST /api/v1/aprs/tx
    Content-Type: application/json

Success returns HTTP 202 and an initial queued tx_result. Remote access
requires authentication and transport security.

Final transmission state is obtained with:

    GET /api/v1/aprs/tx/{request_id}

It returns the latest tx_result with HTTP 200. Unknown or expired request IDs
return HTTP 404. The producer advertises tx_status_ttl_ms in capabilities and
retains a terminal result for at least that duration. request_id is scoped to
the authenticated client. Retrying the same request_id with identical packet
bytes and options is idempotent and returns its existing result; reusing it for
different content returns HTTP 409.

## 10. Processing boundaries

- The consumer decides whether a packet is uploaded to APRS-IS.
- RXT is never inserted into the clean APRS payload by this protocol.
- APRS-IS q constructs are not invented as RF path components.
- Duplicate detection uses the clean packet; individual receptions remain
  available for RF analysis.
- APRS decode failure never suppresses a valid reception event.
- Input does not imply authorization to transmit, digipeat or iGate.
- NOGATE and RFONLY remain subject to normal iGate policy.

## 11. Evolution, security and limits

protocol_version changes only for an incompatible redesign. schema_version is
the exact major.minor schema revision and is the value constrained by a schema
document. A minor schema revision may add optional object members. Consumers
within protocol version 1 MUST ignore unknown object members. A new event name
or closed-enum value requires a new schema_version; a consumer that does not
support that schema MUST skip the unknown record or fail cleanly, never
reinterpret it. Removing or reinterpreting a member requires a new protocol
version. Exact raw bytes remain the compatibility boundary.

Ignoring unknown members applies only to records whose schema_version the
consumer explicitly supports. It does not imply that a consumer supporting
schema 1.0 automatically accepts a record declaring schema 1.1, even when the
newer record appears to contain only optional additions.

Implementations limit nesting, record size, third-party recursion, history
and client queues. Non-finite numbers are forbidden. Transmission requires
authorization, rate limiting and radio duty-cycle enforcement. Packet text is
untrusted and must be escaped in HTML.

## 12. APRS reference

Field semantics come from APRS Protocol Reference 1.2c in the companion
aprs101-fr project. This protocol adds transport and LoRa metadata only.
Where they disagree about an APRS field, APRS 1.2c takes precedence.

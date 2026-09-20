#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const root = __dirname;
const schema = JSON.parse(
  fs.readFileSync(path.join(root, "schema/lora-aprs-json-v1.schema.json"), "utf8"),
);
const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function readNdjson(relativePath) {
  const input = fs.readFileSync(path.join(root, relativePath), "utf8");
  assert.ok(input.endsWith("\n"), `${relativePath}: final LF is required`);
  return input.slice(0, -1).split("\n").map((line, index) => {
    assert.ok(line.length > 0, `${relativePath}:${index + 1}: blank record`);
    return JSON.parse(line);
  });
}

function schemaValid(value, label) {
  assert.ok(validate(value), `${label}: ${ajv.errorsText(validate.errors)}`);
}

function schemaInvalid(value, label) {
  assert.equal(validate(value), false, `${label}: unexpectedly accepted`);
}

function decodedBase64(value, label) {
  const bytes = Buffer.from(value, "base64");
  assert.equal(bytes.toString("base64"), value, `${label}: non-canonical Base64`);
  return bytes;
}

function checkPacketCopies(event, label) {
  if (event.event !== "rx" && event.event !== "tx_request") return;
  const packet = event.packet;
  const raw = decodedBase64(packet.raw_tnc2_base64, `${label}.packet.raw_tnc2_base64`);
  if (packet.tnc2 !== undefined) {
    assert.deepEqual(raw, Buffer.from(packet.tnc2, "utf8"), `${label}: tnc2 mismatch`);
  }
  if (event.event !== "rx") return;
  const separator = raw.indexOf(0x3a);
  assert.notEqual(separator, -1, `${label}: missing TNC2 header separator`);
  const information = decodedBase64(
    packet.information.raw_base64,
    `${label}.packet.information.raw_base64`,
  );
  assert.deepEqual(information, raw.subarray(separator + 1), `${label}: information mismatch`);
  if (packet.information.text !== undefined) {
    assert.deepEqual(
      information,
      Buffer.from(packet.information.text, "utf8"),
      `${label}: information text mismatch`,
    );
  }
  if (packet.information.dti_hex !== undefined) {
    const offset = packet.information.dti_offset ?? 0;
    assert.ok(offset < information.length, `${label}: DTI offset outside information`);
    assert.equal(
      packet.information.dti_hex.toLowerCase(),
      information[offset].toString(16).padStart(2, "0"),
      `${label}: dti_hex mismatch`,
    );
    if (packet.information.dti !== undefined) {
      assert.deepEqual(
        Buffer.from(packet.information.dti, "utf8"),
        information.subarray(offset, offset + 1),
        `${label}: dti text mismatch`,
      );
    }
  }
  const aprs = packet.aprs;
  if (aprs?.type === "position" && aprs.valid && aprs.decoded.format === "compressed") {
    const dtiOffset = packet.information.dti_offset ?? 0;
    const body = information.subarray(dtiOffset + 1);
    assert.ok(body.length >= 13, `${label}: truncated compressed position`);
    const base91 = (bytes) => [...bytes].reduce((value, byte) => value * 91 + byte - 33, 0);
    const latitude = 90 - base91(body.subarray(1, 5)) / 380926;
    const longitude = -180 + base91(body.subarray(5, 9)) / 190463;
    assert.ok(Math.abs(aprs.decoded.latitude_deg - latitude) < 0.0000005, `${label}: latitude mismatch`);
    assert.ok(Math.abs(aprs.decoded.longitude_deg - longitude) < 0.0000005, `${label}: longitude mismatch`);
    const tableId = String.fromCharCode(body[0]);
    let table = tableId;
    let overlay = null;
    if (/^[A-Z]$/.test(tableId)) {
      table = "\\";
      overlay = tableId;
    } else if (/^[a-j]$/.test(tableId)) {
      table = "\\";
      overlay = String(tableId.charCodeAt(0) - "a".charCodeAt(0));
    }
    assert.deepEqual(aprs.decoded.symbol, {
      table,
      code: String.fromCharCode(body[9]),
      overlay,
    }, `${label}: compressed symbol mismatch`);
    assert.equal(aprs.decoded.comment, body.subarray(13).toString("utf8"), `${label}: comment mismatch`);
  }
  const rxt = event.reception.rxt;
  if (rxt !== undefined) {
    rxt.hops.forEach((hop, index) => {
      assert.equal(hop.ordinal, index + 1, `${label}: non-contiguous RXT ordinal`);
    });
    assert.equal(
      rxt.hops.filter((hop) => hop.has_data).length,
      rxt.raw.length / 4,
      `${label}: RXT tuple/hop count mismatch`,
    );
    if (event.reception.radio !== undefined) {
      const radio = event.reception.radio;
      const scale = (2 ** radio.spreading_factor / (radio.bandwidth_hz / 1000)) * 10;
      const measured = rxt.hops.filter((hop) => hop.has_data);
      for (let index = 0; index < measured.length; index += 1) {
        const values = [...rxt.raw.slice(index * 4, index * 4 + 4)]
          .map((character) => character.charCodeAt(0) - 33);
        const normalized = (values[2] - 45) / 45;
        assert.equal(measured[index].rssi_dbm, values[0] - 130, `${label}: RXT RSSI mismatch`);
        assert.equal(measured[index].snr_db, values[1] * 0.25 - 9, `${label}: RXT SNR mismatch`);
        assert.equal(
          measured[index].frequency_error_hz,
          Math.trunc(normalized * Math.abs(normalized) * 2500),
          `${label}: RXT frequency error mismatch`,
        );
        assert.equal(
          measured[index].tth_ms,
          Math.trunc((1.08 ** values[3] - 1) * scale),
          `${label}: RXT TTH mismatch`,
        );
      }
    }
  }
}

const stream = readNdjson("examples/lora-aprs-json-stream.ndjson");
const events = readNdjson("examples/lora-aprs-json-events.ndjson");
for (const [file, records] of [["stream", stream], ["events", events]]) {
  records.forEach((record, index) => {
    const label = `${file}:${index + 1}`;
    schemaValid(record, label);
    checkPacketCopies(record, label);
  });
}

assert.equal(stream[0].event, "hello", "stream must start with hello");
const byType = Object.fromEntries(events.map((event) => [event.event, event]));
for (const type of ["hello", "rx", "heartbeat", "gap", "error", "tx_request", "tx_result"]) {
  assert.ok(byType[type], `missing positive vector for ${type}`);
}

function changed(source, update) {
  return Object.assign(structuredClone(source), update);
}

schemaInvalid(changed(byType.hello, { event_id: "bad:0" }), "hello with event_id");
schemaInvalid(changed(byType.heartbeat, { sequence: 2 }), "heartbeat with sequence");
schemaInvalid(changed(byType.gap, { sequence: 2 }), "gap with sequence");
schemaInvalid(changed(byType.rx, { sequence: 0 }), "rx sequence zero");
schemaInvalid(changed(byType.rx, { created_at: "2026-09-20T10:00:00+02:00" }), "non-UTC time");
schemaInvalid(changed(byType.error, { event: "future_event" }), "unknown event");
schemaInvalid(changed(byType.error, { schema_version: "1.1" }), "unsupported schema version");

const badBase64 = structuredClone(byType.rx);
badBase64.packet.raw_tnc2_base64 = "%%%=";
schemaInvalid(badBase64, "invalid Base64");

const invalidAprs = structuredClone(byType.rx);
invalidAprs.packet.aprs = { type: "invalid", valid: false, decoded: {} };
schemaInvalid(invalidAprs, "invalid APRS without warning");

const incompleteParsedPacket = structuredClone(byType.rx);
incompleteParsedPacket.packet = { raw_tnc2_base64: "QkFE", parse_status: "parsed" };
schemaInvalid(incompleteParsedPacket, "parsed packet without parsed members");

const nullMetric = structuredClone(byType.rx);
nullMetric.reception.local = { rssi_dbm: null };
schemaInvalid(nullMetric, "null metric");

const failedWithoutReason = changed(byType.tx_result, { status: "failed" });
schemaInvalid(failedWithoutReason, "failed TX without reason");

const terminalTx = changed(byType.tx_result, { status: "sent" });
schemaValid(terminalTx, "terminal TX result");

const txHelloWithoutTtl = structuredClone(byType.hello);
txHelloWithoutTtl.capabilities.features.push("tx");
schemaInvalid(txHelloWithoutTtl, "TX capability without status retention");
txHelloWithoutTtl.capabilities.tx_status_ttl_ms = 60000;
schemaValid(txHelloWithoutTtl, "TX capability with status retention");

const compatibleAddition = changed(byType.rx, { future_optional_member: true });
schemaValid(compatibleAddition, "unknown optional member");

const malformedReception = structuredClone(byType.rx);
malformedReception.event_id = "boot-a:2";
malformedReception.sequence = 2;
malformedReception.packet = { raw_tnc2_base64: "QkFE", parse_status: "malformed" };
schemaValid(malformedReception, "lossless malformed reception");

console.log(`validated ${stream.length + events.length + 3} positive and 13 negative vectors`);

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
let positiveCount = 0;
let negativeCount = 0;

function readNdjson(relativePath) {
  return readNdjsonFile(path.join(root, relativePath), relativePath);
}

function readNdjsonFile(filePath, label = filePath) {
  const input = fs.readFileSync(filePath, "utf8");
  assert.ok(input.endsWith("\n"), `${label}: final LF is required`);
  return input.slice(0, -1).split("\n").map((line, index) => {
    assert.ok(line.length > 0, `${label}:${index + 1}: blank record`);
    return JSON.parse(line);
  });
}

function schemaValid(value, label) {
  assert.ok(validate(value), `${label}: ${ajv.errorsText(validate.errors)}`);
  positiveCount += 1;
}

function schemaInvalid(value, label) {
  assert.equal(validate(value), false, `${label}: unexpectedly accepted`);
  negativeCount += 1;
}

function semanticInvalid(callback, label) {
  assert.throws(callback, undefined, `${label}: unexpectedly accepted`);
  negativeCount += 1;
}

function decodedBase64(value, label) {
  const bytes = Buffer.from(value, "base64");
  assert.equal(bytes.toString("base64"), value, `${label}: non-canonical Base64`);
  return bytes;
}

function checkRxt(event, rxt, label) {
  if (rxt === undefined) return;
  assert.equal(rxt.encoding, "rxt-v1", `${label}: unsupported RXT encoding`);
  rxt.hops.forEach((hop, index) => {
    assert.equal(hop.ordinal, index + 1, `${label}: non-contiguous RXT ordinal`);
  });
  assert.equal(
    rxt.hops.filter((hop) => hop.has_data).length,
    rxt.raw.length / 4,
    `${label}: RXT tuple/hop count mismatch`,
  );
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

function checkAddress(address, token, label) {
  assert.equal(address.text, token, `${label}: address text mismatch`);
  const repeated = token.endsWith("*");
  const identity = repeated ? token.slice(0, -1) : token;
  if (address.repeated !== undefined) {
    assert.equal(address.repeated, repeated, `${label}: repeated marker mismatch`);
  }
  const delimiter = identity.indexOf("-");
  if (delimiter > 0) {
    assert.equal(
      address.suffix,
      identity.slice(delimiter + 1),
      `${label}: suffix mismatch`,
    );
    if (address.call !== undefined) {
      assert.equal(address.call, identity.slice(0, delimiter), `${label}: call mismatch`);
    }
  } else if (address.suffix !== undefined) {
    assert.fail(`${label}: suffix without address delimiter`);
  }
  if (address.ssid !== undefined) {
    assert.match(address.suffix, /^[0-9]+$/, `${label}: non-decimal numeric SSID`);
    assert.equal(BigInt(address.ssid), BigInt(address.suffix), `${label}: SSID value mismatch`);
  }
}

function checkParsedAddresses(packet, raw, separator, label) {
  const header = raw.subarray(0, separator).toString("utf8");
  const sourceSeparator = header.indexOf(">");
  assert.ok(sourceSeparator > 0, `${label}: missing TNC2 source separator`);
  const source = header.slice(0, sourceSeparator);
  const route = header.slice(sourceSeparator + 1).split(",");
  assert.ok(route[0].length > 0, `${label}: empty TNC2 destination`);
  assert.equal(packet.path.length, route.length - 1, `${label}: path length mismatch`);
  checkAddress(packet.source, source, `${label}.packet.source`);
  checkAddress(packet.destination, route[0], `${label}.packet.destination`);
  packet.path.forEach((address, index) => {
    checkAddress(address, route[index + 1], `${label}.packet.path[${index}]`);
  });
}

function checkPacketCopies(event, label) {
  if (event.event !== "rx" && event.event !== "tx_request") return;
  const packet = event.packet;
  const raw = decodedBase64(packet.raw_tnc2_base64, `${label}.packet.raw_tnc2_base64`);
  if (packet.tnc2 !== undefined) {
    assert.deepEqual(raw, Buffer.from(packet.tnc2, "utf8"), `${label}: tnc2 mismatch`);
  }
  if (event.event !== "rx") return;
  const rxt = event.reception.rxt;
  if (packet.rf_tnc2_base64 !== undefined) {
    const rf = decodedBase64(packet.rf_tnc2_base64, `${label}.packet.rf_tnc2_base64`);
    const expected = rxt === undefined
      ? raw
      : Buffer.concat([raw, Buffer.from(`{${rxt.raw}}`, "ascii")]);
    assert.deepEqual(rf, expected, `${label}: RF/clean/RXT byte relationship mismatch`);
  }
  if (packet.parse_status === "malformed") {
    checkRxt(event, rxt, label);
    return;
  }
  const separator = raw.indexOf(0x3a);
  assert.notEqual(separator, -1, `${label}: missing TNC2 header separator`);
  checkParsedAddresses(packet, raw, separator, label);
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
  checkRxt(event, rxt, label);
}

function checkProducerStreamEvent(event, label) {
  assert.equal(typeof event.boot_id, "string", `${label}: missing producer boot_id`);
  assert.ok(event.boot_id.length > 0, `${label}: empty producer boot_id`);
  assert.ok(Number.isInteger(event.uptime_ms), `${label}: missing producer uptime_ms`);
}

function checkOrderedRxStream(records, label) {
  assert.equal(records[0]?.event, "hello", `${label}: stream must start with hello`);
  const hello = records[0];
  const receptions = records.filter((record) => record.event === "rx");
  const eventIds = new Set();
  let previousSequence = hello.latest_sequence;
  let previousUptime = hello.uptime_ms;
  for (const [index, reception] of receptions.entries()) {
    assert.equal(reception.boot_id, hello.boot_id, `${label}: rx ${index + 1} changed boot_id`);
    assert.equal(
      reception.sequence,
      previousSequence + 1,
      `${label}: rx ${index + 1} is not the next sequence`,
    );
    assert.equal(
      eventIds.has(reception.event_id),
      false,
      `${label}: rx ${index + 1} reused event_id`,
    );
    assert.ok(
      reception.uptime_ms >= previousUptime,
      `${label}: rx ${index + 1} moved uptime backwards`,
    );
    eventIds.add(reception.event_id);
    previousSequence = reception.sequence;
    previousUptime = reception.uptime_ms;
  }
}

function checkTxQueueable(event, label) {
  assert.equal(event.event, "tx_request", `${label}: not a TX request`);
  const raw = decodedBase64(event.packet.raw_tnc2_base64, `${label}.packet.raw_tnc2_base64`);
  assert.equal(raw.includes(0x0a), false, `${label}: embedded LF`);
  assert.equal(raw.includes(0x0d), false, `${label}: embedded CR`);
  const separator = raw.indexOf(0x3a);
  const addressSeparator = raw.indexOf(0x3e);
  assert.ok(addressSeparator > 0, `${label}: missing TNC2 source separator`);
  assert.ok(separator > addressSeparator + 1, `${label}: missing TNC2 destination or data separator`);
}

const stream = readNdjson("examples/lora-aprs-json-stream.ndjson");
const sequenceStream = readNdjson("examples/lora-aprs-json-sequence-stream.ndjson");
const events = readNdjson("examples/lora-aprs-json-vectors.ndjson");
for (const [file, records] of [
  ["stream", stream],
  ["sequence-stream", sequenceStream],
  ["events", events],
]) {
  records.forEach((record, index) => {
    const label = `${file}:${index + 1}`;
    schemaValid(record, label);
    checkPacketCopies(record, label);
  });
}

assert.equal(stream[0].event, "hello", "stream must start with hello");
checkOrderedRxStream(stream, "stream");
checkOrderedRxStream(sequenceStream, "sequence-stream");
const eventTypes = ["hello", "rx", "heartbeat", "gap", "error", "tx_request", "tx_result"];
const byType = Object.fromEntries(eventTypes.map((type) => [
  type,
  events.find((event) => event.event === type),
]));
for (const type of eventTypes) {
  assert.ok(byType[type], `missing positive vector for ${type}`);
}

const alphanumericAddress = events.find((event) => event.packet?.source?.suffix === "GS");
assert.ok(alphanumericAddress, "missing alphanumeric address suffix vector");
const nonAprsRxt = events.find((event) => event.packet?.aprs === undefined && event.reception?.rxt);
assert.ok(nonAprsRxt, "missing non-APRS RXT vector");

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

const unsupportedPacketStatus = structuredClone(byType.rx);
unsupportedPacketStatus.packet.parse_status = "unsupported";
schemaInvalid(unsupportedPacketStatus, "unsupported packet parse status");

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

const alphanumericSsid = structuredClone(alphanumericAddress);
alphanumericSsid.packet.source.ssid = 0;
schemaInvalid(alphanumericSsid, "alphanumeric suffix represented as SSID");

const missingAlphanumericSuffix = structuredClone(alphanumericAddress);
delete missingAlphanumericSuffix.packet.source.suffix;
semanticInvalid(
  () => checkPacketCopies(missingAlphanumericSuffix, "missing alphanumeric suffix"),
  "missing parsed alphanumeric suffix",
);

const numericSsidWithoutSuffix = structuredClone(stream[1]);
delete numericSsidWithoutSuffix.packet.source.suffix;
schemaInvalid(numericSsidWithoutSuffix, "numeric SSID without suffix");

const mismatchedNumericSsid = structuredClone(stream[1]);
mismatchedNumericSsid.packet.source.ssid = 2;
semanticInvalid(
  () => checkPacketCopies(mismatchedNumericSsid, "mismatched numeric SSID"),
  "numeric SSID value mismatch",
);

const crcFailedReception = structuredClone(nonAprsRxt);
crcFailedReception.reception.crc_valid = false;
schemaInvalid(crcFailedReception, "CRC-failed observation emitted as RX");

const failedWithoutReason = changed(byType.tx_result, { status: "failed" });
schemaInvalid(failedWithoutReason, "failed TX without reason");

const rejectedWithoutCode = changed(byType.tx_result, {
  status: "rejected",
  reason: "Packet cannot be transmitted",
});
schemaInvalid(rejectedWithoutCode, "rejected TX without code");

const rejectedInvalidPacket = changed(byType.tx_result, {
  status: "rejected",
  code: "invalid_packet",
  reason: "Packet is not a usable TNC2 frame",
});
schemaValid(rejectedInvalidPacket, "rejected invalid TX packet");

const mismatchedTxText = structuredClone(byType.tx_request);
mismatchedTxText.packet.tnc2 = "N0CALL>APRS:>Different bytes";
semanticInvalid(() => checkPacketCopies(mismatchedTxText, "mismatched TX text"), "mismatched TX text");
checkTxQueueable(byType.tx_request, "valid TX request");

const invalidTxPacket = structuredClone(byType.tx_request);
invalidTxPacket.packet = {
  raw_tnc2_base64: Buffer.from("THIS IS NOT TNC2", "utf8").toString("base64"),
};
assert.ok(validate(invalidTxPacket), `invalid TX packet envelope: ${ajv.errorsText(validate.errors)}`);
semanticInvalid(
  () => checkTxQueueable(invalidTxPacket, "invalid TX packet"),
  "syntactically unusable TX packet",
);

const terminalTx = changed(byType.tx_result, { status: "sent" });
schemaValid(terminalTx, "terminal TX result");

const txHelloWithoutTtl = structuredClone(byType.hello);
txHelloWithoutTtl.capabilities.features.push("tx");
schemaInvalid(txHelloWithoutTtl, "TX capability without status retention");
txHelloWithoutTtl.capabilities.tx_status_ttl_ms = 60000;
schemaValid(txHelloWithoutTtl, "TX capability with status retention");

const historyHelloWithoutDepth = structuredClone(byType.hello);
delete historyHelloWithoutDepth.capabilities.history_events;
schemaInvalid(historyHelloWithoutDepth, "history resume without retained depth");

const compatibleAddition = changed(byType.rx, { future_optional_member: true });
schemaValid(compatibleAddition, "unknown optional member");

const malformedReception = structuredClone(byType.rx);
malformedReception.event_id = "boot-a:2";
malformedReception.sequence = 2;
malformedReception.packet = { raw_tnc2_base64: "QkFE", parse_status: "malformed" };
schemaValid(malformedReception, "lossless malformed reception");
checkPacketCopies(malformedReception, "lossless malformed reception");

const invalidRfCopy = structuredClone(stream[1]);
invalidRfCopy.packet.rf_tnc2_base64 = Buffer.from("corrupt RF bytes", "utf8").toString("base64");
semanticInvalid(() => checkPacketCopies(invalidRfCopy, "invalid RF copy"), "invalid RF copy");

const serverError = changed(byType.error, { boot_id: "boot-a", uptime_ms: 17000 });
schemaValid(serverError, "producer stream error");
checkProducerStreamEvent(serverError, "producer stream error");
semanticInvalid(
  () => checkProducerStreamEvent(byType.error, "producer stream error without uptime"),
  "producer stream error without uptime",
);

const sequenceGap = structuredClone(sequenceStream);
sequenceGap[2].sequence = 3;
semanticInvalid(() => checkOrderedRxStream(sequenceGap, "sequence gap"), "RX sequence gap");

const reusedEventId = structuredClone(sequenceStream);
reusedEventId[2].event_id = reusedEventId[1].event_id;
semanticInvalid(() => checkOrderedRxStream(reusedEventId, "reused event ID"), "reused RX event ID");

const outOfOrderReplay = structuredClone(sequenceStream);
[outOfOrderReplay[2], outOfOrderReplay[3]] = [outOfOrderReplay[3], outOfOrderReplay[2]];
semanticInvalid(
  () => checkOrderedRxStream(outOfOrderReplay, "out-of-order replay"),
  "out-of-order RX replay",
);

console.log(`validated ${positiveCount} positive and ${negativeCount} negative vectors`);

for (const capturePath of process.argv.slice(2)) {
  const records = readNdjsonFile(path.resolve(capturePath));
  records.forEach((record, index) => {
    const label = `${capturePath}:${index + 1}`;
    schemaValid(record, label);
    if (record.event === "rx" || record.event === "tx_request") {
      checkPacketCopies(record, label);
    }
    if (record.event === "tx_request") checkTxQueueable(record, label);
    if (["hello", "rx", "heartbeat", "gap", "error", "tx_result"].includes(record.event)) {
      checkProducerStreamEvent(record, label);
    }
  });
  checkOrderedRxStream(records, capturePath);
  console.log(`validated capture ${capturePath}: ${records.length} records`);
}

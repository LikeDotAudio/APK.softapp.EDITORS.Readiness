// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* ROAD-3489: the Readiness block round trip over cad.like.audio/host@1, through
   the vendored apk-softapp.js the page loads — and what the network says of an asset. */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ReadinessModel, READINESS_BLOCK_TYPE } from '../js/readinessModel.js';
import { world, roundTrip, ORIGIN, PROTOCOL } from './softapp-harness.mjs';

const connect = (model) => (S) => S.connectHost({
  editor: 'Equipment Readiness', blockType: READINESS_BLOCK_TYPE,
  onLoad: (b) => model.fromBlock(b), onRequest: () => model.toBlock(),
});

const amp = { id: 'a', mac: '00:1d:c1:00:00:02', serial: '', name: 'Amp 2', vendor: 'Powersoft', model: 'X8', ips: ['10.0.0.2'], protocols: ['aes70'], live: { state: 'good', why: 'verified 4s ago' } };

test('Readiness: the CAD loads a block, asks for it back, gets the same assets at its own origin', () => {
  const model = new ReadinessModel();
  const block = { type: READINESS_BLOCK_TYPE, id: 'readiness_room_a', planName: 'ROOM-A',
    devices: [{ id: 'dev-1', name: 'DSP', location: 'Rack 01', stage: 'd4', targetDate: '2026-12-01', mac: '00:11:22:33:44:55' }] };
  const { w, ready, saved } = roundTrip({ connect: connect(model), block });
  assert.equal(ready.m.protocol, PROTOCOL);
  assert.equal(ready.m.blockType, READINESS_BLOCK_TYPE);
  assert.equal(model.planName, 'ROOM-A');
  assert.equal(saved.o, ORIGIN);
  assert.deepEqual(saved.m.block, block);
  assert.equal(w.downloads.length, 0, 'no download when embedded');
});

test('Readiness: a discovered thing is added once, by MAC, at stage d0', () => {
  const model = new ReadinessModel();
  const n = model.devices.length;
  const d = model.addFromThing(amp);
  assert.equal(model.devices.length, n + 1);
  assert.equal(d.stage, 'd0');
  assert.equal(d.mac, amp.mac);
  assert.equal(model.addFromThing({ ...amp, ips: ['10.9.9.9'] }), null, 'same MAC, new IP: same asset');
  assert.equal(model.addFromThing({ name: 'ip only', ips: ['10.0.0.3'] }), null, 'no identity, not added');
});

test('Readiness: the network state of an asset follows the thing, unseen is dead', () => {
  const model = new ReadinessModel();
  const d = model.addFromThing(amp);
  assert.deepEqual(model.networkState(d, [amp]), ['good', 'verified 4s ago']);
  assert.deepEqual(model.networkState(d, [{ ...amp, live: { state: 'kinda', why: 'last verified 6 min ago' } }]), ['kinda', 'last verified 6 min ago']);
  assert.equal(model.networkState(d, [])[0], 'dead');
  assert.equal(model.networkState(model.addFromPart({ id: 'qsc/core-110f' }), [amp])[0], '', 'an asset with no MAC/serial is not judged');
});

test('Readiness: a load from another origin is ignored', () => {
  const model = new ReadinessModel();
  const w = world();
  connect(model)(w.S);
  model.addDevice({ id: 'dev-1', name: 'DSP' });
  w.fire({ protocol: PROTOCOL, type: 'load', block: { devices: [] } }, { origin: 'http://other:8080' });
  assert.ok(model.devices.length > 0);
});

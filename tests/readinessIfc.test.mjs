// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* bom-fm-4: readiness stages as an IfcWorkSchedule with one IfcTask per occurrence; location as spatial
   containment — held to the seed bench .ifc DATABASE.server.BIM serves (tests/fixtures/seed-bench.ifc.gz)
   and, with APK_IFC_PYTHON=<python with ifcopenshell>, to tests/fixtures/ifc_oracle.py. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { ReadinessModel } from '../js/readinessModel.js';
import { readinessToIfc, readinessFromIfc, deviceGid } from '../js/readinessIfc.js';
import * as ifc from '../js/ifc/apk-ifc.mjs';
import { available, render, OUT } from './fixtures/make_ifc_codec.mjs';

const FIX = new URL('./fixtures/', import.meta.url);
const BENCH = zlib.gunzipSync(fs.readFileSync(new URL('seed-bench.ifc.gz', FIX))).toString('utf8');

function plan() {
  const m = new ReadinessModel('ROOM-A');
  m.createdOn = '2026-11-01';
  m.addDevice({ id: 'dev-1', name: 'DSP', location: 'Rack 01', targetDate: '2026-12-01', mac: '00:11:22:33:44:55' });
  m.addDevice({ id: 'dev-2', name: 'Amp', location: 'Rack 02', targetDate: '2026-12-02' });
  m.addFromPart({ id: 'qsc/core-110f', name: 'QSC Core 110f', manufacturer: 'QSC', category: 'Audio', class: 'dsp / mixer' });
  m.setStage(m.devices[0], 'd4', '2026-11-05');
  m.setStage(m.devices[1], 'd8', '2026-11-06');
  return m;
}

test('block → IFC: one IfcTask per device, Completion = n/8, the eight stages nested and chained', () => {
  const m = plan();
  const f = ifc.parseStep(readinessToIfc(m));
  const ws = ifc.entitiesByType(f, 'IFCWORKSCHEDULE');
  assert.equal(ws.length, 1);
  assert.equal(ws[0].args[5], 'apk.readiness/2');
  const tasks = ifc.entitiesByType(f, 'IFCTASK');
  assert.equal(tasks.length, m.devices.length * 9, 'a task and its eight stage tasks per device');
  const top = tasks.filter((t) => !String(t.args[5]).includes('/'));
  assert.deepEqual(top.map((t) => t.args[7]), ['d4 Powered', 'd8 Air Ready', 'd0 Unstaged']);
  const completion = top.map((t) => { const tt = ifc.deref(f, t.args[11]); return tt ? ifc.unwrap(tt.args[19]) : null; });
  assert.deepEqual(completion, [0.5, 1, null], 'IfcPositiveRatioMeasure: no Completion at d0');
  assert.equal(ifc.entitiesByType(f, 'IFCRELASSIGNSTOPRODUCT').length, 3);
  assert.equal(ifc.entitiesByType(f, 'IFCRELSEQUENCE').length, 3 * 7);
  assert.ok(ifc.entitiesByType(f, 'IFCSPACE').some((s) => s.args[2] === 'Rack 01'), 'a location is a space');
});

test('save → open: the plan comes back from the .ifc alone, and saves to the same bytes', () => {
  const m = plan();
  const text = readinessToIfc(m);
  const back = new ReadinessModel();
  back.loadIfc(text, 'readiness.ifc');
  const pick = (ds) => ds.map((d) => [d.id, d.name, d.stage, d.targetDate, d.location, d.mac || '', JSON.stringify(d.reached || {})]);
  assert.deepEqual(pick(back.devices), pick(m.devices));
  assert.equal(back.planName, 'ROOM-A');
  assert.equal(back.createdOn, '2026-11-01');
  assert.equal(readinessToIfc(back), text);
});

test('a stage edit records the day each stage was reached; going back clears the later ones', () => {
  const m = new ReadinessModel();
  const d = m.addDevice({ id: 'dev-1', name: 'X' });
  m.setStage(d, 'd3', '2026-11-02');
  m.setStage(d, 'd5', '2026-11-04');
  assert.deepEqual(d.reached, { d1: '2026-11-02', d2: '2026-11-02', d3: '2026-11-02', d4: '2026-11-04', d5: '2026-11-04' });
  m.setStage(d, 'd1', '2026-11-05');
  assert.deepEqual(d.reached, { d1: '2026-11-02' });
  m.updateDevice(0, 'stage', 'd0');
  assert.equal(d.reached, undefined);
});

test('the seed bench as a plan: one d0 asset per device occurrence, located by its IfcSpace, keyed by GlobalId', () => {
  const got = readinessFromIfc(BENCH);
  assert.equal(got.fromSchedule, false);
  const f = ifc.parseStep(BENCH);
  const typed = new Set(ifc.entitiesByType(f, 'IFCRELDEFINESBYTYPE').flatMap((r) => r.args[4].map((x) => x.id)));
  const cables = [...typed].filter((id) => f.byId.get(id).type === 'IFCCABLESEGMENT').length;
  assert.ok(cables > 0);
  assert.equal(got.devices.length, typed.size - cables, 'cables are not commissioned on their own');
  assert.ok(got.devices.every((d) => d.stage === 'd0' && d.location === 'The Lab' && d.gid));
  const m = new ReadinessModel('BENCH');
  m.createdOn = '2026-11-01';
  m.loadIfc(BENCH, 'bench.ifc');
  m.setStage(m.devices[0], 'd2', '2026-11-04');
  m.updateDevice(0, 'location', 'Rack 99');
  assert.equal(m.devices[0].location, 'The Lab', 'a rig asset is where the model contains it');
  const twin = readinessToIfc(m);
  const out = ifc.parseStep(twin);
  for (const e of f.entities) assert.equal(ifc.writeEntity(out.byId.get(e.id)), ifc.writeEntity(e), 'the rig is kept whole');
  const again = new ReadinessModel();
  again.loadIfc(twin, 'bench.readiness.ifc');
  assert.equal(readinessToIfc(again), twin, 'open the twin and save: the same file, one schedule');
  // re-opening the plain rig keeps what this plan had for the same occurrences
  m.loadIfc(BENCH, 'bench.ifc');
  assert.equal(m.devices[0].stage, 'd2');
});

test('identity: a device GlobalId comes from its MAC / serial, never an IP', () => {
  assert.equal(deviceGid('p', { id: 'dev-1', mac: '00:11:22:33:44:55' }), ifc.ifcGuid('inst/mac:00:11:22:33:44:55'));
  assert.equal(deviceGid('p', { id: 'dev-1', serial: 'A1', maker: 'Crown' }), ifc.ifcGuid('inst/serial:crown/A1'));
  const m = new ReadinessModel();
  m.addFromThing({ mac: '00:1D:C1:00:00:02', name: 'Amp 2', vendor: 'Powersoft', model: 'X8', ips: ['10.0.0.2'] });
  assert.ok(!readinessToIfc(m).includes('10.0.0.2'));
});

test('js/ifc/apk-ifc.mjs is the contracts IFC kit (when the contracts checkout is beside this app)', { skip: !available() && 'no contracts checkout' }, async () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), await render(), 'run: node tests/fixtures/make_ifc_codec.mjs');
});

const PY = process.env.APK_IFC_PYTHON;
test('IfcOpenShell oracle: 0 schema + EXPRESS errors; tasks, products, completion, stages, spaces', { skip: !PY && 'set APK_IFC_PYTHON to a python with ifcopenshell' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-ifc-'));
  const oracle = fileURLToPath(new URL('ifc_oracle.py', FIX));
  const bench = new ReadinessModel('BENCH');
  bench.createdOn = '2026-11-01';
  bench.loadIfc(BENCH, 'bench.ifc');
  bench.setStage(bench.devices[0], 'd8', '2026-11-04');
  bench.devices[1].targetDate = '2026-11-20';
  for (const [name, m] of [['readiness.ifc', plan()], ['bench.readiness.ifc', bench]]) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, readinessToIfc(m));
    fs.writeFileSync(`${file}.expect.json`, JSON.stringify({ devices: m.devices }));
    const r = spawnSync(PY, ['-I', oracle, file, `${file}.expect.json`], { encoding: 'utf8', cwd: os.tmpdir() });
    if (r.status === 3) return;
    const got = JSON.parse(r.stdout.trim().split('\n').pop() || '{}');
    assert.deepEqual(got.problems, [], `${name}: ${r.stderr}`);
    assert.equal(got.validate_errors, 0);
    assert.equal(got.tasks, m.devices.length);
  }
});

test('standalone Save Model (vendored apk-softapp.js): <plan>.ifc and <plan>.json, both', async () => {
  const { world } = await import('./softapp-harness.mjs');
  const w = world({ framed: false });
  const m = plan();
  const r = await w.S.saveModel(m, { name: m.planName, toIfc: (x) => readinessToIfc(x), toJson: (x) => x.toBlock() });
  assert.equal(r.ok, true);
  assert.equal(w.downloads.length, 2);
  assert.ok(w.downloads[0].name.endsWith('.ifc') && w.downloads[0].text.startsWith('ISO-10303-21;'));
  assert.equal(JSON.parse(w.downloads[1].text).schema, 'apk.readiness/2');
});

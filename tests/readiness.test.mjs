import test from 'node:test';
import assert from 'node:assert/strict';
import {
  READINESS_STAGES,
  readinessLabel,
  stageRank,
  calculateGroupReadiness,
  readinessBadge,
  readinessTitle,
  estimateTimeToAir
} from '../js/readinessApp.js';
import { ReadinessModel } from '../js/readinessModel.js';

test('Readiness stages definition', () => {
  assert.equal(READINESS_STAGES.length, 9);
  assert.equal(READINESS_STAGES[0].code, 'd0');
  assert.equal(READINESS_STAGES[8].code, 'd8');
  assert.equal(readinessLabel('d0'), 'Unstaged');
  assert.equal(readinessLabel('d8'), 'Air Ready');
});

test('calculateGroupReadiness with empty devices', () => {
  const result = calculateGroupReadiness([]);
  assert.equal(result.devices, 0);
  assert.equal(result.staged, 0);
  assert.equal(result.stage, null);
  assert.equal(result.percent, 0);
  assert.equal(result.isAirReady, false);
});

test('calculateGroupReadiness with mixed stage devices', () => {
  const devices = [
    { id: 'dev-1', name: 'Core DSP', stage: 'd8' },
    { id: 'dev-2', name: 'Switch 01', stage: 'd5' },
    { id: 'dev-3', name: 'Amp 01', stage: 'd2' }
  ];

  const result = calculateGroupReadiness(devices);
  assert.equal(result.devices, 3);
  assert.equal(result.staged, 3);
  // Overall group stage is the lowest stage (d2 = Mounted)
  assert.equal(result.stage, 'd2');
  assert.equal(result.isAirReady, false);
  assert.ok(result.percent > 0 && result.percent < 100);

  const badge = readinessBadge(result);
  assert.match(badge, /Mounted/);

  const title = readinessTitle(result, 'Rack A');
  assert.match(title, /Rack A: Current Stage \[Mounted\]/);
});

test('calculateGroupReadiness when all air ready', () => {
  const devices = [
    { id: 'dev-1', name: 'Core DSP', stage: 'd8' },
    { id: 'dev-2', name: 'Switch 01', stage: 'd8' }
  ];

  const result = calculateGroupReadiness(devices);
  assert.equal(result.devices, 2);
  assert.equal(result.isAirReady, true);
  assert.equal(result.percent, 100);
  assert.equal(readinessBadge(result), 'Air Ready');
});

test('estimateTimeToAir estimates timeline based on completion', () => {
  const devices = [
    { id: 'dev-1', name: 'Core DSP', stage: 'd4' },
    { id: 'dev-2', name: 'Switch 01', stage: 'd4' }
  ];
  const eta = estimateTimeToAir(devices);
  assert.equal(eta.status, 'In Progress');
  assert.ok(eta.daysRemaining > 0);
});

test('ReadinessModel exports and imports block schemas correctly', () => {
  const model = new ReadinessModel('STUDIO-A-COMMISSIONING');
  assert.equal(model.devices.length, 0, 'no demo assets: each is a BIM part (ROAD-3572)');
  const ref = { part: 'qsc/core-110f', url: 'http://bench:8160/api/bim/parts/qsc/core-110f', rev: 'r1' };
  for (let i = 0; i < 4; i++) model.addFromPart({ id: 'qsc/core-110f', name: 'Q-SYS Core 110f DSP' }, ref);
  model.addDevice({ id: 'dev-old', name: 'typed by hand before', stage: 'd4' });
  assert.equal(model.devices.length, 5);
  assert.deepEqual([model.devices[0].name, model.devices[0].bimId, model.devices[0].stage], ['Q-SYS Core 110f DSP', 'qsc/core-110f', 'd0']);
  assert.deepEqual(model.devices[0].bimRef, ref);

  const block = model.toBlock();
  assert.equal(block.type, 'readiness_rollup');
  assert.equal(block.planName, 'STUDIO-A-COMMISSIONING');

  const restored = new ReadinessModel();
  restored.fromBlock(block);
  assert.equal(restored.planName, 'STUDIO-A-COMMISSIONING');
  assert.equal(restored.devices.length, 5);
  assert.deepEqual(restored.devices[1].bimRef, ref, 'the BIM reference is saved with the block');
  assert.equal(restored.devices[4].name, 'typed by hand before', 'an asset typed in before stays readable');
});

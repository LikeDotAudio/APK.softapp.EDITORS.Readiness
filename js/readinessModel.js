// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import { READINESS_STAGES, calculateGroupReadiness } from './readinessApp.js';

export const READINESS_BLOCK_TYPE = 'readiness_rollup';

export class ReadinessModel {
  constructor(planName = 'SYSTEM-READINESS-ROLLUP') {
    this.planName = planName;
    this.devices = [
      { id: 'dev-1', name: 'Core DSP Matrix (Q-SYS Core 110f)', location: 'Rack 01', stage: 'd8', targetDate: '2026-11-15' },
      { id: 'dev-2', name: 'Primary Switch (Cisco CBS350-24P)', location: 'Rack 01', stage: 'd5', targetDate: '2026-11-15' },
      { id: 'dev-3', name: 'Power Amplifier (Powersoft Ottocanali)', location: 'Rack 02', stage: 'd3', targetDate: '2026-11-15' },
      { id: 'dev-4', name: 'Wireless Mic Receiver (Shure ULXD4Q)', location: 'Rack 01', stage: 'd2', targetDate: '2026-11-15' },
      { id: 'dev-5', name: 'Touch Controller (TS-1070)', location: 'Control Room Wall', stage: 'd1', targetDate: '2026-11-15' }
    ];
  }

  addDevice(device = {}) {
    const d = {
      id: device.id || `dev-${this.devices.length + 1}`,
      name: device.name || 'New Hardware Asset',
      location: device.location || 'Rack 01',
      stage: device.stage || 'd0',
      targetDate: device.targetDate || '2026-11-30'
    };
    for (const k of ['mac', 'serial']) if (device[k]) d[k] = String(device[k]);
    this.devices.push(d);
    return d;
  }

  removeDevice(index) {
    if (index >= 0 && index < this.devices.length) {
      return this.devices.splice(index, 1)[0];
    }
    return null;
  }

  updateDevice(index, field, value) {
    if (this.devices[index]) {
      this.devices[index][field] = value;
    }
  }

  /** An asset for one discovered thing, keyed by MAC / serial (never IP); stage d0 until someone stages it. */
  addFromThing(t = {}) {
    const dupe = this.devices.find(d => (t.mac && d.mac === t.mac) || (t.serial && d.serial === t.serial));
    if (dupe || !(t.mac || t.serial)) return null;
    let n = this.devices.length + 1;
    while (this.devices.some(d => d.id === `dev-${n}`)) n++;
    return this.addDevice({
      id: `dev-${n}`,
      name: [t.name, t.vendor && t.model ? `(${t.vendor} ${t.model})` : t.model].filter(Boolean).join(' ') || t.mac || t.serial,
      location: '',
      stage: 'd0',
      mac: t.mac || '',
      serial: t.serial || ''
    });
  }

  /** The live state of each asset that has an identity the bus knows: [state, why], or ['', why] when it has no MAC or serial. */
  networkState(device, things = []) {
    const t = things.find(x => (device.mac && x.mac === device.mac) || (device.serial && x.serial === device.serial));
    if (!device.mac && !device.serial) return ['', 'no MAC or serial to look for'];
    if (!t) return ['dead', 'not seen on the network'];
    return [t.live?.state || 'dead', t.live?.why || ''];
  }

  setAllAirReady() {
    this.devices.forEach(d => {
      d.stage = 'd8';
    });
  }

  getRollup() {
    return calculateGroupReadiness(this.devices);
  }

  toBlock() {
    return {
      type: READINESS_BLOCK_TYPE,
      id: `readiness_${this.planName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      planName: this.planName,
      devices: JSON.parse(JSON.stringify(this.devices))
    };
  }

  fromBlock(block) {
    if (!block || typeof block !== 'object' || !Array.isArray(block.devices)) return false;
    if (block.planName) this.planName = block.planName;
    this.devices = JSON.parse(JSON.stringify(block.devices));
    return true;
  }
}

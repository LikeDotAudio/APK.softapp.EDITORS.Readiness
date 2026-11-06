// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

import { READINESS_STAGES, calculateGroupReadiness } from './readinessApp.js';

export const READINESS_BLOCK_TYPE = 'readiness_rollup';

export class ReadinessModel {
  constructor(planName = 'SYSTEM-READINESS-ROLLUP') {
    this.planName = planName;
    /* No demo assets: each comes from the BIM library (📚 Library, ROAD-3572), from
       Discovered, or from an opened block. */
    this.devices = [];
  }

  addDevice(device = {}) {
    const d = {
      id: device.id || `dev-${this.devices.length + 1}`,
      name: device.name || 'New Hardware Asset',
      location: device.location || 'Rack 01',
      stage: device.stage || 'd0',
      targetDate: device.targetDate || '2026-11-30'
    };
    for (const k of ['mac', 'serial', 'bimId']) if (device[k]) d[k] = String(device[k]);
    if (device.bimRef && device.bimRef.part) d.bimRef = { ...device.bimRef };   // the BIM reference (ROAD-3572)
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

  /** An asset for a part picked from the BIM library: its name is the part's, it keeps bimId and
      bimRef {part, url, rev} (bimLibrary.js bimFields). Each pick is one more asset — two of a
      model are two boxes to commission. */
  addFromPart(part = {}, bimRef = null) {
    let n = this.devices.length + 1;
    while (this.devices.some(d => d.id === `dev-${n}`)) n++;
    return this.addDevice({
      id: `dev-${n}`,
      name: part.name || [part.manufacturer, part.model].filter(Boolean).join(' ') || part.id,
      location: '',
      stage: 'd0',
      bimId: part.id || '',
      bimRef: bimRef || part.ref || null
    });
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

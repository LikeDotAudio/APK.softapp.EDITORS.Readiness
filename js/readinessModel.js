// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

/* bom-fm-4: each asset is one OCCURRENCE (gid = its GlobalId in the rig, or identity-made: inst/mac:<mac>),
   so its location is where the model contains it, not text; a plan is saved as the readiness block
   (apk.readiness/2) and its .ifc twin (js/readinessIfc.js: IfcWorkSchedule, one IfcTask per device). */
import { READINESS_STAGES, calculateGroupReadiness } from './readinessApp.js';
import { readinessFromIfc } from './readinessIfc.js';
import { ifcTypeFor } from './ifc/apk-ifc.mjs';

export const READINESS_BLOCK_TYPE = 'readiness_rollup';
export const READINESS_SCHEMA = 'apk.readiness/2';
const today = () => new Date().toISOString().slice(0, 10);
const MAC = /^[0-9a-f]{2}(:[0-9a-f]{2}){5,7}$/;

export class ReadinessModel {
  constructor(planName = 'SYSTEM-READINESS-ROLLUP') {
    this.planName = planName;
    this.createdOn = today();   // stored: the twin's CreationDate / StartTime, so a saved plan gives the same bytes
    this.source = null;         // {name, project} of the rig .ifc the assets were read from
    this.baseText = null;       // that rig, kept whole: the twin is written over it
    /* No demo assets: each comes from the BIM library (📚 Library, ROAD-3572), from
       Discovered, from a rig .ifc, or from an opened block. */
    this.devices = [];
  }

  /** The plan's id (the block id, and the GlobalId scope of a plan of its own). */
  planId() { return `readiness_${String(this.planName).toLowerCase().replace(/[^a-z0-9]/g, '_')}`; }

  addDevice(device = {}) {
    const d = {
      id: device.id || `dev-${this.devices.length + 1}`,
      name: device.name || 'New Hardware Asset',
      location: device.location || 'Rack 01',
      stage: device.stage || 'd0',
      targetDate: device.targetDate || '2026-11-30'
    };
    for (const k of ['gid', 'mac', 'serial', 'maker', 'bimId', 'ifcClass']) if (device[k]) d[k] = String(device[k]);
    if (d.mac) d.mac = d.mac.toLowerCase();
    if (device.reached && typeof device.reached === 'object') d.reached = { ...device.reached };
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
    const d = this.devices[index];
    if (!d) return;
    if (field === 'stage') this.setStage(d, value);
    else if (field === 'location' && d.gid && this.source) return;   // a rig's asset is where the model contains it
    else d[field] = value;
  }

  /** A stage edit records the day each stage up to it was first reached (IfcTaskTime.ActualFinish). */
  setStage(d, code, on = today()) {
    if (!/^d[0-8]$/.test(String(code))) return;
    d.stage = code;
    const n = Number(code.slice(1));
    const reached = { ...(d.reached || {}) };
    for (let k = 1; k <= 8; k++) {
      if (k <= n) reached[`d${k}`] ||= on;
      else delete reached[`d${k}`];
    }
    if (Object.keys(reached).length) d.reached = reached;
    else delete d.reached;
  }

  /** An asset for a part picked from the BIM library: its name is the part's, it keeps bimId and
      bimRef {part, url, rev} (bimLibrary.js bimFields). Each pick is one more asset — two of a
      model are two boxes to commission. */
  addFromPart(part = {}, bimRef = null) {
    let n = this.devices.length + 1;
    while (this.devices.some(d => d.id === `dev-${n}`)) n++;
    const choice = ifcTypeFor(part);
    return this.addDevice({
      id: `dev-${n}`,
      name: part.name || [part.manufacturer, part.model].filter(Boolean).join(' ') || part.id,
      location: '',
      stage: 'd0',
      bimId: part.id || '',
      bimRef: bimRef || part.ref || null,
      maker: part.manufacturer || '',
      ifcClass: choice.occurrence || 'IfcBuildingElementProxy'
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
      mac: MAC.test(String(t.mac || '').toLowerCase()) ? t.mac : '',
      serial: t.serial || '',
      maker: t.vendor || ''
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
    this.devices.forEach(d => this.setStage(d, 'd8'));
  }

  getRollup() {
    return calculateGroupReadiness(this.devices);
  }

  /** Open a rig / bench .ifc (one d0 asset per device occurrence) or a twin this editor saved (the plan
      back). An asset this plan already had for the same occurrence or identity keeps its stage, target
      date and the days it reached each stage. */
  loadIfc(text, name = 'model.ifc') {
    const got = readinessFromIfc(text);
    const old = this.devices;
    const same = (a, b) => (a.gid && a.gid === b.gid) || (a.mac && a.mac === b.mac) || (a.serial && a.serial === b.serial);
    this.devices = got.devices.map((d) => {
      const prev = got.fromSchedule ? null : old.find((o) => same(o, d));
      const keep = prev ? { stage: prev.stage, targetDate: prev.targetDate, ...(prev.reached ? { reached: { ...prev.reached } } : {}) } : {};
      return { ...d, ...keep };
    });
    if (got.fromSchedule) { this.planName = got.planName; if (got.createdOn) this.createdOn = got.createdOn; }
    this.source = { name, project: got.project };
    this.baseText = text;
    return got;
  }

  toBlock() {
    return {
      type: READINESS_BLOCK_TYPE,
      schema: READINESS_SCHEMA,
      id: this.planId(),
      planName: this.planName,
      createdOn: this.createdOn,
      source: this.source ? { ...this.source } : null,
      devices: JSON.parse(JSON.stringify(this.devices))
    };
  }

  fromBlock(block) {
    if (!block || typeof block !== 'object' || !Array.isArray(block.devices)) return false;
    if (block.planName) this.planName = block.planName;
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(block.createdOn || ''))) this.createdOn = block.createdOn;
    this.source = block.source || null;
    this.baseText = null;
    this.devices = JSON.parse(JSON.stringify(block.devices));
    return true;
  }
}

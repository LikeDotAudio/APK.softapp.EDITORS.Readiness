// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.
/* readinessIfc.js — READINESS STAGES AS AN IFC WORK SCHEDULE, ONE TASK PER OCCURRENCE (bom-fm-4).

   WRITE readinessToIfc(model) — over the rig the plan was opened from (kept whole), or a model of its own:
     IfcWorkSchedule <plan name>   Identification apk.readiness/2 (the projection marker), PredefinedType
                                   PLANNED, CreationDate / StartTime = the plan's createdOn, FinishTime =
                                   the latest target date; declared in the project (IfcRelDeclares)
       └ one IfcTask per device (IfcRelAssignsToControl), PredefinedType INSTALLATION, Identification =
         the asset #, Status = '<code> <stage name>' (d2 Mounted), APK_Readiness.StageCode = d0..d8;
         IfcTaskTime ScheduleFinish = target date, ActualFinish = when d8 was reached, Completion =
         stage/8 (IfcPositiveRatioMeasure, so none at d0); linked to its device by IfcRelAssignsToProduct
           └ the eight stage tasks d1..d8 nested in order (IfcRelNests), chained FINISH_START by
             IfcRelSequence; d8 Air Ready is the milestone; each stage reached carries ActualFinish
     the device                    the rig's occurrence (by GlobalId), else one written here: GlobalId
                                   inst/mac:<mac> | inst/serial:<serial> | readiness/<plan>/<asset #>
     location                      spatial containment, never text: the rig's IfcSpace, or (a plan of its
                                   own) one IfcSpace per location name under Site ▶ Building ▶ Level 0

   READ  readinessFromIfc(text) — the plan from an apk.readiness/2 schedule, else one d0 asset per device
         occurrence of a rig (cables, fasteners and kit units are not commissioned on their own).

   No IP ever enters the model: d5 records that an address was confirmed, not the address. */
import * as S from './ifc/apk-ifc.mjs';
import { IfcOut, ref, real, enumv, ident, str, refs, textOf, referrers, containers, dateTime } from './ifc/ifcOut.mjs';

export const READINESS_PROJECTION = 'apk.readiness/2';
const STAGE_NAMES = ['Unstaged', 'Delivered', 'Mounted', 'Cabled', 'Powered', 'IP Assigned', 'Firmware Updated', 'Configured', 'Air Ready'];
const NOT_COMMISSIONED = /^IFC(CABLESEGMENT|CABLEFITTING|MECHANICALFASTENER|DISCRETEACCESSORY|DISTRIBUTIONPORT)$/;
const rank = (code) => Math.max(0, Math.min(8, Number(String(code || 'd0').slice(1)) || 0));
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');

/** The occurrence GlobalId of a device: its identity first (site-wide rule, contracts guid.ts), never an IP. */
export function deviceGid(planId, d) {
  if (d.gid) return d.gid;
  if (d.mac) return S.ifcGuid(`inst/mac:${String(d.mac).toLowerCase()}`);
  if (d.serial) return S.ifcGuid(`inst/serial:${slug(d.maker || 'unknown')}/${d.serial}`);
  return S.ifcGuid('readiness', planId, 'device', String(d.id));
}

/* ================================================================== WRITE */

export function readinessToIfc(model) {
  const planId = model.planId();
  const out = model.baseText
    ? IfcOut.over(model.baseText, { strip: READINESS_PROJECTION })
    : IfcOut.fresh({ fileName: 'readiness.ifc', app: 'EDITORS.Readiness', project: model.planName, scope: `readiness/${planId}` });
  const R = ['readiness', out.projectGid, planId];
  const created = dateTime(model.createdOn) || '1970-01-01T00:00:00';
  const finishes = model.devices.map((d) => d.targetDate).filter((t) => ISO_DAY.test(String(t))).sort();
  const schedule = out.rooted('IFCWORKSCHEDULE', [...R, 'schedule'], [model.planName, null, null, READINESS_PROJECTION,
    created, null, 'Equipment readiness', null, null, created, finishes.length ? dateTime(finishes[finishes.length - 1]) : null, enumv('PLANNED')]);
  out.declare([...R, 'schedule'], [schedule]);

  // the devices: the rig's occurrences, else written here and contained in a space per location
  const occ = new Map();
  const missing = [];
  for (const d of model.devices) {
    const gid = deviceGid(planId, d);
    const r = out.byGid(gid);
    if (r) occ.set(d.id, r);
    else missing.push([d, gid]);
  }
  if (missing.length) {
    const spaces = spacesFor(out, R, missing.map(([d]) => d.location || ''));
    const bySpace = new Map();
    for (const [d, gid] of missing) {
      const entity = String(d.ifcClass || 'IfcBuildingElementProxy').toUpperCase();
      const layout = entity === 'IFCMECHANICALFASTENER' ? [null, null, null] : entity === 'IFCELEMENTASSEMBLY' ? [enumv('NOTDEFINED'), null] : [null];
      const r = out.add(entity, [gid, out.oh, str(d.name) || String(d.id), null, null, null, null, String(d.id), ...layout]);
      occ.set(d.id, r);
      const sp = spaces.get(d.location || '');
      (bySpace.get(sp.id) || bySpace.set(sp.id, [sp, []]).get(sp.id))[1].push(r);
      out.pset([...R, 'device', d.id], 'Pset_ManufacturerOccurrence', [r], [['SerialNumber', ident(d.serial)]]);
      out.pset([...R, 'device', d.id], 'APK_Identity', [r], [
        ['IdentityKey', ident(d.mac ? `mac:${String(d.mac).toLowerCase()}` : d.serial ? `serial:${slug(d.maker || 'unknown')}/${d.serial}` : null)],
        ['MacAddress', ident(d.mac ? String(d.mac).toLowerCase() : null)]]);
    }
    for (const [sp, list] of bySpace.values()) out.rooted('IFCRELCONTAINEDINSPATIALSTRUCTURE', [...R, 'contained', String(sp.id)], [null, null, list, sp]);
  }

  // one task per device, its eight stage tasks nested and chained
  const tasks = [];
  for (const d of model.devices) {
    const n = rank(d.stage);
    const code = `d${n}`;
    const reached = d.reached || {};
    const time = taskTime(out, d.targetDate, n === 8 ? reached.d8 : null, n / 8);
    const task = out.rooted('IFCTASK', [...R, 'task', d.id], [str(d.name) || String(d.id), null, null, String(d.id), null,
      `${code} ${STAGE_NAMES[n]}`, null, enumv('F'), null, time, enumv('INSTALLATION')]);
    tasks.push(task);
    out.pset([...R, 'task', d.id], 'APK_Readiness', [task], [['StageCode', ident(code)]]);
    out.rooted('IFCRELASSIGNSTOPRODUCT', [...R, 'task', d.id, 'product'], [null, null, [task], null, occ.get(d.id)]);
    const stages = [];
    for (let k = 1; k <= 8; k++) {
      const done = k <= n;
      const t = taskTime(out, null, done ? reached[`d${k}`] : null, done ? 1 : null);
      stages.push(out.rooted('IFCTASK', [...R, 'task', d.id, `d${k}`], [STAGE_NAMES[k], null, null, `${d.id}/d${k}`, null,
        done ? 'reached' : 'open', null, enumv(k === 8 ? 'T' : 'F'), null, t, enumv('INSTALLATION')]));
    }
    out.rooted('IFCRELNESTS', [...R, 'task', d.id, 'stages'], ['Stages', null, task, stages]);
    for (let k = 1; k < 8; k++) {
      out.rooted('IFCRELSEQUENCE', [...R, 'task', d.id, `d${k}`, 'next'], [null, null, stages[k - 1], stages[k], null, enumv('FINISH_START'), null]);
    }
  }
  if (tasks.length) out.rooted('IFCRELASSIGNSTOCONTROL', [...R, 'tasks'], [null, null, tasks, null, schedule]);
  return out.text();
}

function taskTime(out, finish, actual, completion) {
  const f = dateTime(finish), a = dateTime(actual);
  const c = completion && completion > 0 ? real(completion) : null;   // IfcPositiveRatioMeasure: > 0, so none at d0
  if (!f && !a && !c) return null;
  // Name, DataOrigin, UserDefinedDataOrigin, DurationType, ScheduleDuration, ScheduleStart, ScheduleFinish,
  // EarlyStart, EarlyFinish, LateStart, LateFinish, FreeFloat, TotalFloat, IsCritical, StatusTime,
  // ActualDuration, ActualStart, ActualFinish, RemainingTime, Completion
  return out.add('IFCTASKTIME', [null, null, null, null, null, null, f, null, null, null, null, null, null, null, null, null, null, a, null, c]);
}

/** location name -> its IfcSpace: the rig's space of that name, else one made here under the spine. */
function spacesFor(out, R, names) {
  const map = new Map();
  const have = out.all('IFCSPACE');
  const fallback = have[0] ? ref(have[0].id) : null;
  const want = [...new Set(names)];
  let storey = null;
  for (const name of want) {
    const same = have.find((s) => textOf(s.args[2]) === name);
    if (same) { map.set(name, ref(same.id)); continue; }
    if (!name && fallback) { map.set(name, fallback); continue; }
    storey ||= spine(out, R);
    map.set(name, out.rooted('IFCSPACE', [...R, 'space', name || 'unplaced'], [name || 'Unplaced', null, null, null, null, null,
      enumv('ELEMENT'), enumv('SPACE'), null]));
  }
  const mine = [...map.values()].filter((r) => !have.some((s) => s.id === r.id));
  if (mine.length) out.rooted('IFCRELAGGREGATES', [...R, 'spaces'], [null, null, storey, mine]);
  return map;
}

function spine(out, R) {
  const storey = out.first('IFCBUILDINGSTOREY');
  if (storey) return ref(storey.id);
  const site = out.rooted('IFCSITE', [...R, 'site'], ['Site', null, null, null, null, null, enumv('ELEMENT'), null, null, null, null, null]);
  const building = out.rooted('IFCBUILDING', [...R, 'building'], ['Building', null, null, null, null, null, enumv('ELEMENT'), null, null, null]);
  const st = out.rooted('IFCBUILDINGSTOREY', [...R, 'storey'], ['Level 0', null, null, null, null, null, enumv('ELEMENT'), null]);
  out.rooted('IFCRELAGGREGATES', [...R, 'site', 'agg'], [null, null, out.project, [site]]);
  out.rooted('IFCRELAGGREGATES', [...R, 'building', 'agg'], [null, null, site, [building]]);
  out.rooted('IFCRELAGGREGATES', [...R, 'storey', 'agg'], [null, null, building, [st]]);
  return st;
}

/* ================================================================== READ */

const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');

/** An IFC text → { planName, createdOn, project, devices } (devices in the readiness block's shape). */
export function readinessFromIfc(input) {
  const file = typeof input === 'string' ? S.parseStep(input) : input;
  const project = S.entitiesByType(file, 'IFCPROJECT')[0];
  if (!project) throw new Error('no IfcProject in this file');
  const within = containers(file);
  const parent = new Map();
  for (const rel of S.entitiesByType(file, 'IFCRELAGGREGATES')) {
    const host = S.deref(file, rel.args[4]);
    if (host) for (const r of refs(rel.args[5])) parent.set(r.id, host);
  }
  const where = (e) => {
    let at = within.get(e.id);
    for (let up = parent.get(e.id), hops = 0; !at && up && hops < 16; up = parent.get(up.id), hops++) at = within.get(up.id);
    return at && at.type === 'IFCSPACE' ? textOf(at.args[2]) : at ? textOf(at.args[2]) : '';
  };
  const identity = (e) => {
    const ps = S.getPsets(file, e);
    const out = {};
    const mac = str(ps.APK_Identity?.MacAddress);
    const serial = str(ps.Pset_ManufacturerOccurrence?.SerialNumber);
    if (mac) out.mac = mac.toLowerCase();
    if (serial) out.serial = serial;
    return out;
  };
  const occFields = (e) => ({ gid: e.args[0], location: where(e), ifcClass: ifcClassName(e.type), ...identity(e) });

  const schedule = S.entitiesByType(file, 'IFCWORKSCHEDULE').find((e) => e.args[5] === READINESS_PROJECTION);
  if (schedule) {
    const controls = referrers(file, 'IFCRELASSIGNSTOCONTROL', 6);
    const products = referrers(file, 'IFCRELASSIGNSTOPRODUCT', 4);
    const nests = referrers(file, 'IFCRELNESTS', 4);
    const devices = [];
    for (const rel of controls.get(schedule.id) || []) {
      for (const r of refs(rel.args[4])) {
        const t = file.byId.get(r.id);
        if (!t || t.type !== 'IFCTASK') continue;
        const code = str(S.getPsets(file, t).APK_Readiness?.StageCode) || String(textOf(t.args[7])).split(' ')[0] || 'd0';
        const tt = S.deref(file, t.args[11]);
        const d = { id: textOf(t.args[5]) || t.args[0], name: textOf(t.args[2]), location: '', stage: /^d[0-8]$/.test(code) ? code : 'd0',
          targetDate: tt ? day(textOf(tt.args[6])) : '' };
        const p = (products.get(t.id) || [])[0];
        const prod = p && S.deref(file, p.args[6]);
        if (prod) Object.assign(d, occFields(prod));
        const reached = {};
        for (const nr of nests.get(t.id) || []) {
          for (const sr of refs(nr.args[5])) {
            const st = file.byId.get(sr.id);
            const stt = st && S.deref(file, st.args[11]);
            const k = st ? String(textOf(st.args[5])).split('/').pop() : '';
            const when = stt ? day(textOf(stt.args[17])) : '';
            if (/^d[1-8]$/.test(k) && when) reached[k] = when;
          }
        }
        if (Object.keys(reached).length) d.reached = reached;
        devices.push(d);
      }
    }
    return { planName: textOf(schedule.args[2]) || 'READINESS', createdOn: day(textOf(schedule.args[6])), project: project.args[0], devices, fromSchedule: true };
  }

  // a rig without a plan: every device occurrence is an asset at d0
  const devices = [];
  const seen = new Set();
  for (const rel of S.entitiesByType(file, 'IFCRELDEFINESBYTYPE')) {
    for (const r of refs(rel.args[4])) {
      const e = file.byId.get(r.id);
      if (!e || seen.has(e.id) || NOT_COMMISSIONED.test(e.type)) continue;
      seen.add(e.id);
      devices.push({ id: textOf(e.args[7]) || e.args[0], name: textOf(e.args[2]) || textOf(e.args[7]), stage: 'd0', targetDate: '', ...occFields(e) });
    }
  }
  return { planName: textOf(project.args[2]) || 'READINESS', createdOn: '', project: project.args[0], devices, fromSchedule: false };
}

const ifcClassName = (upper) => {
  const m = /^IFC(.*)$/.exec(upper);
  if (!m) return upper;
  const words = ['AudioVisual', 'Appliance', 'Communications', 'Flow', 'Instrument', 'Electric', 'Element', 'Assembly', 'Building', 'Proxy',
    'Distribution', 'Board', 'Generator', 'Furniture', 'Outlet', 'Light', 'Fixture', 'Controller', 'Switching', 'Device', 'Protective',
    'Transformer', 'Unitary', 'Control', 'Mobile', 'Telecommunications', 'Storage', 'Cable', 'Segment', 'Fitting', 'Mechanical', 'Fastener', 'Discrete', 'Accessory'];
  let rest = m[1], outName = 'Ifc';
  while (rest) {
    const w = words.find((x) => rest.startsWith(x.toUpperCase()));
    if (!w) return upper;
    outName += w;
    rest = rest.slice(w.length);
  }
  return outName;
};

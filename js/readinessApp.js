// Equipment Staging & Commissioning Readiness Engine
// Part of the APK.audio project — http://APK.audio — Anthony Kuzub
// MIT Licence. Free, for everyone, forever.
/* The block goes in and out over cad.like.audio/host@1 (window.APKSoftapp.connectHost,
   vendor/apk-softapp/); the pipeline is APKTable 'readiness-assets' (vendor/apk-table/).
   "Discovered" lists what the bus knows (js/discoveredPanel.js, kinds in
   config/discovery.json): an asset can be added from it, and every asset with a
   MAC or serial shows whether the network sees it now (live state + why). */

import { ReadinessModel, READINESS_BLOCK_TYPE } from './readinessModel.js';
import { DiscoveredPanel } from './discoveredPanel.js';

export { ReadinessModel };

export const READINESS_STAGES = [
  { code: 'd0', name: 'Unstaged', color: '#6b7280', desc: 'Equipment pending procurement or receipt' },
  { code: 'd1', name: 'Delivered', color: '#3b82f6', desc: 'Received on site and unboxed' },
  { code: 'd2', name: 'Mounted', color: '#06b6d4', desc: 'Physically racked or mounted in room' },
  { code: 'd3', name: 'Cabled', color: '#8b5cf6', desc: 'Audio, network, and power lines connected' },
  { code: 'd4', name: 'Powered', color: '#f59e0b', desc: 'AC/PoE power applied and verified' },
  { code: 'd5', name: 'IP Assigned', color: '#10b981', desc: 'Static IP or DHCP lease confirmed' },
  { code: 'd6', name: 'Firmware Updated', color: '#14b8a6', desc: 'Approved firmware baseline flashed' },
  { code: 'd7', name: 'Configured', color: '#6366f1', desc: 'DSP/Switch/Matrix config pushed' },
  { code: 'd8', name: 'Air Ready', color: '#22c55e', desc: 'End-to-end signal test passed and commissioned' }
];

export function readinessLabel(stageCode) {
  const stage = READINESS_STAGES.find(s => s.code === stageCode);
  return stage ? stage.name : 'Unknown';
}

export function stageRank(stageCode) {
  const idx = READINESS_STAGES.findIndex(s => s.code === stageCode);
  return idx >= 0 ? idx : 0;
}

export function calculateGroupReadiness(devices = []) {
  if (!devices || devices.length === 0) {
    return {
      devices: 0,
      staged: 0,
      stage: null,
      percent: 0,
      isAirReady: false
    };
  }

  const stagedCount = devices.filter(d => stageRank(d.stage) >= 1).length;
  const fullyAirReadyCount = devices.filter(d => d.stage === 'd8').length;
  const isAirReady = fullyAirReadyCount === devices.length;

  // Group stage is the minimum stage among all required devices
  let minRank = 8;
  devices.forEach(d => {
    const r = stageRank(d.stage);
    if (r < minRank) minRank = r;
  });

  const overallStage = READINESS_STAGES[minRank].code;
  const avgRank = devices.reduce((sum, d) => sum + stageRank(d.stage), 0) / (devices.length * 8);
  const percent = Math.round(avgRank * 100);

  return {
    devices: devices.length,
    staged: stagedCount,
    stage: overallStage,
    percent,
    isAirReady
  };
}

export function readinessBadge(readiness) {
  if (!readiness || readiness.devices === 0) return 'No devices';
  if (readiness.isAirReady) return 'Air Ready';
  if (readiness.stage === 'd0') return `${readiness.staged}/${readiness.devices} staged`;
  return `${readinessLabel(readiness.stage)} (${readiness.percent}%)`;
}

export function readinessTitle(readiness, groupName = 'Group') {
  if (!readiness || readiness.devices === 0) return `${groupName}: No devices mapped`;
  const stageName = readinessLabel(readiness.stage);
  if (readiness.isAirReady) {
    return `${groupName}: 100% Commissioned & Air Ready (${readiness.devices} devices)`;
  }
  return `${groupName}: Current Stage [${stageName}] · ${readiness.staged} of ${readiness.devices} devices staged (${readiness.percent}% complete)`;
}

export function estimateTimeToAir(devices = [], targetAirDate = null) {
  const readiness = calculateGroupReadiness(devices);
  if (readiness.isAirReady) {
    return { status: 'Air Ready', daysRemaining: 0, date: targetAirDate || 'Now' };
  }
  const remainingWorkPercent = 100 - readiness.percent;
  // Estimate ~0.5 days per 10% remaining work per device group
  const daysRemaining = Math.max(1, Math.ceil((remainingWorkPercent / 10) * 0.5));
  return {
    status: 'In Progress',
    daysRemaining,
    percent: readiness.percent
  };
}

export class ReadinessApp {
  constructor() {
    this.model = new ReadinessModel();
    this.things = [];
    const S = window.APKSoftapp;
    S.inheritTheme();
    this.tableHost = document.getElementById('device-table');
    this.host = S.connectHost({
      editor: 'Equipment Readiness',
      blockType: READINESS_BLOCK_TYPE,
      onLoad: (b, m) => this.handleBlockLoaded(b, m),
      onRequest: () => this.model.toBlock()
    });
    this.discovered = new DiscoveredPanel({
      tableId: 'readiness-discovered',
      tableHost: document.getElementById('discovered-table'),
      statusEl: document.getElementById('discovered-status'),
      configUrl: new URL('../config/discovery.json', import.meta.url),
      pickLabel: 'Add asset',
      onPick: (thing) => { if (this.model.addFromThing(thing)) this.changed(); },
      onThings: (things) => { this.things = things; this.renderTable({ fromBus: true }); }
    });
    this.initControls();
    this.render();
    this.discovered.start();
  }

  handleBlockLoaded(block, meta = {}) {
    if (!this.model.fromBlock(block)) return;
    const tag = document.getElementById('block-tag');
    if (tag && (meta.title || meta.blockName)) tag.textContent = meta.title || meta.blockName;
    this.render();
  }

  changed() {
    this.render();
    this.host.changed(this.model.toBlock());
  }

  initControls() {
    document.getElementById('btn-save')?.addEventListener('click', () => {
      this.host.save(this.model.toBlock(), { title: this.model.planName, filename: this.model.planName });
    });

    document.getElementById('btn-open')?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            this.handleBlockLoaded(JSON.parse(evt.target.result), { title: file.name });
            this.host.changed(this.model.toBlock());
          } catch (err) {
            alert('Invalid block file: ' + err.message);
          }
        };
        reader.readAsText(file);
      };
      input.click();
    });

    document.getElementById('btn-close')?.addEventListener('click', () => this.host.close());

    document.getElementById('btn-discovered')?.addEventListener('click', () => {
      const panel = document.getElementById('discovered-panel');
      if (panel) panel.hidden = !panel.hidden;
    });

    document.getElementById('btn-add-device')?.addEventListener('click', () => {
      this.model.addDevice();
      this.changed();
    });

    document.getElementById('btn-mark-all')?.addEventListener('click', () => {
      this.model.setAllAirReady();
      this.changed();
    });

    document.getElementById('prop-planName')?.addEventListener('input', (e) => {
      this.model.planName = e.target.value;
      this.host.changed(this.model.toBlock());
    });
  }

  render() {
    const propPlan = document.getElementById('prop-planName');
    if (propPlan && propPlan !== document.activeElement) propPlan.value = this.model.planName;
    this.renderKPIs();
    this.renderTable();
  }

  renderKPIs() {
    const rollup = this.model.getRollup();
    const eta = estimateTimeToAir(this.model.devices);

    const valPct = document.getElementById('kpi-percent');
    if (valPct) valPct.textContent = `${rollup.percent}%`;

    const valStage = document.getElementById('kpi-stage');
    if (valStage) valStage.textContent = readinessLabel(rollup.stage);

    const valStaged = document.getElementById('kpi-staged');
    if (valStaged) valStaged.textContent = `${rollup.staged} / ${rollup.devices}`;

    const valEta = document.getElementById('kpi-eta');
    if (valEta) valEta.textContent = eta.status === 'Air Ready' ? 'Air Ready' : `~${eta.daysRemaining} Days`;

    const progressFill = document.getElementById('overall-progress-fill');
    if (progressFill) {
      progressFill.style.width = `${rollup.percent}%`;
      progressFill.style.background = rollup.percent === 100 ? '#22C55E' : (rollup.percent > 60 ? '#4A9EFF' : '#F4902C');
    }
  }

  stageCell(dev) {
    const stageObj = READINESS_STAGES.find(s => s.code === dev.stage) || READINESS_STAGES[0];
    const sel = document.createElement('select');
    sel.className = 'control-select stage-select';
    sel.style.borderLeft = `3px solid ${stageObj.color}`;
    READINESS_STAGES.forEach((s) => {
      const op = document.createElement('option');
      op.value = s.code;
      op.textContent = `${s.code.toUpperCase()}: ${s.name}`;
      op.title = s.desc;
      if (s.code === dev.stage) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener('change', () => {
      dev.stage = sel.value;
      this.changed();
    });
    return sel;
  }

  networkCell(dev) {
    const [state, why] = this.model.networkState(dev, this.things);
    const span = document.createElement('span');
    if (state) span.setAttribute('data-apk-state', state);
    span.textContent = state ? `${state}${why ? ' · ' + why : ''}` : why;
    return span;
  }

  rows() {
    return this.model.devices.map((d) => ({ ...d, network: this.model.networkState(d, this.things)[0] }));
  }

  renderTable({ fromBus = false } = {}) {
    if (!this.tableHost) return;
    if (this.table) {
      // A bus update (re-judged every 15 s) waits while a cell is being typed in; the next tick catches up.
      const a = document.activeElement;
      if (fromBus && a && a.isContentEditable && this.tableHost.contains(a)) return;
      this.table.setRows(this.rows());
      return;
    }
    const dev = (i) => this.model.devices[i];
    this.table = window.APKTable.create(this.tableHost, {
      id: 'readiness-assets',
      columns: [
        { key: 'id', label: 'Asset #', editable: false, mono: true },
        { key: 'name', label: 'Equipment Model & Description' },
        { key: 'location', label: 'Physical Location / Rack' },
        { key: 'stage', label: 'Commissioning Stage', render: (_v, _row, i) => this.stageCell(dev(i)) },
        { key: 'targetDate', label: 'Target Date', mono: true },
        { key: 'network', label: 'On the network', render: (_v, _row, i) => this.networkCell(dev(i)) },
      ],
      rows: this.rows(),
      onEdit: (i, key, value) => { this.model.updateDevice(i, key, String(value).trim()); this.renderKPIs(); this.host.changed(this.model.toBlock()); },
      onDelete: (i) => { this.model.removeDevice(i); this.changed(); },
      empty: 'No hardware assets yet.'
    });
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    new ReadinessApp();
  });
}

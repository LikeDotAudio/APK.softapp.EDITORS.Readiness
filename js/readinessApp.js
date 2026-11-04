// Equipment Staging & Commissioning Readiness Engine
// Part of the APK.audio project — http://APK.audio — Anthony Kuzub
// MIT Licence. Free, for everyone, forever.

import { BlockBridge } from './blockBridge.js';
import { ReadinessModel } from './readinessModel.js';

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
    this.bridge = new BlockBridge({
      name: 'Equipment Readiness',
      type: 'readiness_rollup',
      onBlockLoaded: (b, m) => this.handleBlockLoaded(b, m),
      onBlockChanged: () => this.render()
    });

    this.tableBody = document.getElementById('device-table-body');
    this.initControls();
    this.render();
    this.autoConnect();
  }

  async autoConnect() {
    const discovered = await this.bridge.fetchDiscoveredProject();
    if (discovered && discovered.readiness && discovered.readiness.length > 0) {
      this.model.fromBlock(discovered.readiness[0]);
      this.render();
    } else if (discovered && discovered.devices && discovered.devices.length > 0) {
      this.model.devices = discovered.devices.map((d, i) => ({
        id: d.id || `dev-${i + 1}`,
        name: d.name || d.model || 'Discovered Asset',
        location: d.location || d.rack || 'Rack 01',
        stage: 'd2',
        targetDate: '2026-11-20'
      }));
      this.render();
    }
  }

  handleBlockLoaded(block, meta) {
    if (block) {
      this.model.fromBlock(block);
      this.render();
    }
  }

  initControls() {
    const btnSave = document.getElementById('btn-save');
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        this.bridge.saveBlock(this.model.toBlock(), { name: this.model.planName });
      });
    }

    const btnOpen = document.getElementById('btn-open');
    if (btnOpen) {
      btnOpen.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (evt) => {
            try {
              const data = JSON.parse(evt.target.result);
              this.model.fromBlock(data);
              this.render();
            } catch (err) {
              alert('Invalid block file: ' + err.message);
            }
          };
          reader.readAsText(file);
        };
        input.click();
      });
    }

    const btnClose = document.getElementById('btn-close');
    if (btnClose) {
      btnClose.addEventListener('click', () => this.bridge.close());
    }

    const btnDiscovered = document.getElementById('btn-discovered');
    if (btnDiscovered) {
      btnDiscovered.addEventListener('click', async () => {
        await this.autoConnect();
      });
    }

    const btnAddDev = document.getElementById('btn-add-device');
    if (btnAddDev) {
      btnAddDev.addEventListener('click', () => {
        this.model.addDevice();
        this.render();
        this.bridge.notifyChanged();
      });
    }

    const btnMarkAll = document.getElementById('btn-mark-all');
    if (btnMarkAll) {
      btnMarkAll.addEventListener('click', () => {
        this.model.setAllAirReady();
        this.render();
        this.bridge.notifyChanged();
      });
    }

    const propPlan = document.getElementById('prop-planName');
    if (propPlan) {
      propPlan.addEventListener('input', (e) => {
        this.model.planName = e.target.value;
        this.bridge.notifyChanged();
      });
    }
  }

  render() {
    const propPlan = document.getElementById('prop-planName');
    if (propPlan) {
      propPlan.value = this.model.planName;
    }

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

  renderTable() {
    if (!this.tableBody) return;
    this.tableBody.innerHTML = '';

    const stageOptions = (currentStage) => {
      return READINESS_STAGES.map(s => `
        <option value="${s.code}" ${s.code === currentStage ? 'selected' : ''}>
          ${s.code.toUpperCase()}: ${s.name}
        </option>
      `).join('');
    };

    this.model.devices.forEach((dev, idx) => {
      const tr = document.createElement('tr');
      const stageObj = READINESS_STAGES.find(s => s.code === dev.stage) || READINESS_STAGES[0];

      tr.innerHTML = `
        <td style="color: var(--text-muted); font-size: 11px;">#${dev.id}</td>
        <td class="inline-cell" contenteditable="true" data-idx="${idx}" data-field="name">${dev.name}</td>
        <td class="inline-cell" contenteditable="true" data-idx="${idx}" data-field="location">${dev.location}</td>
        <td>
          <select class="control-select stage-select" data-idx="${idx}" data-field="stage" style="border-left: 3px solid ${stageObj.color};">
            ${stageOptions(dev.stage)}
          </select>
        </td>
        <td class="inline-cell" contenteditable="true" data-idx="${idx}" data-field="targetDate">${dev.targetDate}</td>
        <td style="text-align: center;">
          <button class="btn-delete" data-idx="${idx}" title="Delete Device">✕</button>
        </td>
      `;

      this.tableBody.appendChild(tr);
    });

    this.tableBody.querySelectorAll('[contenteditable=true]').forEach(cell => {
      cell.addEventListener('blur', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        const field = e.target.dataset.field;
        this.model.updateDevice(idx, field, e.target.innerText.trim());
        this.renderKPIs();
        this.bridge.notifyChanged();
      });
    });

    this.tableBody.querySelectorAll('select.stage-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        this.model.updateDevice(idx, 'stage', e.target.value);
        this.renderKPIs();
        this.bridge.notifyChanged();
      });
    });

    this.tableBody.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.idx, 10);
        this.model.removeDevice(idx);
        this.render();
        this.bridge.notifyChanged();
      });
    });
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    new ReadinessApp();
  });
}

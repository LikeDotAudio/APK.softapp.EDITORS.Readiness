// Equipment Staging & Commissioning Readiness Engine
// Part of the APK.audio project — http://APK.audio — Anthony Kuzub
// MIT Licence. Free, for everyone, forever.

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

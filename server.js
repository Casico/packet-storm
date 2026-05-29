const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

// ---- Constants ----
const TRAVERSAL_MS = 1500;

const TASK_FIRE_MS = 10000;
const TASK_WARMUP_MS = 5000;
const BANDWIDTH_PER_TASK = 1;

const THREAT_FIRE_MS = 22000;
const THREAT_WARMUP_MS = 15000;
const BANDWIDTH_PER_THREAT = 2;

const SPAWN_INTERVAL_MS = 60000;
const SHADOW_TIMEOUT_MS = 45000;
const LINK_BUILD_COST = 1;
const MAX_EDGE_CAPACITY = 3;
const MAX_NODE_DEGREE = 6;

const ROUND_DURATION_MS = 8 * 60 * 1000;
const ALERT_QUEUE_MAX = 6;

const STARTING_BANDWIDTH = 3;

const COLORS = [
  '#ff6b6b', '#4ecdc4', '#ffe66d', '#a8e6cf', '#c7a4ff',
  '#ffa45e', '#ff9ff3', '#54a0ff', '#48dbfb', '#1dd1a1',
];

// ---- Roles ----
const ROLES = ['NetEng', 'SecOps', 'SysAdmin', 'NOC'];
const ROLE_TARGETS = {
  1: [1,0,0,0], 2: [1,1,0,0], 3: [1,1,1,0], 4: [1,1,1,1],
  5: [2,1,1,1], 6: [2,2,1,1], 7: [2,2,2,1],
  8: [3,2,2,1], 9: [3,3,2,1], 10: [3,3,3,1],
};

function pickRoleForJoin(room) {
  const counts = { NetEng: 0, SecOps: 0, SysAdmin: 0, NOC: 0 };
  for (const p of room.players.values()) counts[p.role]++;
  const newTotal = room.players.size + 1;
  const targets = ROLE_TARGETS[newTotal] || ROLE_TARGETS[10];
  for (let i = 0; i < ROLES.length; i++) {
    if (counts[ROLES[i]] < targets[i]) return ROLES[i];
  }
  const overflow = ['NetEng', 'SecOps', 'SysAdmin'];
  return overflow[(room.players.size - 10) % overflow.length];
}

// ---- Random topology generator ----
// Layered network: Internet → Firewall → Core(s) → Access switches → Hosts (one critical).
// Each new room gets a fresh map.
const FW_NAMES     = ['Edge-FW', 'Perimeter-FW', 'Border-FW', 'DMZ-FW'];
const CORE_NAMES   = ['Core-SW', 'Backbone-SW', 'Spine-1', 'Spine-2', 'Distrib-SW'];
const HOST_NAMES   = ['Web-SRV', 'File-SRV', 'Mail-SRV', 'DNS-01', 'App-SRV', 'Backup-SRV', 'Wiki', 'GitLab', 'Jira', 'Print-SRV', 'CDN-Node', 'CI-Runner'];
const CRIT_NAMES   = ['Customer-DB', 'Prod-DB', 'Finance-DB', 'Patient-DB', 'Billing-DB', 'Orders-DB'];

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateTopology() {
  const nodes = [];
  const edges = [];
  const xOf = (id) => nodes.find((n) => n.id === id).x;

  // Internet (always 1)
  nodes.push({ id: 'internet', label: 'Internet', x: 0.50, y: 0.08, type: 'external' });

  // Firewall (always 1)
  nodes.push({ id: 'fw', label: choice(FW_NAMES), x: 0.50, y: 0.22, type: 'firewall' });
  edges.push(['internet', 'fw', 1]);

  // Cores (1 or 2)
  const numCores = randInt(1, 2);
  const coreNames = shuffled(CORE_NAMES).slice(0, numCores);
  const coreIds = [];
  for (let i = 0; i < numCores; i++) {
    const id = `core-${i + 1}`;
    const x = numCores === 1 ? 0.50 : (i === 0 ? 0.32 : 0.68);
    nodes.push({ id, label: coreNames[i], x, y: 0.42, type: 'switch' });
    edges.push(['fw', id, 1]);
    coreIds.push(id);
  }

  // Access switches (2-4), each connects to nearest core, optionally redundant
  const numAccess = randInt(2, 4);
  const accessIds = [];
  for (let i = 0; i < numAccess; i++) {
    const id = `access-${i + 1}`;
    const x = 0.06 + (i + 0.5) * (0.88 / numAccess);
    nodes.push({ id, label: `Access-SW-${i + 1}`, x, y: 0.62, type: 'switch' });
    // Prefer the core closest in x to keep edges from crossing wildly
    const corePicks = [...coreIds].sort((a, b) => Math.abs(xOf(a) - x) - Math.abs(xOf(b) - x));
    edges.push([corePicks[0], id, 1]);
    if (corePicks.length > 1 && Math.random() < 0.35) {
      edges.push([corePicks[1], id, 1]);
    }
    accessIds.push(id);
  }

  // Hosts (4-7), one is the critical asset
  const numHosts = randInt(4, 7);
  const hostNamePool = shuffled(HOST_NAMES);
  const criticalIdx = randInt(0, numHosts - 1);
  const criticalLabel = choice(CRIT_NAMES);
  let criticalNodeId = null;

  for (let i = 0; i < numHosts; i++) {
    const id = `host-${i + 1}`;
    const x = 0.05 + (i + 0.5) * (0.90 / numHosts);
    const isCritical = i === criticalIdx;
    const label = isCritical ? criticalLabel : hostNamePool[i % hostNamePool.length];
    nodes.push({ id, label, x, y: 0.86, type: 'host' });
    if (isCritical) criticalNodeId = id;

    // Connect to closest access switch (with light randomness — 1 of nearest 2)
    const accessPicks = [...accessIds].sort((a, b) => Math.abs(xOf(a) - x) - Math.abs(xOf(b) - x));
    const primary = accessPicks[Math.min(randInt(0, 1), accessPicks.length - 1)];
    edges.push([primary, id, 1]);

    // Optional redundant access link (25%)
    if (accessIds.length > 1 && Math.random() < 0.25) {
      const others = accessPicks.filter((a) => a !== primary);
      edges.push([others[0], id, 1]);
    }
  }

  // 60% chance of an HA path: core → critical
  if (Math.random() < 0.6) {
    const haCore = choice(coreIds);
    const dup = edges.some(([a, b]) =>
      (a === haCore && b === criticalNodeId) || (b === haCore && a === criticalNodeId)
    );
    if (!dup) edges.push([haCore, criticalNodeId, 1]);
  }

  return { nodes, edges, criticalNodeId };
}

const edgeKey = (a, b) => [a, b].sort().join('|');
const neighborsOf = (topo, id) =>
  topo.edges.filter(([a, b]) => a === id || b === id).map(([a, b]) => (a === id ? b : a));
const nodeById = (topo, id) => topo.nodes.find((n) => n.id === id);
const isConnected = (topo, id) => topo.edges.some(([a, b]) => a === id || b === id);
const findEdge = (topo, a, b) =>
  topo.edges.find(([x, y]) => (x === a && y === b) || (x === b && y === a));
const capacityOf = (topo, a, b) => {
  const e = findEdge(topo, a, b);
  return e ? (e[2] || 1) : 1;
};
const degreeOf = (topo, id) =>
  topo.edges.reduce((n, [a, b]) => n + (a === id || b === id ? 1 : 0), 0);

// ---- Random helpers ----
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const choice = (arr) => arr[randInt(0, arr.length - 1)];
const randVlan = () => randInt(10, 199);
const randIp = () => `${randInt(10,250)}.${randInt(0,250)}.${randInt(0,250)}.${randInt(1,254)}`;
const randPort = () => choice([22, 25, 53, 80, 443, 3306, 5432, 8080, 8443]);
const randSvc = () => choice(['nginx','sshd','postgres','redis','docker','cron','systemd-resolved']);
const randIface = () => `gi0/${randInt(1, 24)}`;
const randCve = () => `CVE-2025-${randInt(1000, 9999)}`;

const SPAWN_TYPES = ['IoT-Cam', 'Printer', 'Branch-FW', 'Guest-AP', 'Desktop', 'VOIP', 'Kiosk', 'Badge-Rdr'];

// ---- Task templates ----
const TASK_TEMPLATES = [
  { role: 'NetEng',   nodeTypes: ['switch'],                       verb: () => `Assign VLAN ${randVlan()} to ${randIface()}` },
  { role: 'NetEng',   nodeTypes: ['switch','firewall'],            verb: () => `Push static route to ${randIp()}/24` },
  { role: 'NetEng',   nodeTypes: ['switch'],                       verb: () => `Reset port ${randIface()}` },
  { role: 'NetEng',   nodeTypes: ['firewall'],                     verb: () => `Bring up tunnel ipsec-${randInt(1,8)}` },
  { role: 'NetEng',   nodeTypes: ['switch'],                       verb: () => `Enable STP on bridge ${randInt(1,4)}` },

  { role: 'SecOps',   nodeTypes: ['firewall'],                     verb: () => `Permit TCP ${randPort()} from any` },
  { role: 'SecOps',   nodeTypes: ['firewall'],                     verb: () => `Deny TCP ${randPort()} from ${randIp()}` },
  { role: 'SecOps',   nodeTypes: ['switch','firewall'],            verb: () => `Block IP ${randIp()}` },
  { role: 'SecOps',   nodeTypes: ['switch'],                       verb: () => `Quarantine VLAN ${randVlan()}` },
  { role: 'SecOps',   nodeTypes: ['host'],                         verb: () => `Kill SSH session pid ${randInt(1000,9999)}` },

  { role: 'SysAdmin', nodeTypes: ['host'],                         verb: () => `Patch ${randCve()}` },
  { role: 'SysAdmin', nodeTypes: ['host'],                         verb: () => `Restart ${randSvc()}` },
  { role: 'SysAdmin', nodeTypes: ['host'],                         verb: () => `Rotate creds for ${randSvc()}` },
  { role: 'SysAdmin', nodeTypes: ['host'],                         verb: () => `Clear /var/log/${randSvc()}.log` },
  { role: 'SysAdmin', nodeTypes: ['host'],                         verb: () => `Run apt upgrade -y` },

  { role: 'NOC',      nodeTypes: ['firewall','switch','host'],     verb: () => `Open ticket INC-${randInt(10000,99999)}` },
  { role: 'NOC',      nodeTypes: ['firewall','switch','host'],     verb: () => `Acknowledge alert ALT-${randInt(100,999)}` },
  { role: 'NOC',      nodeTypes: ['switch','firewall'],            verb: () => `Run packet capture for 10s` },
  { role: 'NOC',      nodeTypes: ['host'],                         verb: () => `Page on-call (Sev-${randInt(1,3)})` },
];

// ---- Threat templates ----
const THREAT_TEMPLATES = [
  { role: 'SecOps',   nodeTypes: ['firewall'],          durationMs: 45000, name: () => `Port scan from ${randIp()}` },
  { role: 'SecOps',   nodeTypes: ['host'],              durationMs: 40000, name: () => `Ransomware spreading` },
  { role: 'SecOps',   nodeTypes: ['switch'],            durationMs: 35000, name: () => `MAC flood attack` },
  { role: 'SecOps',   nodeTypes: ['firewall'],          durationMs: 35000, name: () => `Brute force on TCP ${randPort()}` },

  { role: 'SysAdmin', nodeTypes: ['host'],              durationMs: 40000, name: () => `Zero-day RCE: ${randCve()}` },
  { role: 'SysAdmin', nodeTypes: ['host'],              durationMs: 50000, name: () => `Disk at 98%, IO blocked` },
  { role: 'SysAdmin', nodeTypes: ['host'],              durationMs: 35000, name: () => `Service crashed: ${randSvc()}` },

  { role: 'NetEng',   nodeTypes: ['switch','firewall'], durationMs: 40000, name: () => `BGP flap on AS${randInt(100,9999)}` },
  { role: 'NetEng',   nodeTypes: ['switch'],            durationMs: 30000, name: () => `Spanning tree storm` },
  { role: 'NetEng',   nodeTypes: ['switch'],            durationMs: 35000, name: () => `MTU mismatch on uplink` },

  { role: 'NOC',      nodeTypes: ['firewall','switch','host'], durationMs: 50000, name: () => `Cryptic alert — run pcap` },
];

// ---- Rooms ----
const rooms = new Map();

function makeRoomCode() {
  let code;
  do {
    code = Math.random().toString(36).slice(2, 6).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function newRoom() {
  const gen = generateTopology();
  console.log(`[room] generated topology: ${gen.nodes.length} nodes, ${gen.edges.length} edges, critical=${gen.criticalNodeId}`);
  return {
    players: new Map(),
    traversals: new Map(),
    tasks: new Map(),
    taskHolders: new Map(),
    pendingTasks: [],
    threats: new Map(),
    alertQueue: 0,
    bandwidth: STARTING_BANDWIDTH,
    taskSeq: 1,
    threatSeq: 1,
    spawnSeq: 1,
    gameState: 'lobby',
    hostId: null,
    roundEndsAt: null,
    taskInterval: null,
    threatInterval: null,
    spawnInterval: null,
    roundEndTimeout: null,
    topology: { nodes: gen.nodes, edges: gen.edges },
    criticalNode: gen.criticalNodeId,
    stats: { tasksCompleted: 0, threatsResolved: 0, threatsExpired: 0, nodesConnected: 0, nodesShadowed: 0 },
  };
}

// ---- Task lifecycle ----
function assignTaskToHolder(room, pending, holderId) {
  const task = {
    id: `t${room.taskSeq++}`,
    requiredRole: pending.template.role,
    requiredNode: pending.node.id,
    nodeLabel: pending.node.label,
    verb: pending.verb || pending.template.verb(),
    holderId,
    createdAt: Date.now(),
  };
  room.tasks.set(task.id, task);
  room.taskHolders.set(holderId, task.id);
}

function eligibleHolders(room, requiredRole) {
  return Array.from(room.players.values()).filter(
    (p) => p.role !== requiredRole && !room.taskHolders.has(p.id)
  );
}

function tryAssign(room, pending) {
  const candidates = eligibleHolders(room, pending.template.role);
  if (candidates.length === 0) { room.pendingTasks.push(pending); return false; }
  assignTaskToHolder(room, pending, choice(candidates).id);
  return true;
}

function drainPending(room) {
  const remaining = [];
  for (const pt of room.pendingTasks) {
    const candidates = eligibleHolders(room, pt.template.role);
    if (candidates.length === 0) remaining.push(pt);
    else assignTaskToHolder(room, pt, choice(candidates).id);
  }
  room.pendingTasks = remaining;
}

function reQueueTask(room, task) {
  const node = nodeById(room.topology, task.requiredNode);
  room.pendingTasks.push({
    template: { role: task.requiredRole, verb: () => task.verb, nodeTypes: [node && node.type] },
    node: { id: task.requiredNode, label: task.nodeLabel },
    verb: task.verb,
  });
}

function fireTask(io, code) {
  const room = rooms.get(code);
  if (!room || room.gameState !== 'playing' || room.players.size === 0) return;
  const rolesPresent = new Set(Array.from(room.players.values()).map((p) => p.role));
  const executable = TASK_TEMPLATES.filter((t) => rolesPresent.has(t.role));
  if (executable.length === 0) return;
  const template = choice(executable);
  // Tasks only target connected, non-spawn nodes (spawns aren't "real" yet)
  const candidateNodes = room.topology.nodes.filter(
    (n) => template.nodeTypes.includes(n.type) && !n.isSpawn
  );
  if (candidateNodes.length === 0) return;
  tryAssign(room, { template, node: choice(candidateNodes) });
  emitState(io, code);
}

// ---- Threat lifecycle ----
function fireThreat(io, code) {
  const room = rooms.get(code);
  if (!room || room.gameState !== 'playing' || room.players.size === 0) return;
  const rolesPresent = new Set(Array.from(room.players.values()).map((p) => p.role));
  const executable = THREAT_TEMPLATES.filter((t) => rolesPresent.has(t.role));
  if (executable.length === 0) return;
  const template = choice(executable);
  const candidateNodes = room.topology.nodes.filter(
    (n) => template.nodeTypes.includes(n.type) && !n.isSpawn
  );
  if (candidateNodes.length === 0) return;
  const node = choice(candidateNodes);
  const now = Date.now();
  const threat = {
    id: `th${room.threatSeq++}`,
    requiredRole: template.role,
    requiredNode: node.id,
    nodeLabel: node.label,
    name: template.name(),
    createdAt: now,
    expiresAt: now + template.durationMs,
  };
  room.threats.set(threat.id, threat);
  threat._timer = setTimeout(() => expireThreat(io, code, threat.id), template.durationMs);
  console.log(`[${code}] THREAT fire: ${threat.name} @ ${node.id} (need ${threat.requiredRole}, ${template.durationMs/1000}s)`);
  emitState(io, code);
}

function expireThreat(io, code, threatId) {
  const room = rooms.get(code);
  if (!room) return;
  const threat = room.threats.get(threatId);
  if (!threat) return;
  room.threats.delete(threatId);
  room.stats.threatsExpired++;
  console.log(`[${code}] THREAT expired: ${threat.name} @ ${threat.requiredNode}`);

  if (threat.requiredNode === room.criticalNode) {
    const critNode = nodeById(room.topology, room.criticalNode);
    const critLabel = critNode ? critNode.label : 'Critical asset';
    gameOver(io, code, `${critLabel} compromised — ${threat.name}`);
    return;
  }
  room.alertQueue++;
  if (room.alertQueue > ALERT_QUEUE_MAX) {
    gameOver(io, code, `Alert queue overflowed (${room.alertQueue})`);
    return;
  }
  io.to(code).emit('threat-expired', { name: threat.name, nodeLabel: threat.nodeLabel });
  emitState(io, code);
}

// ---- Node spawn lifecycle ----
function pickSpawnPosition(topology) {
  for (let tries = 0; tries < 30; tries++) {
    const x = 0.08 + Math.random() * 0.84;
    const y = 0.10 + Math.random() * 0.80;
    let tooClose = false;
    for (const n of topology.nodes) {
      if (Math.hypot(n.x - x, n.y - y) < 0.13) { tooClose = true; break; }
    }
    if (!tooClose) return { x, y };
  }
  return { x: Math.random() * 0.9 + 0.05, y: Math.random() * 0.9 + 0.05 };
}

function fireSpawn(io, code) {
  const room = rooms.get(code);
  if (!room || room.gameState !== 'playing' || room.players.size === 0) return;

  const id = `spawn-${room.spawnSeq}`;
  const baseName = choice(SPAWN_TYPES);
  const label = `${baseName}-${room.spawnSeq}`;
  room.spawnSeq++;

  const { x, y } = pickSpawnPosition(room.topology);
  const now = Date.now();
  const newNode = {
    id, label, x, y,
    type: 'host',
    isSpawn: true,
    spawnedAt: now,
    shadowAt: now + SHADOW_TIMEOUT_MS,
  };
  room.topology.nodes.push(newNode);
  newNode._shadowTimer = setTimeout(() => shadowIfUnconnected(io, code, id), SHADOW_TIMEOUT_MS);

  console.log(`[${code}] SPAWN: ${label} @ (${x.toFixed(2)}, ${y.toFixed(2)})`);
  io.to(code).emit('node-spawned', { label });
  emitState(io, code);
}

function shadowIfUnconnected(io, code, nodeId) {
  const room = rooms.get(code);
  if (!room || room.gameState !== 'playing') return;
  const node = nodeById(room.topology, nodeId);
  if (!node || !node.isSpawn) return;
  if (isConnected(room.topology, nodeId)) return;

  // Remove the orphan node entirely; bump alert queue
  room.topology.nodes = room.topology.nodes.filter((n) => n.id !== nodeId);
  room.alertQueue++;
  room.stats.nodesShadowed++;
  console.log(`[${code}] SHADOW IT: ${node.label} expired unconnected — alertQueue=${room.alertQueue}`);
  io.to(code).emit('shadow-it', { label: node.label });

  if (room.alertQueue > ALERT_QUEUE_MAX) {
    gameOver(io, code, `Alert queue overflowed (shadow IT)`);
    return;
  }
  emitState(io, code);
}

function startSpawnLoop(io, code) {
  const room = rooms.get(code);
  if (!room || room.spawnInterval) return;
  // First spawn happens after SPAWN_INTERVAL_MS (not immediately)
  room.spawnInterval = setInterval(() => fireSpawn(io, code), SPAWN_INTERVAL_MS);
}

// ---- Restart (host-triggered after game-over) ----
function restartGame(io, code) {
  const room = rooms.get(code);
  if (!room) return;
  clearTimers(room);

  const gen = generateTopology();
  console.log(`[${code}] RESTART — new topology: ${gen.nodes.length} nodes, ${gen.edges.length} edges, critical=${gen.criticalNodeId}`);

  room.topology = { nodes: gen.nodes, edges: gen.edges };
  room.criticalNode = gen.criticalNodeId;
  room.traversals = new Map();
  room.tasks = new Map();
  room.taskHolders = new Map();
  room.pendingTasks = [];
  room.threats = new Map();
  room.alertQueue = 0;
  room.bandwidth = STARTING_BANDWIDTH;
  room.taskSeq = 1;
  room.threatSeq = 1;
  room.spawnSeq = 1;
  room.gameState = 'lobby';
  room.roundEndsAt = null;
  room.stats = { tasksCompleted: 0, threatsResolved: 0, threatsExpired: 0, nodesConnected: 0, nodesShadowed: 0 };

  // Re-randomize each player onto a node from the new map; old node IDs may not exist
  const startCandidates = room.topology.nodes.filter((n) => !n.isSpawn).map((n) => n.id);
  for (const player of room.players.values()) {
    player.node = startCandidates[Math.floor(Math.random() * startCandidates.length)];
    player.traversing = null;
  }

  // Reshuffle roles so each player gets a fresh draw, still honoring the scaling table
  const shuffledPlayers = shuffled([...room.players.values()]);
  const targets = ROLE_TARGETS[shuffledPlayers.length] || ROLE_TARGETS[10];
  const slots = [];
  for (let i = 0; i < ROLES.length; i++) {
    for (let k = 0; k < targets[i]; k++) slots.push(ROLES[i]);
  }
  // Overflow beyond 10 cycles through field roles
  const overflowRoles = ['NetEng', 'SecOps', 'SysAdmin'];
  while (slots.length < shuffledPlayers.length) {
    slots.push(overflowRoles[(slots.length - 10) % overflowRoles.length]);
  }
  for (let i = 0; i < shuffledPlayers.length; i++) {
    shuffledPlayers[i].role = slots[i];
  }

  io.to(code).emit('game-restarted');
  emitState(io, code);
}

// ---- Game state ----
function startGame(io, code) {
  const room = rooms.get(code);
  if (!room) return;
  room.gameState = 'playing';
  room.roundEndsAt = Date.now() + ROUND_DURATION_MS + THREAT_WARMUP_MS;

  setTimeout(() => {
    const r = rooms.get(code);
    if (!r || r.gameState !== 'playing') return;
    r.taskInterval = setInterval(() => fireTask(io, code), TASK_FIRE_MS);
  }, TASK_WARMUP_MS);

  setTimeout(() => {
    const r = rooms.get(code);
    if (!r || r.gameState !== 'playing') return;
    r.threatInterval = setInterval(() => fireThreat(io, code), THREAT_FIRE_MS);
  }, THREAT_WARMUP_MS);

  // New nodes start spawning after first interval too
  startSpawnLoop(io, code);

  room.roundEndTimeout = setTimeout(() => gameWin(io, code), ROUND_DURATION_MS + THREAT_WARMUP_MS);
  emitState(io, code);
}

function clearTimers(room) {
  if (room.taskInterval) { clearInterval(room.taskInterval); room.taskInterval = null; }
  if (room.threatInterval) { clearInterval(room.threatInterval); room.threatInterval = null; }
  if (room.spawnInterval) { clearInterval(room.spawnInterval); room.spawnInterval = null; }
  if (room.roundEndTimeout) { clearTimeout(room.roundEndTimeout); room.roundEndTimeout = null; }
  for (const t of room.threats.values()) if (t._timer) clearTimeout(t._timer);
  for (const n of room.topology.nodes) if (n._shadowTimer) { clearTimeout(n._shadowTimer); n._shadowTimer = null; }
}

function gameOver(io, code, reason) {
  const room = rooms.get(code);
  if (!room || room.gameState !== 'playing') return;
  room.gameState = 'lost';
  clearTimers(room);
  console.log(`[${code}] GAME LOST: ${reason}`);
  io.to(code).emit('game-over', { kind: 'lost', reason, stats: room.stats });
  emitState(io, code);
}

function gameWin(io, code) {
  const room = rooms.get(code);
  if (!room || room.gameState !== 'playing') return;
  room.gameState = 'won';
  clearTimers(room);
  console.log(`[${code}] GAME WON`);
  io.to(code).emit('game-over', { kind: 'won', reason: 'Round complete', stats: room.stats });
  emitState(io, code);
}

// ---- State emission ----
function publicSnapshot(room) {
  return {
    topology: {
      nodes: room.topology.nodes.map((n) => ({
        id: n.id, label: n.label, x: n.x, y: n.y, type: n.type,
        isSpawn: !!n.isSpawn, shadowAt: n.shadowAt || null,
      })),
      edges: room.topology.edges.map((e) => [...e]),
    },
    traversalMs: TRAVERSAL_MS,
    bandwidth: room.bandwidth,
    gameState: room.gameState,
    hostId: room.hostId,
    roundEndsAt: room.roundEndsAt,
    alertQueue: room.alertQueue,
    alertQueueMax: ALERT_QUEUE_MAX,
    criticalNode: room.criticalNode,
    linkBuildCost: LINK_BUILD_COST,
    maxEdgeCapacity: MAX_EDGE_CAPACITY,
    maxNodeDegree: MAX_NODE_DEGREE,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id, name: p.name, color: p.color, role: p.role,
      node: p.node, traversing: p.traversing,
    })),
    traversals: Array.from(room.traversals.entries()).flatMap(([edge, arr]) =>
      arr.map((t) => ({ edge, playerId: t.playerId, startedAt: t.startedAt }))
    ),
    threats: Array.from(room.threats.values()).map((t) => ({
      id: t.id, requiredRole: t.requiredRole, requiredNode: t.requiredNode,
      nodeLabel: t.nodeLabel, name: t.name, expiresAt: t.expiresAt,
    })),
  };
}

function emitState(io, code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit('state', publicSnapshot(room));

  for (const [socketId, player] of room.players) {
    const holderTaskId = room.taskHolders.get(socketId);
    const holderTask = holderTaskId ? room.tasks.get(holderTaskId) : null;
    const myTask = holderTask ? {
      id: holderTask.id,
      requiredRole: holderTask.requiredRole,
      requiredNode: holderTask.requiredNode,
      nodeLabel: holderTask.nodeLabel,
      verb: holderTask.verb,
    } : null;

    let completable = null;
    if (!player.traversing && room.gameState === 'playing') {
      for (const th of room.threats.values()) {
        if (th.requiredRole === player.role && th.requiredNode === player.node) {
          completable = { verb: th.name, kind: 'threat' };
          break;
        }
      }
      if (!completable) {
        for (const t of room.tasks.values()) {
          if (t.requiredRole === player.role && t.requiredNode === player.node) {
            completable = { verb: t.verb, kind: 'task' };
            break;
          }
        }
      }
    }

    // Build hint for NetEng — show nearest unconnected spawn (if any)
    let buildHint = null;
    if (
      player.role === 'NetEng' &&
      !player.traversing &&
      room.gameState === 'playing' &&
      room.bandwidth >= LINK_BUILD_COST
    ) {
      const fromNode = nodeById(room.topology, player.node);
      if (fromNode && !fromNode.isSpawn) {
        const candidates = room.topology.nodes.filter(
          (n) => n.isSpawn && !isConnected(room.topology, n.id)
        );
        if (candidates.length > 0) {
          candidates.sort((a, b) => {
            const da = Math.hypot(a.x - fromNode.x, a.y - fromNode.y);
            const db = Math.hypot(b.x - fromNode.x, b.y - fromNode.y);
            return da - db;
          });
          const target = candidates[0];
          buildHint = { targetId: target.id, targetLabel: target.label, cost: LINK_BUILD_COST };
        }
      }
    }

    io.to(socketId).emit('private', { myTask, completable, buildHint });
  }
}

// ---- HTTP + Socket.IO ----
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => {
  let currentRoom = null;

  function attachToRoom(code, name, cb) {
    const room = rooms.get(code);
    if (!room) return cb({ error: 'Room not found' });
    if (room.gameState === 'won' || room.gameState === 'lost') {
      return cb({ error: 'Round already finished — refresh to start new' });
    }
    const used = new Set(Array.from(room.players.values()).map((p) => p.color));
    const color = COLORS.find((c) => !used.has(c)) || '#ffffff';
    const role = pickRoleForJoin(room);
    // Start at a CONNECTED (non-spawn) node so players aren't stranded
    const startCandidates = room.topology.nodes.filter((n) => !n.isSpawn).map((n) => n.id);
    const node = startCandidates[Math.floor(Math.random() * startCandidates.length)];
    const player = {
      id: socket.id,
      name: (name || 'anon').slice(0, 16) || 'anon',
      color, role, node, traversing: null,
    };
    room.players.set(socket.id, player);
    if (!room.hostId) room.hostId = socket.id;
    socket.join(code);
    currentRoom = code;
    cb({ ok: true, roomCode: code, playerId: socket.id });
    drainPending(room);
    emitState(io, code);
  }

  socket.on('create-room', ({ name } = {}, cb) => {
    const code = makeRoomCode();
    rooms.set(code, newRoom());
    attachToRoom(code, name, cb);
  });

  socket.on('start-game', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (room.gameState !== 'lobby') return;
    startGame(io, currentRoom);
  });

  socket.on('restart-game', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (room.hostId !== socket.id) return;
    if (room.gameState !== 'won' && room.gameState !== 'lost') return;
    restartGame(io, currentRoom);
  });

  socket.on('join-room', ({ code, name } = {}, cb) => {
    const normalized = (code || '').toUpperCase().trim();
    if (!normalized) return cb({ error: 'Room code required' });
    attachToRoom(normalized, name, cb);
  });

  socket.on('move', ({ toNode } = {}) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    if (room.gameState !== 'playing' && room.gameState !== 'lobby') return;
    const player = room.players.get(socket.id);
    if (!player || player.traversing) return;
    if (!neighborsOf(room.topology, player.node).includes(toNode)) return;
    const key = edgeKey(player.node, toNode);
    const cap = capacityOf(room.topology, player.node, toNode);
    const lanes = room.traversals.get(key) || [];
    if (lanes.length >= cap) { socket.emit('blocked', { edge: key }); return; }
    const startedAt = Date.now();
    player.traversing = { fromNode: player.node, toNode, startedAt };
    lanes.push({ playerId: socket.id, startedAt });
    room.traversals.set(key, lanes);
    emitState(io, currentRoom);
    setTimeout(() => {
      const r = rooms.get(currentRoom);
      if (!r) return;
      const p = r.players.get(socket.id);
      if (!p || !p.traversing) return;
      p.node = p.traversing.toNode;
      p.traversing = null;
      const remaining = (r.traversals.get(key) || []).filter((x) => x.playerId !== socket.id);
      if (remaining.length === 0) r.traversals.delete(key);
      else r.traversals.set(key, remaining);
      emitState(io, currentRoom);
    }, TRAVERSAL_MS);
  });

  socket.on('complete-task', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.gameState !== 'playing') return;
    const player = room.players.get(socket.id);
    if (!player || player.traversing) return;

    let threat = null;
    for (const t of room.threats.values()) {
      if (t.requiredRole === player.role && t.requiredNode === player.node) { threat = t; break; }
    }
    if (threat) {
      if (threat._timer) clearTimeout(threat._timer);
      room.threats.delete(threat.id);
      room.bandwidth += BANDWIDTH_PER_THREAT;
      room.stats.threatsResolved++;
      console.log(`[${currentRoom}] threat resolved: ${threat.name} by ${player.name}`);
      io.to(currentRoom).emit('threat-resolved', {
        name: threat.name, nodeLabel: threat.nodeLabel, byName: player.name,
      });
      emitState(io, currentRoom);
      return;
    }

    let task = null;
    for (const t of room.tasks.values()) {
      if (t.requiredRole === player.role && t.requiredNode === player.node) { task = t; break; }
    }
    if (!task) {
      console.log(`[${currentRoom}] complete-task no-op for ${player.name} (${player.role}) @ ${player.node}`);
      return;
    }
    room.tasks.delete(task.id);
    room.taskHolders.delete(task.holderId);
    room.bandwidth += BANDWIDTH_PER_TASK;
    room.stats.tasksCompleted++;
    console.log(`[${currentRoom}] task done: ${task.verb} by ${player.name}`);
    io.to(currentRoom).emit('task-completed', {
      taskId: task.id, holderId: task.holderId,
      completedById: socket.id, completedByName: player.name, verb: task.verb,
    });
    drainPending(room);
    emitState(io, currentRoom);
  });

  socket.on('build-link', ({ toNode } = {}) => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room || room.gameState !== 'playing') return;
    const player = room.players.get(socket.id);
    if (!player) return;
    if (player.role !== 'NetEng') {
      socket.emit('build-fail', { reason: 'Only NetEng can build links' });
      return;
    }
    if (player.traversing) {
      socket.emit('build-fail', { reason: 'Cannot build while moving' });
      return;
    }
    const fromNode = nodeById(room.topology, player.node);
    if (!fromNode || fromNode.isSpawn) {
      socket.emit('build-fail', { reason: 'Stand at a connected node first' });
      return;
    }
    if (room.bandwidth < LINK_BUILD_COST) {
      socket.emit('build-fail', { reason: `Need ${LINK_BUILD_COST} BW (have ${room.bandwidth})` });
      return;
    }
    if (!toNode) {
      socket.emit('build-fail', { reason: 'No target specified' });
      return;
    }
    const target = nodeById(room.topology, toNode);
    if (!target) {
      socket.emit('build-fail', { reason: 'Target not found' });
      return;
    }
    if (target.id === player.node) {
      socket.emit('build-fail', { reason: 'Pick a different node' });
      return;
    }
    const existing = findEdge(room.topology, player.node, target.id);

    // Degree check (only matters for NEW edges; capacity upgrades don't add a degree)
    if (!existing) {
      const fromDeg = degreeOf(room.topology, player.node);
      const toDeg = degreeOf(room.topology, target.id);
      if (fromDeg >= MAX_NODE_DEGREE) {
        socket.emit('build-fail', { reason: `Your node ${fromNode.label} is at max links (${MAX_NODE_DEGREE})` });
        return;
      }
      if (toDeg >= MAX_NODE_DEGREE) {
        socket.emit('build-fail', { reason: `${target.label} is at max links (${MAX_NODE_DEGREE})` });
        return;
      }
    }

    if (existing) {
      // Upgrade existing link's capacity (add a lane)
      const currentCap = existing[2] || 1;
      if (currentCap >= MAX_EDGE_CAPACITY) {
        socket.emit('build-fail', { reason: `Link already at max capacity (${MAX_EDGE_CAPACITY} lanes)` });
        return;
      }
      existing[2] = currentCap + 1;
      room.bandwidth -= LINK_BUILD_COST;
      console.log(`[${currentRoom}] LANE ADDED: ${player.node} <-> ${target.id} now ${existing[2]} lanes (by ${player.name})`);
      io.to(currentRoom).emit('link-built', {
        from: player.node, to: target.id, label: target.label, byName: player.name,
        upgraded: true, newCapacity: existing[2],
      });
      emitState(io, currentRoom);
      return;
    }

    // New edge
    room.topology.edges.push([player.node, target.id, 1]);
    room.bandwidth -= LINK_BUILD_COST;
    room.stats.nodesConnected++;

    if (target.isSpawn) {
      if (target._shadowTimer) { clearTimeout(target._shadowTimer); target._shadowTimer = null; }
      target.isSpawn = false;
      target.shadowAt = null;
    }

    console.log(`[${currentRoom}] LINK BUILT: ${player.node} <-> ${target.id} by ${player.name}`);
    io.to(currentRoom).emit('link-built', {
      from: player.node, to: target.id, label: target.label, byName: player.name,
      upgraded: false, newCapacity: 1,
    });
    emitState(io, currentRoom);
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (player && player.traversing) {
      const key = edgeKey(player.traversing.fromNode, player.traversing.toNode);
      const remaining = (room.traversals.get(key) || []).filter((x) => x.playerId !== socket.id);
      if (remaining.length === 0) room.traversals.delete(key);
      else room.traversals.set(key, remaining);
    }
    const heldTaskId = room.taskHolders.get(socket.id);
    if (heldTaskId) {
      const t = room.tasks.get(heldTaskId);
      if (t) {
        room.tasks.delete(t.id);
        room.taskHolders.delete(socket.id);
        reQueueTask(room, t);
      }
    }
    room.players.delete(socket.id);
    if (room.players.size === 0) {
      clearTimers(room);
      rooms.delete(currentRoom);
    } else {
      if (room.hostId === socket.id) {
        room.hostId = room.players.keys().next().value;
        console.log(`[${currentRoom}] host promoted to ${room.players.get(room.hostId).name}`);
      }
      drainPending(room);
      emitState(io, currentRoom);
    }
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Packet Storm listening on http://localhost:${PORT}`);
});

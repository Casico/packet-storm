const socket = io();

const lobby = document.getElementById('lobby');
const game = document.getElementById('game');
const nameInput = document.getElementById('name');
const roomCodeInput = document.getElementById('room-code');
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const lobbyMsg = document.getElementById('lobby-msg');
const roomLabel = document.getElementById('room-label');
const playerCount = document.getElementById('player-count');
const bandwidthEl = document.getElementById('bandwidth');
const roundTimerEl = document.getElementById('round-timer');
const alertQueueEl = document.getElementById('alert-queue');
const rosterEl = document.getElementById('roster');
const rolePanelEl = document.getElementById('role-panel');
const rolePanelIconEl = document.getElementById('role-panel-icon');
const rolePanelNameEl = document.getElementById('role-panel-name');
const rolePanelBodyEl = document.getElementById('role-panel-body');
const defconBadgeEl = document.getElementById('defcon-badge');
const taskCountsEl = document.getElementById('task-counts');
const freezeBannerEl = document.getElementById('freeze-banner');
const muteBtnEl = document.getElementById('mute-btn');

// Background music — created lazily on first user gesture (browser autoplay rules)
let bgmEl = null;
let bgmMuted = localStorage.getItem('ps-muted') === '1';
function ensureBgm() {
  if (bgmEl) return bgmEl;
  bgmEl = new Audio('/assets/audio/loop-main.mp3');
  bgmEl.loop = true;
  bgmEl.volume = 0.22;
  return bgmEl;
}
function setMuted(muted) {
  bgmMuted = muted;
  localStorage.setItem('ps-muted', muted ? '1' : '0');
  if (bgmEl) bgmEl.muted = muted;
  muteBtnEl.textContent = muted ? '🔇' : '🔊';
  muteBtnEl.classList.toggle('muted', muted);
}
function startBgm() {
  const el = ensureBgm();
  el.muted = bgmMuted;
  el.play().catch(() => {/* ignored if blocked */});
}
muteBtnEl.addEventListener('click', () => setMuted(!bgmMuted));
setMuted(bgmMuted); // sync icon at load
const taskPanelEl = document.getElementById('task-panel');
const taskRoleEl = document.getElementById('task-role');
const taskVerbEl = document.getElementById('task-verb');
const taskNodeEl = document.getElementById('task-node');
const spacePromptEl = document.getElementById('space-prompt');
const buildPromptEl = document.getElementById('build-prompt');
const toastEl = document.getElementById('toast');
const overlayEl = document.getElementById('overlay');
const overlayTitleEl = document.getElementById('overlay-title');
const overlayReasonEl = document.getElementById('overlay-reason');
const overlayStatsEl = document.getElementById('overlay-stats');
const overlayActionEl = document.getElementById('overlay-action');
const lobbyCardEl = document.getElementById('lobby-card');
const lobbyRoomCodeEl = document.getElementById('lobby-room-code');
const lobbyRosterEl = document.getElementById('lobby-roster');
const lobbyActionEl = document.getElementById('lobby-action');
const copyLinkBtn = document.getElementById('copy-link-btn');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const ROLES_DISPLAY_ORDER = ['NetEng', 'SecOps', 'SysAdmin', 'NOC', 'DevOps'];
const ROLE_COLORS = {
  NetEng:   '#58a6ff',
  SecOps:   '#ff6b6b',
  SysAdmin: '#7ee787',
  NOC:      '#ffd960',
  DevOps:   '#48dbfb',
};
const ROLE_ABBR = {
  NetEng: 'NET', SecOps: 'SEC', SysAdmin: 'SYS', NOC: 'NOC', DevOps: 'DEV',
};

const ROLE_INFO = {
  NetEng: {
    icon: '🔧',
    body: `<p>Configure VLANs, routes, interfaces. Build & upgrade <strong>links</strong>.</p>
           <p>Hit: BGP flaps, STP storms, MTU mismatches.</p>
           <p>Press <span class="key">B</span> then click a node to build/upgrade a link (1 BW).</p>`,
  },
  SecOps: {
    icon: '🛡️',
    body: `<p>Firewall rules, ACLs, IP blocks, VLAN quarantine.</p>
           <p>Hit: port scans, DDoS, ransomware, brute force, MAC floods.</p>`,
  },
  SysAdmin: {
    icon: '💻',
    body: `<p>Patch CVEs, restart services, rotate creds, apt upgrades.</p>
           <p>Hit: zero-days, disk-full, OOMs, service crashes.</p>`,
  },
  NOC: {
    icon: '📟',
    body: `<p>Open/ack tickets, run packet captures, page on-call.</p>
           <p>Hit: cryptic alerts, Sev-1 pages, customer complaints.</p>
           <p>One per room — you're solo. Triage everything.</p>`,
  },
  DevOps: {
    icon: '🐳',
    body: `<p>Deploys, CI runners, K8s, containers, rollbacks.</p>
           <p>Hit: bad deploys, OOM crashloops, stuck pipelines.</p>`,
  },
};

const DEFCON_COLORS = { 5: '#7ee787', 4: '#ffd960', 3: '#ff9c3f', 2: '#ff6b6b', 1: '#ff3b3b' };

const NODE_TYPE_ICON = {
  external: '🌐',
  firewall: '🛡️',
  switch:   '🔀',
  host:     '🖥️',
};

let state = null;
let myId = null;
let roomCode = null;
let myTask = null;
let completable = null;
let buildHint = null;
let buildMode = false;
let blockedFlashUntil = 0;

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeCanvas);

// ---- Lobby ----
nameInput.value = localStorage.getItem('ps-name') || '';
nameInput.addEventListener('input', () => localStorage.setItem('ps-name', nameInput.value));
roomCodeInput.addEventListener('input', () => { roomCodeInput.value = roomCodeInput.value.toUpperCase(); });

// Pre-fill room code from ?room= so shared invite links land you on the join form.
(function readRoomFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const r = (params.get('room') || '').toUpperCase().slice(0, 4);
  if (r) {
    roomCodeInput.value = r;
    // Focus name first so the user can type/edit it, then press Enter to join.
    setTimeout(() => nameInput.focus(), 0);
  }
})();

function buildInviteUrl(code) {
  const base = window.location.origin + window.location.pathname;
  return `${base}?room=${code}`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // Fallback for non-secure contexts (rare on localhost/HTTPS)
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
    return ok;
  }
}

copyLinkBtn.onclick = async () => {
  if (!roomCode) return;
  const url = buildInviteUrl(roomCode);
  const ok = await copyToClipboard(url);
  showToast(ok ? `📋 Link copied: ${url}` : 'Copy failed — select & copy from the URL bar', ok ? 'success' : 'warn');
};

createBtn.onclick = () => {
  const name = nameInput.value.trim() || 'anon';
  lobbyMsg.textContent = '';
  socket.emit('create-room', { name }, onJoined);
};
joinBtn.onclick = () => {
  const name = nameInput.value.trim() || 'anon';
  const code = roomCodeInput.value.trim();
  if (!code) { lobbyMsg.textContent = 'Enter a room code.'; return; }
  lobbyMsg.textContent = '';
  socket.emit('join-room', { code, name }, onJoined);
};
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') (roomCodeInput.value ? joinBtn : createBtn).click();
});
roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

function onJoined(resp) {
  if (!resp || resp.error) {
    lobbyMsg.textContent = (resp && resp.error) || 'Failed to join.';
    return;
  }
  myId = resp.playerId;
  roomCode = resp.roomCode;
  lobby.classList.add('hidden');
  game.classList.remove('hidden');
  roomLabel.textContent = `ROOM ${roomCode}`;
  // Update URL so refresh / address-bar copy keep the room context
  try { history.replaceState({}, '', buildInviteUrl(roomCode)); } catch (_) {}
  resizeCanvas();
  requestAnimationFrame(render);
  // Start music — the create/join button click counts as the user gesture
  startBgm();
}

// ---- Socket events ----
socket.on('state', (s) => {
  state = s;
  updateHud();
  // Hide game-over overlay if the room has reset back to lobby/playing
  if (s.gameState === 'lobby' || s.gameState === 'playing') {
    overlayEl.className = '';
  } else if (overlayEl.classList.contains('show')) {
    // Re-render the action in case host changed (or initial render)
    renderOverlayAction();
  }
});

socket.on('private', (payload) => {
  console.log('[private]', payload);
  myTask = (payload && payload.myTask) || null;
  completable = (payload && payload.completable) || null;
  buildHint = (payload && payload.buildHint) || null;
  updateTaskPanel();
  updateSpacePrompt();
  updateBuildPrompt();
});

socket.on('task-completed', ({ holderId, completedByName }) => {
  if (holderId === myId) showToast(`✓ DONE BY ${completedByName}`, 'success');
});

socket.on('threat-resolved', ({ name, nodeLabel, byName, multi }) => {
  const prefix = multi ? '✓✓ MULTI-THREAT' : '✓';
  showToast(`${prefix} ${name.toUpperCase()} resolved by ${byName}`, 'success');
});

socket.on('threat-step', ({ name, role, byName, remaining }) => {
  const remStr = remaining.map((r) => ROLE_ABBR[r] || r).join(', ');
  showToast(`✓ ${ROLE_ABBR[role] || role} step done by ${byName} — still need: ${remStr}`, 'warn');
});

socket.on('threat-expired', ({ name, nodeLabel }) => {
  showToast(`⚠ ${name.toUpperCase()} on ${nodeLabel} EXPIRED`, 'warn');
});

socket.on('distraction-start', ({ playerId, playerName, verb, durationMs }) => {
  if (playerId === myId) {
    showToast(`📞 ${verb} — frozen ${Math.round(durationMs/1000)}s. Hold F to bail (+1 alert).`, 'warn');
  } else {
    showToast(`📞 ${playerName} pulled into: ${verb}`, 'warn');
  }
});

socket.on('distraction-end', ({ playerId, playerName, bailed }) => {
  if (playerId === myId) {
    showToast(bailed ? `✊ You bailed (+1 alert)` : `✓ You're free`, bailed ? 'warn' : 'success');
  } else if (bailed) {
    showToast(`✊ ${playerName} bailed (+1 alert)`, 'warn');
  }
});

socket.on('node-spawned', ({ label }) => {
  showToast(`🌱 NEW NODE: ${label} — connect within 45s`, 'warn');
});

socket.on('shadow-it', ({ label }) => {
  showToast(`⚠ SHADOW IT: ${label} went unconnected`, 'warn');
});

socket.on('link-built', ({ label, byName, upgraded, newCapacity }) => {
  if (upgraded) {
    showToast(`🔗 LANE ADDED to ${label} — now ${newCapacity} lanes (by ${byName})`, 'success');
  } else {
    showToast(`🔗 LINK BUILT to ${label} by ${byName}`, 'success');
  }
});

socket.on('build-fail', ({ reason }) => {
  showToast(`✗ Build failed: ${reason}`, 'warn');
});

socket.on('game-over', ({ kind, reason, stats }) => {
  overlayEl.className = 'show ' + kind;
  overlayTitleEl.textContent = kind === 'won' ? 'YOU SURVIVED' : 'YOU FAILED THE NETWORK';
  overlayReasonEl.textContent = reason;
  overlayStatsEl.innerHTML = `
    Tasks completed: <strong>${stats.tasksCompleted}</strong><br>
    Threats resolved: <strong>${stats.threatsResolved}</strong><br>
    Threats expired: <strong>${stats.threatsExpired}</strong>
  `;
  renderOverlayAction();
});

socket.on('game-restarted', () => {
  // Server already emits 'state' with gameState='lobby' which hides the overlay;
  // also reset client-side build-mode if it was sticky.
  if (buildMode) exitBuildMode();
});

function renderOverlayAction() {
  overlayActionEl.innerHTML = '';
  if (!state) return;
  const isHost = myId === state.hostId;
  if (isHost) {
    const btn = document.createElement('button');
    btn.id = 'play-again-btn';
    btn.textContent = 'PLAY AGAIN';
    btn.onclick = () => socket.emit('restart-game');
    overlayActionEl.appendChild(btn);
    const hint = document.createElement('p');
    hint.className = 'overlay-hint';
    hint.textContent = 'New random map, same crew';
    overlayActionEl.appendChild(hint);
  } else {
    const host = state.players.find((p) => p.id === state.hostId);
    const wait = document.createElement('p');
    wait.className = 'overlay-hint';
    wait.textContent = `Waiting for ${host ? host.name : 'host'} to start a new round…`;
    overlayActionEl.appendChild(wait);
  }
}

socket.on('blocked', () => { blockedFlashUntil = performance.now() + 250; });
socket.on('disconnect', () => { lobbyMsg.textContent = 'Disconnected. Refresh to reconnect.'; });

// ---- HUD ----
function fmtMs(ms) {
  if (ms < 0) ms = 0;
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function updateHud() {
  if (!state || !myId) return;
  const me = state.players.find((p) => p.id === myId);
  if (me) {
    const info = ROLE_INFO[me.role];
    if (info) {
      rolePanelIconEl.textContent = info.icon;
      rolePanelNameEl.textContent = me.role.toUpperCase();
      rolePanelNameEl.style.color = ROLE_COLORS[me.role] || '#e6edf3';
      rolePanelEl.style.borderLeftColor = ROLE_COLORS[me.role] || '#30363d';
      rolePanelBodyEl.innerHTML = info.body;
    }
  }
  bandwidthEl.textContent = `⚡ ${state.bandwidth}`;
  playerCount.textContent = `${state.players.length}p`;

  const inLobby = state.gameState === 'lobby';

  // DEFCON badge — only show in 'playing'
  if (!inLobby && state.defcon) {
    defconBadgeEl.textContent = `DEFCON ${state.defcon}`;
    defconBadgeEl.style.color = DEFCON_COLORS[state.defcon] || '#fff';
    defconBadgeEl.style.borderColor = DEFCON_COLORS[state.defcon] || '#30363d';
    defconBadgeEl.className = state.defcon <= 1 ? 'critical' : '';
  } else {
    defconBadgeEl.textContent = '';
    defconBadgeEl.className = '';
  }

  // Task counts per role (only during play)
  if (!inLobby && state.taskCounts) {
    const parts = [];
    for (const role of ROLES_DISPLAY_ORDER) {
      const cnt = state.taskCounts[role] || 0;
      const color = ROLE_COLORS[role];
      parts.push(`<span style="color:${color}">${ROLE_ABBR[role]}:${cnt}</span>`);
    }
    taskCountsEl.innerHTML = parts.join(' · ');
  } else {
    taskCountsEl.innerHTML = '';
  }

  // Alert queue (hidden in lobby)
  if (inLobby) {
    alertQueueEl.textContent = '';
    alertQueueEl.className = '';
  } else {
    const aq = state.alertQueue || 0;
    alertQueueEl.textContent = `🚨 ${aq}/${state.alertQueueMax}`;
    alertQueueEl.className = aq >= state.alertQueueMax - 1 ? 'danger'
                           : aq >= Math.floor(state.alertQueueMax * 0.6) ? 'warn' : '';
  }

  updateLobbyCard();

  // Roster
  const groups = { NetEng: [], SecOps: [], SysAdmin: [], NOC: [] };
  for (const p of state.players) if (groups[p.role]) groups[p.role].push(p);
  rosterEl.innerHTML = '';
  for (const role of ROLES_DISPLAY_ORDER) {
    if (groups[role].length === 0) continue;
    const row = document.createElement('div');
    row.className = 'roster-row';
    const label = document.createElement('span');
    label.className = 'roster-role';
    label.style.color = ROLE_COLORS[role];
    label.textContent = ROLE_ABBR[role];
    row.appendChild(label);
    for (const p of groups[role]) {
      const swatch = document.createElement('span');
      swatch.className = 'roster-swatch';
      swatch.style.background = p.color;
      const name = document.createElement('span');
      name.className = 'roster-name' + (p.id === myId ? ' me' : '');
      name.textContent = p.name;
      row.appendChild(swatch);
      row.appendChild(name);
    }
    rosterEl.appendChild(row);
  }
}

function updateLobbyCard() {
  if (!state) return;
  if (state.gameState !== 'lobby') {
    lobbyCardEl.classList.remove('show');
    return;
  }
  lobbyCardEl.classList.add('show');
  lobbyRoomCodeEl.textContent = roomCode || '';

  // Roster grouped by role
  const groups = { NetEng: [], SecOps: [], SysAdmin: [], NOC: [] };
  for (const p of state.players) if (groups[p.role]) groups[p.role].push(p);
  lobbyRosterEl.innerHTML = '';
  for (const role of ROLES_DISPLAY_ORDER) {
    if (groups[role].length === 0) continue;
    const row = document.createElement('div');
    row.className = 'lobby-roster-row';
    const label = document.createElement('span');
    label.className = 'lobby-roster-role';
    label.style.color = ROLE_COLORS[role];
    label.textContent = ROLE_ABBR[role];
    row.appendChild(label);
    for (const p of groups[role]) {
      const tag = document.createElement('span');
      tag.className = 'lobby-roster-player' + (p.id === myId ? ' me' : '') + (p.id === state.hostId ? ' host' : '');
      const sw = document.createElement('span');
      sw.className = 'lobby-roster-swatch';
      sw.style.background = p.color;
      tag.appendChild(sw);
      const nm = document.createElement('span');
      nm.textContent = p.name + (p.id === state.hostId ? ' ★' : '');
      tag.appendChild(nm);
      row.appendChild(tag);
    }
    lobbyRosterEl.appendChild(row);
  }

  // Action: start button (host) or waiting text (others)
  lobbyActionEl.innerHTML = '';
  const isHost = myId === state.hostId;
  if (isHost) {
    const btn = document.createElement('button');
    btn.id = 'start-btn';
    btn.textContent = 'START GAME';
    btn.onclick = () => socket.emit('start-game');
    lobbyActionEl.appendChild(btn);
  } else {
    const host = state.players.find((p) => p.id === state.hostId);
    const wait = document.createElement('p');
    wait.className = 'lobby-wait';
    wait.textContent = `Waiting for ${host ? host.name : 'host'} to start…`;
    lobbyActionEl.appendChild(wait);
  }
}

function updateTaskPanel() {
  if (!myTask) {
    taskPanelEl.classList.remove('active');
    taskRoleEl.textContent = '';
    taskRoleEl.style.background = '';
    taskVerbEl.textContent = 'Waiting for alert…';
    taskNodeEl.textContent = '';
    return;
  }
  taskPanelEl.classList.add('active');
  taskRoleEl.textContent = ROLE_ABBR[myTask.requiredRole] || myTask.requiredRole;
  taskRoleEl.style.background = ROLE_COLORS[myTask.requiredRole] || '#888';
  taskVerbEl.textContent = myTask.verb;
  taskNodeEl.textContent = `on ${myTask.nodeLabel}`;
}

function updateSpacePrompt() {
  if (completable && completable.verb) {
    const kind = completable.kind === 'threat' ? '⚠ THREAT' : '';
    spacePromptEl.textContent = `${kind ? kind + '  ' : ''}Press SPACE → ${completable.verb}`;
    spacePromptEl.classList.add('active');
    spacePromptEl.classList.toggle('threat', completable.kind === 'threat');
  } else {
    spacePromptEl.classList.remove('active', 'threat');
    spacePromptEl.textContent = '';
  }
}

function updateBuildPrompt() {
  if (buildMode) {
    const cost = (state && state.linkBuildCost) || 1;
    let txt = `🔧 BUILD MODE — Click a target node (${cost} BW)`;
    if (buildHint && buildHint.targetLabel) txt += ` • suggested: ${buildHint.targetLabel}`;
    txt += ` • B/Esc cancel`;
    buildPromptEl.textContent = txt;
    buildPromptEl.classList.add('active', 'build-mode');
  } else if (buildHint && buildHint.targetLabel) {
    buildPromptEl.textContent = `Press B → Build link (suggested: ${buildHint.targetLabel}, ${buildHint.cost} BW)`;
    buildPromptEl.classList.add('active');
    buildPromptEl.classList.remove('build-mode');
  } else {
    buildPromptEl.classList.remove('active', 'build-mode');
    buildPromptEl.textContent = '';
  }
}

function exitBuildMode() {
  if (!buildMode) return;
  buildMode = false;
  canvas.style.cursor = '';
  updateBuildPrompt();
}

function toggleBuildMode() {
  if (!state || !myId) return;
  const me = state.players.find((p) => p.id === myId);
  if (!me) return;
  if (state.gameState !== 'playing') return;
  if (me.role !== 'NetEng') {
    showToast('Only NetEng can build links', 'warn');
    return;
  }
  if (buildMode) { exitBuildMode(); return; }
  if (me.traversing) {
    showToast('Cannot build while moving', 'warn');
    return;
  }
  const myNode = state.topology.nodes.find((n) => n.id === me.node);
  if (!myNode || myNode.isSpawn) {
    showToast('Stand at a connected node first', 'warn');
    return;
  }
  const cost = state.linkBuildCost || 1;
  if (state.bandwidth < cost) {
    showToast(`Need ${cost} BW (have ${state.bandwidth})`, 'warn');
    return;
  }
  buildMode = true;
  canvas.style.cursor = 'crosshair';
  updateBuildPrompt();
}

// ---- Toast ----
let toastTimer = null;
function showToast(msg, kind) {
  toastEl.textContent = msg;
  toastEl.className = 'show' + (kind ? ' ' + kind : '');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = ''; }, 2400);
}

// ---- Input ----
function nodeById(id) { return state.topology.nodes.find((n) => n.id === id); }
function neighborsOf(id) {
  return state.topology.edges
    .filter(([a, b]) => a === id || b === id).map(([a, b]) => (a === id ? b : a));
}

const BAIL_HOLD_MS = 2000;
let bailHoldTimer = null;
let bailHoldStartedAt = 0;

window.addEventListener('keydown', (e) => {
  if (!state || !myId) return;
  if (e.key === ' ' || e.code === 'Space') {
    e.preventDefault();
    socket.emit('complete-task');
    return;
  }
  if (e.key === 'b' || e.key === 'B') {
    e.preventDefault();
    toggleBuildMode();
    return;
  }
  if (e.key === 'Escape') {
    if (buildMode) { e.preventDefault(); exitBuildMode(); }
    return;
  }
  if ((e.key === 'f' || e.key === 'F') && !e.repeat) {
    const me = state.players.find((p) => p.id === myId);
    if (me && me.frozenUntil && !bailHoldTimer) {
      e.preventDefault();
      bailHoldStartedAt = performance.now();
      bailHoldTimer = setTimeout(() => {
        socket.emit('distraction-bail');
        bailHoldTimer = null;
        bailHoldStartedAt = 0;
      }, BAIL_HOLD_MS);
    }
  }
});

window.addEventListener('keyup', (e) => {
  if ((e.key === 'f' || e.key === 'F') && bailHoldTimer) {
    clearTimeout(bailHoldTimer);
    bailHoldTimer = null;
    bailHoldStartedAt = 0;
  }
});

// Click-to-build target selection
function nodePxAt(n, w, h) {
  return { x: PAD + n.x * (w - 2 * PAD), y: PAD + n.y * (h - 2 * PAD) };
}
function findClickedNode(clickX, clickY) {
  if (!state) return null;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  for (const n of state.topology.nodes) {
    const p = nodePxAt(n, w, h);
    if (Math.hypot(p.x - clickX, p.y - clickY) <= NODE_RADIUS) return n;
  }
  return null;
}
function existingEdgeBetween(a, b) {
  return state.topology.edges.find(([x, y]) => (x === a && y === b) || (x === b && y === a));
}
function degreeOfClient(id) {
  return state.topology.edges.reduce((n, [a, b]) => n + (a === id || b === id ? 1 : 0), 0);
}
canvas.addEventListener('click', (e) => {
  if (!state || !myId) return;
  const me = state.players.find((p) => p.id === myId);
  if (!me) return;
  const rect = canvas.getBoundingClientRect();
  const clicked = findClickedNode(e.clientX - rect.left, e.clientY - rect.top);
  if (!clicked) return;

  if (buildMode) {
    if (clicked.id === me.node) { showToast('Pick a different node', 'warn'); return; }
    const existing = existingEdgeBetween(me.node, clicked.id);
    const maxCap = state.maxEdgeCapacity || 3;
    const maxDeg = state.maxNodeDegree || 6;
    if (existing && (existing[2] || 1) >= maxCap) {
      showToast(`Link already at max capacity (${maxCap} lanes)`, 'warn');
      return;
    }
    if (!existing) {
      if (degreeOfClient(me.node) >= maxDeg) {
        showToast(`Your node is at max links (${maxDeg})`, 'warn');
        return;
      }
      if (degreeOfClient(clicked.id) >= maxDeg) {
        showToast(`${clicked.label} is at max links (${maxDeg})`, 'warn');
        return;
      }
    }
    socket.emit('build-link', { toNode: clicked.id });
    exitBuildMode();
    return;
  }

  // Normal movement: click a connected neighbor to traverse there
  if (me.traversing) return;
  if (clicked.id === me.node) return;
  if (!neighborsOf(me.node).includes(clicked.id)) return;
  socket.emit('move', { toNode: clicked.id });
});

// Hover feedback: cursor becomes pointer over a clickable neighbor
let hoveredNodeId = null;
canvas.addEventListener('mousemove', (e) => {
  if (!state || !myId) { hoveredNodeId = null; return; }
  const rect = canvas.getBoundingClientRect();
  const hover = findClickedNode(e.clientX - rect.left, e.clientY - rect.top);
  hoveredNodeId = hover ? hover.id : null;
  updateCursor();
});
canvas.addEventListener('mouseleave', () => { hoveredNodeId = null; updateCursor(); });

function updateCursor() {
  if (buildMode) { canvas.style.cursor = 'crosshair'; return; }
  if (!state || !myId || !hoveredNodeId) { canvas.style.cursor = ''; return; }
  const me = state.players.find((p) => p.id === myId);
  if (!me || me.traversing) { canvas.style.cursor = ''; return; }
  if (neighborsOf(me.node).includes(hoveredNodeId)) {
    canvas.style.cursor = 'pointer';
  } else {
    canvas.style.cursor = '';
  }
}

// ---- Render ----
const NODE_RADIUS = 50;
const PLAYER_RADIUS = 15;
const PLAYER_ORBIT  = 68; // sits just outside the node circle
const PAD = 110;

// Per-player visual position smoothing (avoids snaps when entering/leaving orbit).
const playerRenderState = {};
const RENDER_LERP = 0.22; // ~200ms catch-up at 60fps

function render() {
  requestAnimationFrame(render);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);
  if (!state) return;

  // Round timer
  if (state.gameState === 'lobby') {
    roundTimerEl.textContent = 'WAITING';
    roundTimerEl.className = '';
  } else if (state.roundEndsAt) {
    const left = state.roundEndsAt - Date.now();
    roundTimerEl.textContent = `⏱ ${fmtMs(left)}`;
    roundTimerEl.className = left < 60000 ? 'danger' : left < 120000 ? 'warn' : '';
  } else {
    roundTimerEl.textContent = '';
  }

  if (performance.now() < blockedFlashUntil) {
    ctx.fillStyle = 'rgba(255, 80, 80, 0.18)';
    ctx.fillRect(0, 0, w, h);
  }

  const toPx = (n) => ({
    x: PAD + n.x * (w - 2 * PAD),
    y: PAD + n.y * (h - 2 * PAD),
  });

  // Edges — multi-lane rendering based on capacity (3rd element of edge triple)
  for (const [a, b, capRaw] of state.topology.edges) {
    const capacity = capRaw || 1;
    const pa = toPx(nodeById(a));
    const pb = toPx(nodeById(b));
    const key = [a, b].sort().join('|');
    const busyCount = state.traversals.filter((t) => t.edge === key).length;
    const fillRatio = busyCount / capacity;

    let color, lineWidth;
    if (busyCount === 0)         { color = '#3a4250'; lineWidth = 5; }  // idle
    else if (fillRatio >= 1)     { color = '#ff6b6b'; lineWidth = 8; }  // saturated
    else if (fillRatio >= 0.5)   { color = '#ff9c3f'; lineWidth = 7; }  // partial
    else                         { color = '#ffd960'; lineWidth = 6; }  // light

    // Perpendicular unit vector for lane offset
    const dx = pb.x - pa.x, dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const laneGap = 10; // px between parallel lanes — leaves clear separation at widths 5-8

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    for (let i = 0; i < capacity; i++) {
      const off = (i - (capacity - 1) / 2) * laneGap;
      ctx.beginPath();
      ctx.moveTo(pa.x + nx * off, pa.y + ny * off);
      ctx.lineTo(pb.x + nx * off, pb.y + ny * off);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  // Per-node threat lookup
  const threatsByNode = {};
  for (const th of state.threats || []) {
    (threatsByNode[th.requiredNode] = threatsByNode[th.requiredNode] || []).push(th);
  }
  const now = Date.now();

  // Nodes — border pulses red (threat) / orange (unconnected spawn) / purple (critical) / blue (normal)
  for (const n of state.topology.nodes) {
    const p = toPx(n);
    const isCritical = n.id === state.criticalNode;
    const hasThreat = !!threatsByNode[n.id];
    const blink = (Math.sin(now / 350) + 1) / 2;

    let strokeStyle, lineWidth, dashed = false;
    if (hasThreat) {
      if (isCritical) strokeStyle = `rgba(199, 164, 255, ${0.55 + blink * 0.45})`;
      else            strokeStyle = `rgba(255, 80, 80, ${0.55 + blink * 0.45})`;
      lineWidth = 5;
    } else if (n.isSpawn) {
      const slowBlink = (Math.sin(now / 500) + 1) / 2;
      strokeStyle = `rgba(255, 156, 63, ${0.55 + slowBlink * 0.45})`;
      lineWidth = 4;
      dashed = true;
    } else if (isCritical) {
      strokeStyle = '#c7a4ff';
      lineWidth = 3;
    } else {
      strokeStyle = '#58a6ff';
      lineWidth = 2;
    }

    ctx.fillStyle = '#1c2128';
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    if (dashed) ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, NODE_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (dashed) ctx.setLineDash([]);

    // Node-type glyph above the label (skip for unconnected spawns to keep them visually distinct)
    if (!n.isSpawn) {
      const glyph = NODE_TYPE_ICON[n.type];
      if (glyph) {
        ctx.font = '18px -apple-system, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(glyph, p.x, p.y - 10);
      }
    }

    ctx.fillStyle = '#e6edf3';
    ctx.font = '12px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n.label, p.x, p.y + 12);

    // Unlinked countdown below spawn node
    if (n.isSpawn && n.shadowAt) {
      const remain = Math.max(0, n.shadowAt - now);
      const secs = Math.ceil(remain / 1000);
      ctx.fillStyle = remain < 10000 ? '#ff6b6b' : '#ff9c3f';
      ctx.font = 'bold 12px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`UNLINKED ${secs}s`, p.x, p.y + NODE_RADIUS + 8);
    }
  }

  // Threat info — countdown + name stacked below the node, role tag above
  for (const n of state.topology.nodes) {
    const tList = threatsByNode[n.id];
    if (!tList || tList.length === 0) continue;
    const p = toPx(n);

    tList.forEach((th, idx) => {
      const remain = Math.max(0, th.expiresAt - now);
      const countdown = Math.ceil(remain / 1000);

      // Stack vertically below: countdown + name
      const yBase = p.y + NODE_RADIUS + 12 + idx * 30;
      ctx.fillStyle = remain < 10000 ? '#ff6b6b' : '#ff9c3f';
      ctx.font = 'bold 14px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`${countdown}s`, p.x, yBase);

      ctx.fillStyle = '#e6edf3';
      ctx.font = '11px -apple-system, sans-serif';
      ctx.fillText(th.name, p.x, yBase + 16);

      // Role badges above node — one per required step; completed steps faded
      const steps = th.steps || [{ role: th.requiredRole, completed: false }];
      const badgeW = 36, badgeH = 18, badgeGap = 4;
      const totalW = steps.length * badgeW + (steps.length - 1) * badgeGap;
      const badgeY = p.y - NODE_RADIUS - 14 - idx * 22;
      const startX = p.x - totalW / 2 + badgeW / 2;
      steps.forEach((step, si) => {
        const bx = startX + si * (badgeW + badgeGap);
        const color = ROLE_COLORS[step.role] || '#fff';
        ctx.fillStyle = step.completed ? `${color}55` : color; // 33% alpha for done
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx - badgeW/2, badgeY - badgeH/2, badgeW, badgeH, 3);
        else ctx.rect(bx - badgeW/2, badgeY - badgeH/2, badgeW, badgeH);
        ctx.fill();
        ctx.fillStyle = step.completed ? '#0e111788' : '#0e1117';
        ctx.font = 'bold 11px -apple-system, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          (step.completed ? '✓' : ROLE_ABBR[step.role] || '?'),
          bx,
          badgeY
        );
      });
    });
  }

  // Navigation hint: subtle ring around clickable neighbors when not in build mode
  if (!buildMode) {
    const me = state.players.find((p) => p.id === myId);
    if (me && !me.traversing && (state.gameState === 'playing' || state.gameState === 'lobby')) {
      const myNeighbors = neighborsOf(me.node);
      for (const nid of myNeighbors) {
        const n = nodeById(nid);
        if (!n) continue;
        const p = toPx(n);
        const isHovered = nid === hoveredNodeId;
        ctx.strokeStyle = isHovered
          ? 'rgba(88, 166, 255, 0.85)'
          : 'rgba(88, 166, 255, 0.30)';
        ctx.lineWidth = isHovered ? 3 : 2;
        ctx.setLineDash(isHovered ? [] : [3, 4]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, NODE_RADIUS + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // Build-mode overlay: highlight clickable targets + label source node
  if (buildMode && state.gameState === 'playing') {
    const me = state.players.find((p) => p.id === myId);
    if (me) {
      const meNodeId = me.node;
      const pulse = (Math.sin(now / 380) + 1) / 2;
      for (const n of state.topology.nodes) {
        const p = toPx(n);
        if (n.id === meNodeId) {
          ctx.fillStyle = '#ff9c3f';
          ctx.font = 'bold 11px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText('FROM', p.x, p.y - NODE_RADIUS - 6);
          continue;
        }
        const existing = state.topology.edges.find(([a, b]) =>
          (a === meNodeId && b === n.id) || (b === meNodeId && a === n.id)
        );
        const cap = existing ? (existing[2] || 1) : 0;
        const maxCap = state.maxEdgeCapacity || 3;
        const maxDeg = state.maxNodeDegree || 6;
        // Already at max capacity: no highlight (no action available)
        if (existing && cap >= maxCap) continue;
        // No existing edge but a new one would violate degree limit on either end: skip
        if (!existing && (degreeOfClient(meNodeId) >= maxDeg || degreeOfClient(n.id) >= maxDeg)) continue;
        const isUpgrade = !!existing;
        ctx.strokeStyle = isUpgrade
          ? `rgba(255, 217, 96, ${0.30 + pulse * 0.40})`
          : `rgba(255, 156, 63, ${0.25 + pulse * 0.45})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, NODE_RADIUS + 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // Players — always orbit around the node so they don't cover the label
  const traversalMs = state.traversalMs || 3000;
  const stationary = {};
  for (const p of state.players) {
    if (!p.traversing) (stationary[p.node] = stationary[p.node] || []).push(p);
  }

  // Clean up render state for departed players
  const liveIds = new Set(state.players.map((p) => p.id));
  for (const id of Object.keys(playerRenderState)) {
    if (!liveIds.has(id)) delete playerRenderState[id];
  }

  for (const p of state.players) {
    let targetX, targetY;
    if (p.traversing) {
      const t = Math.min(1, (now - p.traversing.startedAt) / traversalMs);
      const fp = toPx(nodeById(p.traversing.fromNode));
      const tp = toPx(nodeById(p.traversing.toNode));
      targetX = fp.x + (tp.x - fp.x) * t;
      targetY = fp.y + (tp.y - fp.y) * t;
    } else {
      const np = toPx(nodeById(p.node));
      const group = stationary[p.node];
      const idx = group.indexOf(p);
      const angle = (idx / group.length) * Math.PI * 2 - Math.PI / 2;
      targetX = np.x + Math.cos(angle) * PLAYER_ORBIT;
      targetY = np.y + Math.sin(angle) * PLAYER_ORBIT;
    }

    // Lerp rendered position toward target so orbit entry/exit feels smooth, not snappy
    let rs = playerRenderState[p.id];
    if (!rs) {
      rs = playerRenderState[p.id] = { x: targetX, y: targetY };
    } else {
      rs.x += (targetX - rs.x) * RENDER_LERP;
      rs.y += (targetY - rs.y) * RENDER_LERP;
    }
    const px = rs.x;
    const py = rs.y;

    const isMe = p.id === myId;
    const isFrozen = !!p.frozenUntil;
    const alpha = isFrozen ? 0.4 : 1.0;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.strokeStyle = ROLE_COLORS[p.role] || '#e6edf3';
    ctx.lineWidth = isMe ? 4 : 2;
    ctx.beginPath();
    ctx.arc(px, py, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0e1117';
    ctx.font = 'bold 10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ROLE_ABBR[p.role] || '?', px, py);

    ctx.fillStyle = '#e6edf3';
    ctx.font = (isMe ? 'bold ' : '') + '11px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(p.name, px, py - PLAYER_RADIUS - 6);
    ctx.globalAlpha = 1.0;

    // Frozen overlay: 📞 above the token
    if (isFrozen) {
      ctx.font = '18px -apple-system, "Apple Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('📞', px + PLAYER_RADIUS + 4, py - PLAYER_RADIUS - 4);
    }
  }

  // Freeze banner DOM update (refreshed each frame so countdown ticks smoothly)
  if (myId) {
    const me = state.players.find((p) => p.id === myId);
    if (me && me.frozenUntil) {
      const remain = Math.max(0, me.frozenUntil - Date.now());
      const secs = Math.ceil(remain / 1000);
      const holdElapsed = bailHoldStartedAt ? performance.now() - bailHoldStartedAt : 0;
      const holdPct = Math.min(100, (holdElapsed / BAIL_HOLD_MS) * 100);
      freezeBannerEl.innerHTML =
        `<div class="freeze-line">📞 <strong>${escapeHtmlSimple(me.frozenVerb || 'In a meeting')}</strong> — ${secs}s left</div>` +
        `<div class="freeze-bail">Hold <span class="key">F</span> for 2s to bail (+1 alert)` +
        (holdElapsed > 0 ? `<div class="bail-bar"><div class="bail-bar-fill" style="width:${holdPct}%"></div></div>` : '') +
        `</div>`;
      freezeBannerEl.className = 'show';
    } else {
      freezeBannerEl.className = '';
      freezeBannerEl.innerHTML = '';
    }
  }
}

function escapeHtmlSimple(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

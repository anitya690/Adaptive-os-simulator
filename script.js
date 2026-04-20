// ============================================================
//  Adaptive Resource Allocation — OS Simulator
//  script.js
// ============================================================

// ===== CONSTANTS =====
const TOTAL_MEM = 1024;
const PROC_COLORS = [
  '#00e5ff','#00ff9d','#b06bff','#ff5ca8',
  '#ffab00','#448aff','#ff3d5a','#00c47a',
  '#7c4dff','#ff6d00'
];
const PRESETS = [
  {name:'Chrome',   burst:35,  mem:120, io:3, pri:7, type:'IO'},
  {name:'Compiler', burst:100, mem:80,  io:9, pri:6, type:'CPU'},
  {name:'Video',    burst:25,  mem:64,  io:2, pri:5, type:'IO'},
  {name:'Database', burst:70,  mem:180, io:4, pri:9, type:'MIX'},
  {name:'Antivirus',burst:45,  mem:48,  io:7, pri:3, type:'CPU'},
  {name:'WebServer',burst:20,  mem:72,  io:2, pri:8, type:'IO'},
];

// ===== STATE =====
let procs = [], pidCnt = 1, running = false, policy = 'RR', memPol = 'FF';
let quantum = 4, tickMs = 800, agingThresh = 6;
let cpuProc = null, rrIdx = 0, tick = 0, tputCount = 0, tput = 0, tputAcc = 0;
let trendData = {cpu:[], mem:[], blocked:[]}, ganttLog = [], simInt = null;
let trendChart = null, stateChart = null;

// ===== HELPERS =====
function uid()    { return pidCnt++; }
function color(i) { return PROC_COLORS[i % PROC_COLORS.length]; }
function active() { return procs.filter(p => p.state !== 'done'); }

// ===== TABS =====
function gotoTab(id) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  const tabs = ['overview','processes','gantt','memory','settings'];
  document.querySelectorAll('.nav-btn').forEach((el, i) => {
    el.classList.toggle('active', tabs[i] === id);
  });
}

// ===== POLICY =====
function setPol(p, el) {
  policy = p;
  document.querySelectorAll('#cpu-policy-row .pill').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  sysLog(`Scheduling → ${p}`, 'info');
}

function setMem(p, el) {
  memPol = p;
  document.querySelectorAll('#mem-policy-row .pill').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  sysLog(`Memory policy → ${p}`, 'info');
}

// ===== ADD PROCESS =====
function addProc() {
  const nm    = document.getElementById('p-name').value.trim() || ('P' + pidCnt);
  const burst = Math.max(1, +document.getElementById('p-burst').value || 30);
  const mem   = Math.max(8, +document.getElementById('p-mem').value || 64);
  const pri   = +document.getElementById('p-pri').value || 5;
  const io    = +document.getElementById('p-io').value || 5;
  const type  = document.getElementById('p-type').value;
  const used  = active().reduce((a, p) => a + p.mem, 0);

  if (used + mem > TOTAL_MEM) {
    setMsg('⚠ Not enough memory available', 'var(--red)');
    return;
  }
  const p = {
    id: uid(), name: nm, burst, remaining: burst,
    mem, io, pri, type, state: 'ready',
    wait: 0, turn: 0, cpuUsed: 0, age: 0, mlfqLv: 0,
    color: color(procs.length)
  };
  procs.push(p);
  document.getElementById('p-name').value = '';
  setMsg(`✓ ${nm} added — ${mem} MB, ${burst} ms burst`, 'var(--green)');
  sysLog(`+ ${nm} (PID ${p.id}) burst=${burst}ms mem=${mem}MB pri=${pri}`, 'ok');
  render();
}

function setMsg(m, c) {
  const el = document.getElementById('add-msg');
  el.textContent = m;
  el.style.color = c;
}

// ===== PRESETS =====
function loadPresets() {
  let added = 0;
  let used = active().reduce((a, p) => a + p.mem, 0);
  PRESETS.forEach(pr => {
    if (used + pr.mem > TOTAL_MEM) return;
    const p = {
      ...pr, id: uid(), remaining: pr.burst, state: 'ready',
      wait: 0, turn: 0, cpuUsed: 0, age: 0, mlfqLv: 0,
      color: color(procs.length + added)
    };
    procs.push(p);
    used += pr.mem;
    added++;
  });
  sysLog(`Loaded ${added} preset processes`, 'ok');
  render();
}

// ===== SIM CONTROL =====
function toggleSim() {
  running = !running;
  document.getElementById('pulse-dot').classList.toggle('on', running);
  document.getElementById('sim-label').textContent = running ? 'RUNNING' : 'STOPPED';
  const btn = document.getElementById('btn-run');
  btn.textContent = running ? '⏸ PAUSE' : '▶ START';
  btn.classList.toggle('btn-start', !running);
  btn.classList.toggle('running', running);
  if (running) {
    simInt = setInterval(simTick, tickMs);
  } else {
    clearInterval(simInt);
  }
}

function resetAll() {
  running = false;
  clearInterval(simInt);
  procs = []; pidCnt = 1; cpuProc = null; rrIdx = 0;
  tick = 0; tput = 0; tputAcc = 0; tputCount = 0;
  trendData = {cpu:[], mem:[], blocked:[]}; ganttLog = [];
  const btn = document.getElementById('btn-run');
  btn.textContent = '▶ START';
  btn.className = 'btn btn-start';
  document.getElementById('pulse-dot').classList.remove('on');
  document.getElementById('sim-label').textContent = 'STOPPED';
  document.getElementById('tick-display').textContent = '000';
  document.getElementById('sys-log').innerHTML = '';
  if (trendChart) {
    trendChart.data.labels = [];
    trendChart.data.datasets.forEach(d => d.data = []);
    trendChart.update();
  }
  render();
  sysLog('System reset', 'warn');
}

// ===== SCHEDULER =====
function pickNext() {
  const ready = procs.filter(p => p.state === 'ready');
  if (!ready.length) return null;
  if (policy === 'FCFS')     return ready[0];
  if (policy === 'SJF')      return ready.slice().sort((a, b) => a.remaining - b.remaining)[0];
  if (policy === 'PRIORITY') return ready.slice().sort((a, b) => b.pri - a.pri)[0];
  if (policy === 'RR')       { rrIdx = rrIdx % ready.length; return ready[rrIdx]; }
  if (policy === 'MLFQ') {
    for (let l = 0; l < 4; l++) {
      const lp = ready.filter(p => p.mlfqLv === l);
      if (lp.length) return lp[0];
    }
    return ready[0];
  }
  return ready[0];
}

// ===== SIM TICK =====
function simTick() {
  tick++;
  document.getElementById('tick-display').textContent = String(tick).padStart(3, '0');

  // Aging: waiting processes get priority boost
  procs.filter(p => p.state === 'ready').forEach(p => {
    p.wait++; p.age++;
    if (p.age >= agingThresh && p.pri < 10) {
      p.pri = Math.min(10, p.pri + 1);
      p.age = 0;
      sysLog(`${p.name} aged → priority ${p.pri}`, 'warn');
    }
  });

  // I/O completion (random, based on I/O frequency)
  procs.filter(p => p.state === 'blocked').forEach(p => {
    if (Math.random() < (1 / p.io)) {
      p.state = 'ready';
      sysLog(`${p.name} I/O done → ready`, 'ok');
    }
  });

  // CPU scheduling
  if (!cpuProc || cpuProc.state !== 'running') {
    if (cpuProc && cpuProc.state === 'running') cpuProc.state = 'ready';
    const nxt = pickNext();
    if (nxt) { cpuProc = nxt; nxt.state = 'running'; rrIdx++; }
    else cpuProc = null;
  }

  if (cpuProc) {
    const p = cpuProc;
    const sl = Math.min(quantum, p.remaining);
    p.remaining -= sl; p.cpuUsed += sl; p.turn += sl;
    ganttLog.push({name: p.name, color: p.color, tick});
    if (ganttLog.length > 24) ganttLog.shift();

    if (Math.random() < (1 / p.io)) {
      // Process goes blocked on I/O
      p.state = 'blocked'; cpuProc = null;
      sysLog(`${p.name} blocked on I/O`, 'warn');
    } else if (p.remaining <= 0) {
      // Process completed
      p.state = 'done'; tputAcc++;
      sysLog(`${p.name} done — wait ${p.wait}ms turn ${p.turn}ms`, 'ok');
      cpuProc = null;
    } else if (policy === 'RR' || policy === 'MLFQ') {
      // Time quantum expired
      if (policy === 'MLFQ' && p.mlfqLv < 3) p.mlfqLv++;
      p.state = 'ready'; cpuProc = null;
    }
  }

  // Throughput every 5 ticks
  if (tick % 5 === 0) { tput = +(tputAcc / 5).toFixed(1); tputAcc = 0; }

  const used    = active().reduce((a, p) => a + p.mem, 0);
  const memPct  = Math.round(used / TOTAL_MEM * 100);
  const cpuPct  = cpuProc ? 100 : 0;
  const blk     = procs.filter(p => p.state === 'blocked').length;
  const blkPct  = Math.round(blk / Math.max(1, procs.length) * 100);
  pushTrend(cpuPct, memPct, blkPct);

  // Bottleneck detection
  const bottleneck = memPct > 85 || blk > 3;
  const ab = document.getElementById('alert-box');
  if (bottleneck) {
    ab.classList.remove('hidden');
    document.getElementById('alert-msg').textContent =
      `Bottleneck — mem ${memPct}%, ${blk} blocked processes. Reallocating priorities.`;
  } else {
    ab.classList.add('hidden');
  }

  render();
}

// ===== TREND DATA =====
function pushTrend(cpu, mem, blk) {
  ['cpu','mem','blocked'].forEach((k, i) => {
    trendData[k].push([cpu, mem, blk][i]);
    if (trendData[k].length > 24) trendData[k].shift();
  });
  if (trendChart) {
    const labels = trendData.cpu.map((_, i) => i);
    trendChart.data.labels = labels;
    trendChart.data.datasets[0].data = [...trendData.cpu];
    trendChart.data.datasets[1].data = [...trendData.mem];
    trendChart.data.datasets[2].data = [...trendData.blocked];
    trendChart.update('none');
  }
  if (stateChart) {
    const rdy  = procs.filter(p => p.state === 'ready').length;
    const run  = procs.filter(p => p.state === 'running').length;
    const blkN = procs.filter(p => p.state === 'blocked').length;
    const dn   = procs.filter(p => p.state === 'done').length;
    stateChart.data.datasets[0].data = [run, rdy, blkN, dn];
    stateChart.update('none');
  }
}

// ===== RENDER =====
function render() {
  const act    = active();
  const used   = act.reduce((a, p) => a + p.mem, 0);
  const memPct = Math.round(used / TOTAL_MEM * 100);
  const rdy    = procs.filter(p => p.state === 'ready').length;
  const blk    = procs.filter(p => p.state === 'blocked').length;
  const cpuPct = cpuProc ? 100 : 0;

  // --- Metric Cards ---
  const mCpu = document.getElementById('m-cpu');
  mCpu.textContent = cpuPct + '%';
  mCpu.style.color = cpuPct > 85 ? 'var(--red)' : cpuPct > 60 ? 'var(--amber)' : 'var(--cyan)';
  document.getElementById('m-cpu-sub').textContent = cpuProc ? `Running: ${cpuProc.name}` : 'Idle';

  const mMem = document.getElementById('m-mem');
  mMem.textContent = used + ' MB';
  mMem.style.color = memPct > 85 ? 'var(--red)' : memPct > 60 ? 'var(--amber)' : 'var(--green)';
  document.getElementById('m-mem-sub').textContent = `${memPct}% of 1024 MB`;

  document.getElementById('m-procs').textContent = act.length;
  document.getElementById('m-procs-sub').textContent = `${rdy} ready · ${blk} blocked`;
  document.getElementById('m-tput').textContent = tput;

  // --- Process List (Overview Tab) ---
  if (!procs.length) {
    document.getElementById('proc-list').innerHTML =
      '<div style="font-size:11px;color:var(--text-dim);padding:.5rem 0">No processes. Go to Settings to add processes.</div>';
  } else {
    document.getElementById('proc-list').innerHTML = procs.map(p => {
      const pct   = p.burst > 0 ? Math.max(0, Math.round((1 - p.remaining / p.burst) * 100)) : 100;
      const badge = p.state === 'running' ? 'run' : p.state === 'blocked' ? 'block' : p.state === 'done' ? 'done' : 'ready';
      return `<div class="proc-row">
        <div class="proc-dot" style="background:${p.color};color:${p.color}"></div>
        <div class="proc-name" title="${p.name}">${p.name}</div>
        <div style="width:68px;flex-shrink:0"><span class="badge badge-${badge}">${p.state}</span></div>
        <span style="font-size:9px;color:var(--text-dim);width:24px;flex-shrink:0;letter-spacing:.05em">CPU</span>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${p.color}"></div></div>
        <div class="proc-num">${p.remaining > 0 ? p.remaining + 'ms' : 'done'}</div>
        <span style="font-size:9px;color:var(--text-dim);width:26px;flex-shrink:0;letter-spacing:.05em;margin-left:4px">MEM</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round(p.mem / TOTAL_MEM * 100 * 5)}%;background:var(--green)"></div></div>
        <div class="proc-num">${p.mem}MB</div>
      </div>`;
    }).join('');
  }

  // --- Process Table (Processes Tab) ---
  document.getElementById('proc-tbody').innerHTML = procs.map(p => {
    const badge = p.state === 'running' ? 'run' : p.state === 'blocked' ? 'block' : p.state === 'done' ? 'done' : 'ready';
    return `<tr>
      <td style="color:var(--text-dim)">${p.id}</td>
      <td><span style="display:inline-flex;align-items:center;gap:5px">
        <span style="width:6px;height:6px;border-radius:50%;background:${p.color};box-shadow:0 0 6px ${p.color};flex-shrink:0"></span>
        ${p.name}
      </span></td>
      <td style="color:var(--text-secondary)">${p.type}</td>
      <td><span class="badge badge-${badge}">${p.state}</span></td>
      <td>${p.remaining}ms</td>
      <td>${p.mem}MB</td>
      <td>${p.pri}</td>
      <td>${p.wait}ms</td>
      <td>${p.mlfqLv}</td>
      <td>${p.cpuUsed}ms</td>
    </tr>`;
  }).join('');

  // --- Gantt Chart ---
  if (ganttLog.length) {
    const names    = [...new Set(ganttLog.map(g => g.name))];
    const colorMap = {};
    ganttLog.forEach(g => { colorMap[g.name] = g.color; });
    const ticks    = [...new Set(ganttLog.map(g => g.tick))].sort((a, b) => a - b);
    const nts      = {};
    ganttLog.forEach(g => { (nts[g.name] = nts[g.name] || new Set()).add(g.tick); });

    document.getElementById('gantt-area').innerHTML = `<table class="gantt-table">
      <thead><tr><th>Process</th>${ticks.map(t => `<th>T${t}</th>`).join('')}</tr></thead>
      <tbody>${names.map(n => `<tr>
        <td><span style="display:inline-flex;align-items:center;gap:5px">
          <span style="width:6px;height:6px;border-radius:50%;background:${colorMap[n]};box-shadow:0 0 6px ${colorMap[n]}"></span>
          ${n}
        </span></td>
        ${ticks.map(t => `<td><span class="gantt-cell" style="background:${nts[n].has(t) ? colorMap[n] : 'transparent'};${nts[n].has(t) ? `box-shadow:0 0 4px ${colorMap[n]}` : ''}"></span></td>`).join('')}
      </tr>`).join('')}
      </tbody>
    </table>`;

    document.getElementById('gantt-legend').innerHTML =
      names.map(n => `<div class="legend-item">
        <span class="legend-dot" style="background:${colorMap[n]};box-shadow:0 0 5px ${colorMap[n]}"></span>${n}
      </div>`).join('');
  }

  // --- Memory Bar ---
  const memBar = document.getElementById('mem-bar');
  let offset   = 0;
  const segs   = act.map(p => {
    const w = p.mem / TOTAL_MEM * 100;
    offset += w;
    return {name: p.name, w, color: p.color};
  });
  memBar.innerHTML = segs.map(s =>
    `<div class="mem-seg" style="width:${s.w}%;background:${s.color}" title="${s.name} ${s.w.toFixed(1)}%">
      ${s.w > 5 ? s.name : ''}
    </div>`
  ).join('') + `<div class="mem-free">${100 - offset > 1 ? `FREE · ${Math.round((100 - offset) / 100 * TOTAL_MEM)} MB` : ''}</div>`;

  document.getElementById('mem-legend').innerHTML =
    segs.map(s => `<div class="legend-item">
      <span class="legend-dot" style="background:${s.color};box-shadow:0 0 5px ${s.color}"></span>
      ${s.name} — ${Math.round(s.w / 100 * TOTAL_MEM)} MB
    </div>`).join('');

  document.getElementById('mm-used').textContent = used + ' MB';
  document.getElementById('mm-free').textContent = (TOTAL_MEM - used) + ' MB';
  document.getElementById('mm-frag').textContent = (act.length > 1 ? Math.min(99, Math.round((act.length - 1) * 7)) : 0) + '%';

  document.getElementById('mem-proc-list').innerHTML = act.length
    ? act.map(p => {
        const pct = Math.round(p.mem / TOTAL_MEM * 100);
        return `<div class="proc-row">
          <div class="proc-dot" style="background:${p.color};color:${p.color}"></div>
          <div class="proc-name">${p.name}</div>
          <div class="bar-track" style="flex:1">
            <div class="bar-fill" style="width:${Math.min(100, pct * 4)}%;background:${p.color}"></div>
          </div>
          <div class="proc-num">${p.mem}MB</div>
          <div style="font-size:9px;color:var(--text-dim);width:32px;letter-spacing:.04em">${pct}%</div>
        </div>`;
      }).join('')
    : '<div style="font-size:11px;color:var(--text-dim);padding:.5rem 0">No active processes.</div>';
}

// ===== SYSTEM LOG =====
function sysLog(msg, type) {
  const box = document.getElementById('sys-log');
  const cls = type === 'ok' ? 'log-ok' : type === 'warn' ? 'log-warn' : type === 'err' ? 'log-err' : 'log-info';
  const d   = document.createElement('div');
  d.className  = `log-line ${cls}`;
  d.textContent = `[T${String(tick).padStart(3, '0')}] ${msg}`;
  box.prepend(d);
  while (box.children.length > 80) box.removeChild(box.lastChild);
}

// ===== INIT CHARTS =====
window.addEventListener('load', () => {
  Chart.defaults.color       = '#7b82a0';
  Chart.defaults.font.family = "'JetBrains Mono', monospace";
  Chart.defaults.font.size   = 10;

  // Line Chart — CPU & Memory Trend
  const ctx1 = document.getElementById('trend-chart').getContext('2d');
  trendChart = new Chart(ctx1, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {label:'CPU %',     data:[], borderColor:'#00e5ff', backgroundColor:'rgba(0,229,255,0.06)',    tension:0.4, pointRadius:0, fill:true, borderWidth:1.5},
        {label:'Mem %',     data:[], borderColor:'#00ff9d', backgroundColor:'rgba(0,255,157,0.06)',    tension:0.4, pointRadius:0, fill:true, borderWidth:1.5},
        {label:'Blocked %', data:[], borderColor:'#b06bff', backgroundColor:'rgba(176,107,255,0.06)', tension:0.4, pointRadius:0, fill:true, borderWidth:1.5},
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { min:0, max:100, ticks:{maxTicksLimit:5, color:'#4a506a'}, grid:{color:'rgba(255,255,255,0.04)'}, border:{color:'rgba(255,255,255,0.05)'} },
        x: { display: false }
      },
      animation: false
    }
  });

  // Doughnut Chart — Process State Distribution
  const ctx2 = document.getElementById('state-chart').getContext('2d');
  stateChart = new Chart(ctx2, {
    type: 'doughnut',
    data: {
      labels: ['Running','Ready','Blocked','Done'],
      datasets: [{
        data: [0, 0, 0, 0],
        backgroundColor: ['#00ff9d','#00e5ff','#ffab00','#4a506a'],
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}` } }
      },
      cutout: '68%',
      animation: false
    }
  });

  render();
  sysLog('System initialised — add processes to begin', 'info');
});

/* O Passo Digital — camada de interface (app.js) */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const APP_VERSION = '2.0.0';

  // ------------------------------------------------------------------
  // Estado
  // ------------------------------------------------------------------
  const state = {
    settings: { position: 'lombar', duration: 30, delay: 5 },
    sensors: { tested: false, granted: false, fs: 0, gyro: false, linear: false, isIOS: false },
    samples: [],
    results: null,
    isDemo: false,
    charts: {},
    collecting: false,
    deferredInstall: null,
    wakeLock: null,
  };

  const isIOS = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
  state.sensors.isIOS = isIOS;
  // Convenção de sinal: o WebKit reporta accelerationIncludingGravity com sinal invertido em relação à especificação W3C.
  const ACC_SIGN = isIOS ? -1 : 1;

  // ------------------------------------------------------------------
  // Utilidades de interface
  // ------------------------------------------------------------------
  let toastTimer;
  function toast(msg, ms) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms || 2600);
  }
  function vibrate(pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* ignore */ } }
  let audioCtx;
  function beep(freq, dur) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = freq; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + (dur || 0.15));
      o.connect(g).connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + (dur || 0.15) + 0.02);
    } catch (e) { /* ignore */ }
  }
  const fmt = (v, d) => window.GaitAnalysis.formatPT(v, d);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const flagText = { ok: 'dentro da referência', warn: 'limítrofe', alert: 'fora da referência', na: 'informativo' };

  // Controles segmentados com indicador deslizante
  function setupSegmented(id, key, onChange) {
    const seg = $(id), thumb = seg.querySelector('.thumb');
    const buttons = Array.from(seg.querySelectorAll('button'));
    const update = (animate) => {
      const active = buttons.find((b) => b.getAttribute('aria-pressed') === 'true') || buttons[0];
      const idx = buttons.indexOf(active);
      const w = 100 / buttons.length;
      if (!animate) thumb.style.transition = 'none';
      thumb.style.width = `calc(${w}% - 4px)`;
      thumb.style.transform = `translateX(${idx * 100}%)`;
      thumb.style.marginLeft = `${idx * 4 / buttons.length}px`;
      if (!animate) requestAnimationFrame(() => { thumb.style.transition = ''; });
    };
    const select = (b) => {
      if (b.getAttribute('aria-pressed') === 'true') return;
      buttons.forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      state.settings[key] = isNaN(Number(b.dataset.value)) ? b.dataset.value : Number(b.dataset.value);
      update(true);
      saveSettings();
      if (onChange) onChange(state.settings[key]);
    };
    // resposta no toque (pointerdown) e também por teclado (click)
    buttons.forEach((b) => { b.addEventListener('pointerdown', () => select(b)); b.addEventListener('click', () => select(b)); });
    seg.setValue = (v) => { buttons.forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.value) === String(v) ? 'true' : 'false')); state.settings[key] = v; update(false); };
    update(false);
    window.addEventListener('resize', () => update(false));
    return seg;
  }

  function saveSettings() {
    try {
      localStorage.setItem('passo.settings', JSON.stringify({
        ...state.settings, personId: $('personId').value, height: $('height').value, legLength: $('legLength').value, age: $('age').value, sex: $('sex').value,
      }));
    } catch (e) { /* ignore */ }
  }
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('passo.settings') || '{}');
      if (s.position) $('positionSeg').setValue(s.position);
      if (s.duration) $('durationSeg').setValue(s.duration);
      if (s.delay) $('delaySeg').setValue(s.delay);
      for (const k of ['personId', 'height', 'legLength', 'age', 'sex']) if (s[k] !== undefined) $(k).value = s[k];
    } catch (e) { /* ignore */ }
  }

  function participantOpts() {
    const heightCm = parseFloat($('height').value);
    const legLengthCm = parseFloat($('legLength').value);
    const age = parseFloat($('age').value);
    return {
      position: state.settings.position,
      heightCm: Number.isFinite(heightCm) ? heightCm : undefined,
      legLengthCm: Number.isFinite(legLengthCm) ? legLengthCm : undefined,
      age: Number.isFinite(age) ? age : undefined,
      sex: $('sex').value || undefined,
      personId: $('personId').value.trim(),
    };
  }

  // ------------------------------------------------------------------
  // Sensores
  // ------------------------------------------------------------------
  async function requestPermission() {
    if (!isIOS) return typeof DeviceMotionEvent !== 'undefined';
    try {
      const r = await DeviceMotionEvent.requestPermission();
      return r === 'granted';
    } catch (e) {
      console.warn('Permissão de movimento negada', e);
      return false;
    }
  }

  function readSample(ev) {
    const a = ev.accelerationIncludingGravity;
    if (!a || a.x === null || a.x === undefined) return null;
    const r = ev.rotationRate;
    const s = { t: ev.timeStamp / 1000, ax: ACC_SIGN * a.x, ay: ACC_SIGN * a.y, az: ACC_SIGN * a.z };
    if (r && r.beta !== null && r.beta !== undefined) { s.gx = r.beta; s.gy = r.gamma; s.gz = r.alpha; }
    return s;
  }

  async function testSensors() {
    const btn = $('testBtn');
    btn.disabled = true;
    $('sensorState').textContent = 'testando…';
    const granted = await requestPermission();
    if (!granted) {
      $('sensorState').textContent = 'sem permissão';
      $('sensorInfo').textContent = 'Permita o acesso ao movimento nas configurações do navegador.';
      btn.disabled = false;
      toast('Permissão de movimento negada.');
      return;
    }
    const buf = [];
    const handler = (ev) => { const s = readSample(ev); if (s) buf.push(s); };
    window.addEventListener('devicemotion', handler, true);
    await new Promise((r) => setTimeout(r, 2000));
    window.removeEventListener('devicemotion', handler, true);
    btn.disabled = false;
    if (buf.length < 10) {
      $('sensorState').textContent = 'indisponível';
      $('sensorInfo').textContent = 'Nenhum dado de movimento recebido. Use um smartphone com acelerômetro (ou a demonstração).';
      state.sensors.tested = true; state.sensors.granted = false;
      $('startBtn').disabled = true;
      toast('Sensores de movimento não detectados neste aparelho.');
      return;
    }
    const dts = [];
    for (let i = 1; i < buf.length; i++) dts.push(buf[i].t - buf[i - 1].t);
    dts.sort((a, b) => a - b);
    const fs = 1 / dts[dts.length >> 1];
    const gyro = buf.filter((s) => Number.isFinite(s.gx)).length / buf.length > 0.9;
    const gmag = buf.reduce((s, x) => s + Math.hypot(x.ax, x.ay, x.az), 0) / buf.length;
    state.sensors = { ...state.sensors, tested: true, granted: true, fs, gyro };
    $('sensorState').textContent = 'prontos';
    $('sensorInfo').textContent = `${fs.toFixed(0)} Hz · giroscópio ${gyro ? 'disponível' : 'ausente'} · |g| = ${gmag.toFixed(2)} m/s²${isIOS ? ' · iOS' : ''}`;
    $('startBtn').disabled = false;
    vibrate(30);
    toast(`Sensores prontos: ${fs.toFixed(0)} Hz${gyro ? ', com giroscópio' : ', sem giroscópio'}.`);
  }

  // ------------------------------------------------------------------
  // Coleta
  // ------------------------------------------------------------------
  const RING_LEN = 502.65;
  let motionHandler = null, timers = [], rafId = null;
  function setRing(frac, cls) {
    const bar = $('ringBar');
    bar.style.strokeDashoffset = String(RING_LEN * (1 - Math.max(0, Math.min(1, frac))));
    bar.classList.toggle('countdown', cls === 'countdown');
  }
  function openSheet() { $('scrim').classList.add('open'); $('sheet').classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeSheet() { $('scrim').classList.remove('open'); $('sheet').classList.remove('open'); document.body.style.overflow = ''; }
  async function acquireWakeLock() { try { if (navigator.wakeLock) state.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ } }
  function releaseWakeLock() { try { if (state.wakeLock) { state.wakeLock.release(); state.wakeLock = null; } } catch (e) { /* ignore */ } }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; if (rafId) cancelAnimationFrame(rafId); rafId = null; }

  function validateInputs() {
    const o = participantOpts();
    if (state.settings.position === 'lombar' && !(o.heightCm >= 100 && o.heightCm <= 230)) {
      toast('Informe a estatura (100–230 cm) para o modelo espacial.');
      $('height').focus();
      return false;
    }
    return true;
  }

  async function startCollection() {
    if (state.collecting) return;
    if (!validateInputs()) return;
    if (!state.sensors.granted) { toast('Teste os sensores antes de iniciar.'); return; }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    state.collecting = true;
    state.isDemo = false;
    state.samples = [];
    state.walkStart = null;
    hideResults();
    await acquireWakeLock();
    openSheet();

    const delay = state.settings.delay, duration = state.settings.duration;
    $('sheetTitle').textContent = 'Preparar';
    $('sheetHint').textContent = 'Fique parado, em pé. Comece a andar ao sinal.';
    $('ringLabel').textContent = 'segundos';
    $('liveSamples').textContent = '0'; $('liveRate').textContent = '— Hz'; $('liveSteps').textContent = '0';
    const t0 = performance.now();
    // registra desde já para aproveitar a fase parada como referência de qualidade
    motionHandler = (ev) => { const s = readSample(ev); if (s) state.samples.push(s); };
    window.addEventListener('devicemotion', motionHandler, true);

    let phase = 'countdown';
    const tick = () => {
      const el = (performance.now() - t0) / 1000;
      if (phase === 'countdown') {
        const rem = delay - el;
        $('ringNum').textContent = String(Math.max(0, Math.ceil(rem)));
        setRing(rem / delay, 'countdown');
        if (rem <= 0) {
          phase = 'walk';
          beep(880, 0.25); vibrate([80, 60, 80]);
          $('sheetTitle').textContent = 'Caminhe';
          $('sheetHint').textContent = 'Em linha reta, no seu ritmo habitual. Não olhe para a tela.';
          $('ringLabel').textContent = 'restantes';
          state.walkStart = state.samples.length ? state.samples[state.samples.length - 1].t : null;
        }
      } else {
        const walked = el - delay;
        const rem = duration - walked;
        $('ringNum').textContent = String(Math.max(0, Math.ceil(rem)));
        setRing(walked / duration, 'walk');
        const n = state.samples.length;
        $('liveSamples').textContent = String(n);
        if (n > 20) $('liveRate').textContent = `${(n / (state.samples[n - 1].t - state.samples[0].t)).toFixed(0)} Hz`;
        if (Math.floor(walked * 2) !== Math.floor((walked - 0.05) * 2)) $('liveSteps').textContent = String(quickStepCount());
        if (rem <= 0) { stopCollection(false); return; }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }

  // contagem rápida de passos (só para feedback ao vivo)
  function quickStepCount() {
    const s = state.samples;
    if (!state.walkStart || s.length < 50) return 0;
    let count = 0, prev = 0, last = -1;
    const start = s.findIndex((x) => x.t >= state.walkStart);
    let mean = 0; const n = s.length - start; if (n <= 0) return 0;
    for (let i = start; i < s.length; i++) mean += Math.hypot(s[i].ax, s[i].ay, s[i].az);
    mean /= n;
    let ema = 0;
    for (let i = start; i < s.length; i++) {
      const v = Math.hypot(s[i].ax, s[i].ay, s[i].az) - mean;
      ema = 0.7 * ema + 0.3 * v;
      if (prev <= 1.0 && ema > 1.0 && s[i].t - last > 0.3) { count++; last = s[i].t; }
      prev = ema;
    }
    return count;
  }

  function stopCollection(cancel) {
    if (!state.collecting) return;
    state.collecting = false;
    clearTimers();
    if (motionHandler) window.removeEventListener('devicemotion', motionHandler, true);
    motionHandler = null;
    releaseWakeLock();
    closeSheet();
    if (cancel) { toast('Coleta cancelada.'); return; }
    if (state.walkStart === null || state.walkStart === undefined) { toast('Coleta interrompida antes do início da caminhada.'); return; }
    beep(660, 0.2); vibrate(120);
    // remove a fase de contagem regressiva (parado) do registro analisado
    let samples = state.samples;
    if (state.walkStart !== null && state.walkStart !== undefined) {
      const walk = samples.filter((s) => s.t >= state.walkStart - 0.5);
      if (walk.length > 100) samples = walk;
    }
    runAnalysis(samples, false);
  }

  // ------------------------------------------------------------------
  // Análise e apresentação
  // ------------------------------------------------------------------
  function hideResults() {
    for (const id of ['warningsSection', 'resultsSection', 'chartsSection', 'reportSection', 'exportSection']) $(id).classList.add('hidden');
  }

  function runAnalysis(samples, isDemo) {
    toast('Processando…', 1500);
    state.samples = samples;
    state.isDemo = isDemo;
    setTimeout(() => {
      try {
        const opts = participantOpts();
        const res = window.GaitAnalysis.analyze(samples, opts);
        res.participant = { ...opts, collectedAt: new Date().toISOString(), demo: isDemo, appVersion: APP_VERSION, userAgent: navigator.userAgent, isIOS };
        state.results = res;
        render(res);
        toast(isDemo ? 'Demonstração concluída.' : 'Análise concluída.');
        $('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        console.error(err);
        state.results = null;
        hideResults();
        $('warningsSection').classList.remove('hidden');
        $('warningsBox').className = 'callout error';
        $('warningsBox').innerHTML = `<div><strong>Não foi possível concluir a análise.</strong><br>${esc(err.message || err)}</div>`;
        $('warningsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 60);
  }

  function render(res) {
    const GA = window.GaitAnalysis;
    const m = res.metrics, f = res.flags;
    // avisos
    if (res.warnings.length) {
      $('warningsSection').classList.remove('hidden');
      $('warningsBox').className = 'callout warn';
      $('warningsBox').innerHTML = `<div><strong>Observações sobre o registro</strong><ul>${res.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`;
    } else $('warningsSection').classList.add('hidden');

    // tiles
    $('resultsHeader').textContent = `Resultados${res.participant.personId ? ' · ' + res.participant.personId : ''}${res.participant.demo ? ' · DEMONSTRAÇÃO' : ''}`;
    const tileDefs = res.position === 'bolso'
      ? ['cadence', 'strideTime', 'strideTimeCV', 'stepTimeAsym']
      : ['gaitSpeed', 'cadence', 'stepLength', 'strideTimeCV'];
    $('tiles').innerHTML = tileDefs.map((id) => {
      const def = GA.metric(id);
      return `<div class="tile"><div class="k">${esc(def.label)}</div><div class="v">${fmt(m[id], def.digits)}<small> ${esc(def.unit)}</small></div><span class="status ${f[id]}">${flagText[f[id]]}</span></div>`;
    }).join('');

    // lista por domínio
    const domains = ['Passo (pace)', 'Ritmo', 'Variabilidade', 'Assimetria', 'Controle postural', 'Suavidade', 'Sessão'];
    let html = '';
    for (const d of domains) {
      const defs = GA.METRICS.filter((x) => x.domain === d && Number.isFinite(m[x.id]));
      if (!defs.length) continue;
      html += `<div class="domain-title">${esc(d)}</div>`;
      for (const def of defs) {
        html += `<div class="metric"><span class="name">${esc(def.label)}</span><span class="val">${fmt(m[def.id], def.digits)}<small> ${esc(def.unit)}</small></span><span class="ref">${esc(def.ref)}</span><span class="status ${f[def.id]}">${flagText[f[def.id]]}</span></div>`;
      }
    }
    $('metricsList').innerHTML = html;
    $('resultsSection').classList.remove('hidden');

    // gráficos
    renderCharts(res);
    $('chartsSection').classList.remove('hidden');

    // relatório
    renderReport(res);
    $('reportSection').classList.remove('hidden');
    $('exportSection').classList.remove('hidden');
    $('shareBtn').classList.toggle('hidden', !(navigator.share && navigator.canShare));
  }

  function renderReport(res) {
    const p = res.participant;
    const head = `<p class="meta">${esc(p.personId || 'Sem identificação')} · ${new Date(p.collectedAt).toLocaleString('pt-BR')} · ${p.age ? p.age + ' anos' : 'idade não informada'}${p.sex ? ' · ' + (p.sex === 'F' ? 'feminino' : 'masculino') : ''}${p.heightCm ? ' · ' + fmt(p.heightCm, 1) + ' cm' : ''}${p.demo ? ' · <strong>dados simulados</strong>' : ''}</p>`;
    let html = head;
    for (const sec of res.report.sections) {
      html += `<h3>${esc(sec.title)}</h3>`;
      if (sec.paragraphs) html += sec.paragraphs.map((t) => `<p>${esc(t)}</p>`).join('');
      if (sec.table) {
        html += `<div class="table-scroll"><table class="data"><thead><tr><th>Domínio</th><th style="text-align:left">Parâmetro</th><th>Valor</th><th>Status</th></tr></thead><tbody>`;
        html += sec.table.map((r) => `<tr><td>${esc(r.domain)}</td><td style="text-align:left">${esc(r.label)}</td><td>${r.value} ${esc(r.unit)}</td><td><span class="status ${r.flag}">${flagText[r.flag]}</span></td></tr>`).join('');
        html += '</tbody></table></div>';
      }
    }
    $('reportBox').innerHTML = html;
    // tabela por passada
    const rows = res.strides.map((s) => `<tr class="${s.valid ? '' : 'invalid'}"><td>${s.index + 1}</td><td>${fmt(s.tStart, 2)}</td><td>${fmt(s.duration, 3)}</td><td>${fmt(s.stepTimes[0], 3)} / ${fmt(s.stepTimes[1], 3)}</td><td>${fmt(s.length, 3)}</td><td>${fmt(s.hrV, 2)}</td><td>${fmt(s.doubleSupportPct, 1)}</td><td>${s.valid ? 'sim' : esc(s.reason)}</td></tr>`).join('');
    $('strideTableWrap').innerHTML = `<table class="data"><thead><tr><th>#</th><th>Início (s)</th><th>Passada (s)</th><th>Passos (s)</th><th>Compr. (m)</th><th>HR-V</th><th>Duplo apoio (%)</th><th>Válida</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  // ------------------------------------------------------------------
  // Gráficos (Chart.js)
  // ------------------------------------------------------------------
  function chartColors() {
    const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    return {
      blue: dark ? '#0A84FF' : '#007AFF', red: dark ? '#FF453A' : '#FF3B30', gray: dark ? 'rgba(235,235,245,0.3)' : 'rgba(60,60,67,0.3)',
      grid: dark ? 'rgba(84,84,88,0.5)' : 'rgba(60,60,67,0.15)', text: dark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)',
      band: dark ? 'rgba(235,235,245,0.10)' : 'rgba(60,60,67,0.10)', bg: dark ? '#1C1C1E' : '#FFFFFF',
    };
  }
  function destroyCharts() { for (const k in state.charts) { try { state.charts[k].destroy(); } catch (e) { /* ignore */ } } state.charts = {}; }

  function baseOptions(c, xTitle, yTitle) {
    return {
      responsive: true, maintainAspectRatio: false, animation: false, normalized: true,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: c.text, boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 11 } } },
        tooltip: { backgroundColor: c.bg, titleColor: c.text, bodyColor: c.text, borderColor: c.grid, borderWidth: 1, padding: 8, displayColors: false },
      },
      scales: {
        x: { type: 'linear', title: { display: true, text: xTitle, color: c.text, font: { size: 11 } }, ticks: { color: c.text, font: { size: 11 }, maxTicksLimit: 8 }, grid: { color: c.grid, drawTicks: false }, border: { display: false } },
        y: { title: { display: true, text: yTitle, color: c.text, font: { size: 11 } }, ticks: { color: c.text, font: { size: 11 }, maxTicksLimit: 6 }, grid: { color: c.grid, drawTicks: false }, border: { display: false } },
      },
    };
  }
  // plugin: faixas de exclusão (curvas/outliers)
  const bandPlugin = {
    id: 'bands',
    beforeDatasetsDraw(chart, args, opts) {
      if (!opts || !opts.bands || !opts.bands.length) return;
      const { ctx, chartArea, scales } = chart;
      ctx.save(); ctx.fillStyle = opts.color;
      for (const b of opts.bands) {
        const x1 = scales.x.getPixelForValue(b[0]), x2 = scales.x.getPixelForValue(b[1]);
        ctx.fillRect(Math.max(chartArea.left, x1), chartArea.top, Math.min(chartArea.right, x2) - Math.max(chartArea.left, x1), chartArea.bottom - chartArea.top);
      }
      ctx.restore();
    },
  };

  function decimate(t, y, maxPts) {
    const n = t.length; if (n <= maxPts) return { t: Array.from(t), y: Array.from(y) };
    const step = Math.ceil(n / maxPts); const tt = [], yy = [];
    for (let i = 0; i < n; i += step) { tt.push(t[i]); yy.push(y[i]); }
    return { t: tt, y: yy };
  }

  function renderCharts(res) {
    if (typeof Chart === 'undefined') return;
    destroyCharts();
    const c = chartColors();
    const sig = res.signals, fs = res.session.fs;
    const bands = res.steps.filter((s) => !s.valid).map((s) => [s.tStart, s.tEnd]);
    const line = (label, pts, color) => ({ label, data: pts, borderColor: color, borderWidth: 1.5, pointRadius: 0, tension: 0, parsing: false });

    // 1) sinal vertical + IC
    const d1 = decimate(sig.t, sig.v, 3000);
    const icPts = sig.ic.map((i) => ({ x: sig.t[i], y: sig.v[i] }));
    $('chartSignalTitle').textContent = res.position === 'bolso' ? 'Magnitude da aceleração (filtrada)' : 'Aceleração vertical do tronco';
    state.charts.signal = new Chart($('chartSignal'), {
      type: 'line', plugins: [bandPlugin],
      data: { datasets: [line('Aceleração (m/s²)', d1.t.map((x, i) => ({ x, y: d1.y[i] })), c.blue), { label: 'Contato inicial', data: icPts, type: 'scatter', pointRadius: 3.5, pointBackgroundColor: c.red, pointBorderColor: c.bg, pointBorderWidth: 1, parsing: false }] },
      options: { ...baseOptions(c, 'tempo (s)', 'm/s²'), plugins: { ...baseOptions(c).plugins, bands: { bands, color: c.band } } },
    });
    // 2) deslocamento vertical
    if (sig.posV) {
      $('chartPosCard').classList.remove('hidden');
      const d2 = decimate(sig.t, Float64Array.from(sig.posV, (v) => v * 100), 3000);
      state.charts.pos = new Chart($('chartPos'), {
        type: 'line', plugins: [bandPlugin],
        data: { datasets: [line('Deslocamento vertical (cm)', d2.t.map((x, i) => ({ x, y: d2.y[i] })), c.blue)] },
        options: { ...baseOptions(c, 'tempo (s)', 'cm'), plugins: { ...baseOptions(c).plugins, legend: { display: false }, bands: { bands, color: c.band } } },
      });
    } else $('chartPosCard').classList.add('hidden');
    // 3) tempos de passada
    const valid = res.strides.filter((s) => s.valid);
    const meanT = res.metrics.strideTime;
    state.charts.stride = new Chart($('chartStride'), {
      type: 'line',
      data: { datasets: [
        { label: 'Tempo da passada (s)', data: valid.map((s) => ({ x: s.tStart, y: s.duration })), borderColor: c.blue, backgroundColor: c.blue, borderWidth: 1.5, pointRadius: 3, tension: 0, parsing: false },
        { label: `Média (${fmt(meanT, 3)} s)`, data: valid.length ? [{ x: valid[0].tStart, y: meanT }, { x: valid[valid.length - 1].tStart, y: meanT }] : [], borderColor: c.gray, borderDash: [4, 4], borderWidth: 1, pointRadius: 0, parsing: false },
      ] },
      options: baseOptions(c, 'início da passada (s)', 's'),
    });
    // 4) autocorrelação
    const ac = sig.autocorrV;
    const acPts = Array.from(ac).map((v, i) => ({ x: i / fs, y: v }));
    state.charts.ac = new Chart($('chartAC'), {
      type: 'line',
      data: { datasets: [line('Autocorrelação', acPts, c.blue), { label: 'Ad1 / Ad2', type: 'scatter', data: [{ x: res.metrics.stepTime, y: res.metrics.stepRegularity }, { x: res.metrics.strideTime, y: res.metrics.strideRegularity }], pointRadius: 5, pointBackgroundColor: c.red, pointBorderColor: c.bg, parsing: false }] },
      options: baseOptions(c, 'lag (s)', 'coeficiente'),
    });
  }

  // ------------------------------------------------------------------
  // Exportação
  // ------------------------------------------------------------------
  function filename(prefix, ext) {
    const id = (state.results && state.results.participant.personId ? state.results.participant.personId : 'sem_id').replace(/[^\w\-]+/g, '_');
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    return `${prefix}_${id}_${stamp}.${ext}`;
  }
  function download(content, name, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
  }
  const num = (v, d) => (Number.isFinite(v) ? v.toFixed(d === undefined ? 4 : d) : 'NA');
  const csvCell = (s) => { s = String(s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

  function exportResultsCSV() {
    const r = state.results, GA = window.GaitAnalysis;
    const rows = [['id', 'metric_id', 'label', 'value', 'unit', 'flag', 'domain', 'reference']];
    for (const def of GA.METRICS) if (Number.isFinite(r.metrics[def.id])) rows.push([r.participant.personId, def.id, def.label, num(r.metrics[def.id]), def.unit, r.flags[def.id], def.domain, def.ref]);
    const s = r.session;
    for (const [k, v] of Object.entries({ position: s.position, fs_raw_hz: num(s.fsRaw, 2), recording_s: num(s.recordingDuration, 2), analyzed_s: num(s.analyzedDuration, 2), steps_valid: s.stepsValid, strides_valid: s.stridesValid, turns: s.turns.length, demo: r.participant.demo }))
      rows.push([r.participant.personId, 'session_' + k, k, v, '', '', 'Sessão', '']);
    download(rows.map((row) => row.map(csvCell).join(',')).join('\n'), filename('resultados', 'csv'), 'text/csv;charset=utf-8');
  }
  function exportStridesCSV() {
    const r = state.results;
    const rows = [['id', 'stride', 'foot', 't_start_s', 't_end_s', 'stride_time_s', 'step1_time_s', 'step2_time_s', 'stride_length_m', 'hr_v', 'hr_ap', 'hr_ml', 'stance_s', 'swing_s', 'double_support_pct', 'valid', 'reason']];
    for (const s of r.strides) rows.push([r.participant.personId, s.index + 1, s.foot, num(s.tStart, 3), num(s.tEnd, 3), num(s.duration, 4), num(s.stepTimes[0], 4), num(s.stepTimes[1], 4), num(s.length, 4), num(s.hrV, 3), num(s.hrAP, 3), num(s.hrML, 3), num(s.stance, 3), num(s.swing, 3), num(s.doubleSupportPct, 2), s.valid ? 1 : 0, s.reason]);
    download(rows.map((row) => row.map(csvCell).join(',')).join('\n'), filename('passadas', 'csv'), 'text/csv;charset=utf-8');
  }
  function exportRawCSV() {
    const rows = ['t_s,acc_x,acc_y,acc_z,gyro_x,gyro_y,gyro_z'];
    const t0 = state.samples[0].t;
    for (const s of state.samples) rows.push(`${(s.t - t0).toFixed(4)},${s.ax.toFixed(4)},${s.ay.toFixed(4)},${s.az.toFixed(4)},${num(s.gx, 3)},${num(s.gy, 3)},${num(s.gz, 3)}`);
    download(rows.join('\n'), filename('brutos', 'csv'), 'text/csv;charset=utf-8');
  }
  function exportJSON() {
    const r = state.results;
    const t0 = state.samples[0].t;
    const payload = {
      app: 'O Passo Digital', version: APP_VERSION, analysisVersion: r.version, participant: r.participant, session: r.session, metrics: r.metrics, flags: r.flags,
      steps: r.steps, strides: r.strides, warnings: r.warnings, report: r.report,
      raw: state.samples.map((s) => [+(s.t - t0).toFixed(4), +s.ax.toFixed(4), +s.ay.toFixed(4), +s.az.toFixed(4), Number.isFinite(s.gx) ? +s.gx.toFixed(3) : null, Number.isFinite(s.gy) ? +s.gy.toFixed(3) : null, Number.isFinite(s.gz) ? +s.gz.toFixed(3) : null]),
      rawColumns: ['t_s', 'acc_x', 'acc_y', 'acc_z', 'gyro_x', 'gyro_y', 'gyro_z'],
    };
    download(JSON.stringify(payload), filename('sessao', 'json'), 'application/json');
  }

  // ---- PDF
  const pdfSafe = (s) => String(s).replace(/≈/g, '~').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/→/g, '->').replace(/[−–—]/g, '-').replace(/Δ/g, 'delta').replace(/σ/g, 'DP').replace(/·/g, '-').replace(/[“”]/g, '"').replace(/’/g, "'").replace(/…/g, '...').replace(/↔/g, '<->');
  function buildPDF() {
    const { jsPDF } = window.jspdf;
    const r = state.results, GA = window.GaitAnalysis, p = r.participant, s = r.session, m = r.metrics;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, L = 14, R = 196;
    let y = 18;
    const ensure = (h) => { if (y + h > 282) { doc.addPage(); y = 18; } };
    const text = (str, size, style, color) => {
      doc.setFontSize(size).setFont('helvetica', style || 'normal').setTextColor(...(color || [0, 0, 0]));
      const lines = doc.splitTextToSize(pdfSafe(str), R - L);
      for (const ln of lines) { ensure(size * 0.5); doc.text(ln, L, y); y += size * 0.45; }
    };
    const h2 = (t) => { ensure(14); y += 4; doc.setDrawColor(0, 122, 255); doc.setLineWidth(0.6); doc.line(L, y - 3.5, L + 6, y - 3.5); text(t, 13, 'bold', [0, 0, 0]); y += 1; };

    // cabeçalho
    doc.setFillColor(0, 122, 255); doc.rect(0, 0, W, 12, 'F');
    doc.setTextColor(255, 255, 255).setFontSize(9).setFont('helvetica', 'bold').text('O PASSO DIGITAL  -  RELATORIO DE ANALISE DE MARCHA', L, 8);
    text('Relatório de análise quantitativa da marcha', 18, 'bold');
    y += 1;
    text(`Participante: ${p.personId || 'não identificado'}    Data: ${new Date(p.collectedAt).toLocaleString('pt-BR')}`, 10, 'normal', [60, 60, 67]);
    text(`Idade: ${p.age ? p.age + ' anos' : '—'}    Sexo: ${p.sex === 'F' ? 'feminino' : p.sex === 'M' ? 'masculino' : '—'}    Estatura: ${p.heightCm ? fmt(p.heightCm, 1) + ' cm' : '—'}    Comprimento da perna: ${Number.isFinite(s.legLengthM) ? fmt(100 * s.legLengthM, 1) + ' cm' : '—'}`, 10, 'normal', [60, 60, 67]);
    text(`Posição do sensor: ${s.position === 'lombar' ? 'lombar (L5)' : 'bolso (análise simplificada)'}    App v${APP_VERSION} / núcleo v${r.version}${p.demo ? '    *** DADOS SIMULADOS (DEMONSTRAÇÃO) ***' : ''}`, 10, 'normal', [60, 60, 67]);

    // destaques
    h2('Síntese');
    const tiles = (s.position === 'bolso' ? ['cadence', 'strideTime', 'strideTimeCV', 'stepTimeAsym'] : ['gaitSpeed', 'cadence', 'stepLength', 'strideTimeCV']).map((id) => { const d = GA.metric(id); return [pdfSafe(d.label), `${fmt(m[id], d.digits)} ${d.unit}`, flagText[r.flags[id]]]; });
    doc.autoTable({ startY: y, margin: { left: L, right: 14 }, head: [['Parâmetro', 'Valor', 'Status']], body: tiles, theme: 'grid', styles: { fontSize: 10, cellPadding: 2.2 }, headStyles: { fillColor: [0, 122, 255] }, columnStyles: { 1: { fontStyle: 'bold' } } });
    y = doc.lastAutoTable.finalY + 4;

    // seções do relatório
    for (const sec of r.report.sections) {
      h2(sec.title);
      if (sec.paragraphs) for (const para of sec.paragraphs) { text(para, 10); y += 1.5; }
      if (sec.table) {
        const body = sec.table.map((row) => [pdfSafe(row.domain), pdfSafe(row.label), `${row.value} ${pdfSafe(row.unit)}`, pdfSafe(row.ref), flagText[row.flag]]);
        doc.autoTable({ startY: y, margin: { left: L, right: 14 }, head: [['Domínio', 'Parâmetro', 'Valor', 'Referência', 'Status']], body, theme: 'striped', styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak' }, headStyles: { fillColor: [0, 122, 255] }, columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 40 }, 2: { cellWidth: 24, fontStyle: 'bold' }, 3: { cellWidth: 70 }, 4: { cellWidth: 24 } },
          didParseCell: (d) => { if (d.section === 'body' && d.column.index === 4) { const fl = sec.table[d.row.index].flag; d.cell.styles.textColor = fl === 'alert' ? [255, 59, 48] : fl === 'warn' ? [200, 120, 0] : fl === 'ok' ? [40, 160, 80] : [120, 120, 128]; } } });
        y = doc.lastAutoTable.finalY + 4;
      }
    }

    // gráficos
    h2('Sinais e eventos');
    const imgs = ['signal', 'pos', 'stride', 'ac'].filter((k) => state.charts[k]);
    for (const k of imgs) {
      try {
        const ch = state.charts[k];
        // fundo branco + JPEG para manter o PDF leve
        const src = ch.canvas, off = document.createElement('canvas');
        const scale = Math.min(1, 1400 / src.width);
        off.width = Math.round(src.width * scale); off.height = Math.round(src.height * scale);
        const cx = off.getContext('2d'); cx.fillStyle = '#FFFFFF'; cx.fillRect(0, 0, off.width, off.height); cx.drawImage(src, 0, 0, off.width, off.height);
        const url = off.toDataURL('image/jpeg', 0.85);
        const w = R - L, h = (w * off.height) / off.width;
        ensure(h + 8);
        doc.addImage(url, 'JPEG', L, y, w, h, undefined, 'FAST');
        y += h + 4;
      } catch (e) { console.warn('gráfico não exportado', e); }
    }

    // tabela por passada
    h2('Anexo: passadas analisadas');
    const body = r.strides.map((st) => [st.index + 1, fmt(st.tStart, 2), fmt(st.duration, 3), `${fmt(st.stepTimes[0], 3)} / ${fmt(st.stepTimes[1], 3)}`, fmt(st.length, 3), fmt(st.hrV, 2), fmt(st.doubleSupportPct, 1), st.valid ? 'sim' : pdfSafe(st.reason)]);
    doc.autoTable({ startY: y, margin: { left: L, right: 14 }, head: [['#', 'Início (s)', 'Passada (s)', 'Passos (s)', 'Compr. (m)', 'HR-V', 'Duplo apoio (%)', 'Válida']], body, theme: 'striped', styles: { fontSize: 7.5, cellPadding: 1.2 }, headStyles: { fillColor: [0, 122, 255] } });
    y = doc.lastAutoTable.finalY + 4;

    // metodologia
    h2('Metodologia');
    const method = s.position === 'lombar' ? [
      `Aquisição: acelerômetro e giroscópio do smartphone via DeviceMotion (${fmt(s.fsRaw, 0)} Hz), reamostrados a ${s.fs} Hz por interpolação linear.`,
      'Eixos anatômicos: a direção vertical é definida pelo vetor gravitacional médio do trecho (correção de inclinação de Moe-Nilssen, 1998); as componentes ântero-posterior e médio-lateral são obtidas por projeção ortogonal. Sinais filtrados com Butterworth passa-baixas 20 Hz de fase zero.',
      'Eventos: contatos iniciais pelo método de McCamley et al. (2012) — integração da aceleração vertical seguida de derivação por wavelet gaussiana (escala ~10 a 100 Hz); contatos finais pelo mínimo da segunda derivação após cada contato inicial (estimativa exploratória para fases de apoio/balanço).',
      'Curvas: velocidade angular em torno da vertical > 20 graus/s com ângulo acumulado >= 45 graus (Pham et al., 2017); passos durante curvas e passos com duração atípica (mediana ± 3 MAD) são excluídos.',
      `Espacial: dupla integração da aceleração vertical com passa-altas 0,1 Hz; comprimento do passo = ${fmt(s.correctionFactor, 2)} x 2 x raiz(2 l h - h^2), com l = comprimento da perna e h = excursão vertical do passo (Zijlstra & Hof, 2003). Velocidade = comprimento da passada / tempo da passada.`,
      'Variabilidade e assimetria: DP e CV dos tempos de passada e passo (Hausdorff, 2001; 2005); assimetria = diferença absoluta entre passos alternados (Del Din et al., 2016).',
      'Harmonic ratio: por passada, soma das amplitudes das harmônicas pares / ímpares (V e AP) ou ímpares / pares (ML), 20 harmônicas (Menz et al., 2003). Regularidade: autocorrelação não enviesada nos lags de 1 passo (Ad1) e 1 passada (Ad2) (Moe-Nilssen & Helbostad, 2004). Suavidade: RMS do jerk 3D.',
      'Referências normativas: Bohannon & Williams Andrews (2011) para velocidade por idade/sexo; Hollman et al. (2011); Studenski et al. (2011); Abellan van Kan et al. (2009); Lord et al. (2013) para os domínios.',
    ] : [
      `Aquisição: acelerômetro do smartphone (${fmt(s.fsRaw, 0)} Hz), reamostrado a ${s.fs} Hz. Modo bolso: magnitude do vetor de aceleração (independente da orientação), filtro passa-banda 0,5-3 Hz e detecção de picos; apenas parâmetros temporais e de regularidade são reportados.`,
    ];
    for (const t of method) { text(t, 9, 'normal', [40, 40, 40]); y += 1; }
    h2('Referências');
    const refs = [
      'McCamley J, Donati M, Grimpampi E, Mazzà C. Gait Posture 2012;36:316-8. doi:10.1016/j.gaitpost.2012.02.019',
      'Zijlstra W, Hof AL. Gait Posture 2003;18:1-10. doi:10.1016/S0966-6362(02)00190-X',
      'Moe-Nilssen R. Arch Phys Med Rehabil 1998;79:1377-85. doi:10.1016/S0003-9993(98)90231-3',
      'Moe-Nilssen R, Helbostad JL. J Biomech 2004;37:121-6. doi:10.1016/S0021-9290(03)00233-1',
      'Menz HB, Lord SR, Fitzpatrick RC. Gait Posture 2003;18:35-46. doi:10.1016/S0966-6362(02)00159-5',
      'Del Din S, Godfrey A, Rochester L. IEEE J Biomed Health Inform 2016;20:838-47. doi:10.1109/JBHI.2015.2419317',
      'Pham MH et al. Front Neurol 2017;8:135 e 8:457. doi:10.3389/fneur.2017.00135; doi:10.3389/fneur.2017.00457',
      'Hausdorff JM, Rios DA, Edelberg HK. Arch Phys Med Rehabil 2001;82:1050-6. doi:10.1053/apmr.2001.24893',
      'Lord S et al. J Gerontol A 2013;68:820-7. doi:10.1093/gerona/gls255',
      'Bohannon RW, Williams Andrews A. Physiotherapy 2011;97:182-9. doi:10.1016/j.physio.2010.12.004',
      'Hollman JH, McDade EM, Petersen RC. Gait Posture 2011;34:111-8. doi:10.1016/j.gaitpost.2011.03.024',
      'Studenski S et al. JAMA 2011;305:50-8. doi:10.1001/jama.2010.1923',
      'Abellan van Kan G et al. J Nutr Health Aging 2009;13:881-9. doi:10.1007/s12603-009-0246-z',
    ];
    for (const t of refs) { text(t, 8, 'normal', [60, 60, 67]); }
    y += 2;
    text('Este relatório é um instrumento complementar de avaliação quantitativa gerado automaticamente; não constitui diagnóstico e não substitui a avaliação clínica.', 8, 'italic', [120, 120, 128]);

    // rodapé
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8).setTextColor(140, 140, 140).setFont('helvetica', 'normal');
      doc.text(`O Passo Digital v${APP_VERSION}  -  ${pdfSafe(p.personId || 'sem identificação')}  -  ${new Date(p.collectedAt).toLocaleDateString('pt-BR')}`, L, 291);
      doc.text(`${i} / ${pages}`, R, 291, { align: 'right' });
    }
    return doc;
  }
  function exportPDF() {
    try { buildPDF().save(filename('relatorio_marcha', 'pdf')); }
    catch (e) { console.error(e); toast('Erro ao gerar o PDF: ' + e.message); }
  }
  async function sharePDF() {
    try {
      const blob = buildPDF().output('blob');
      const file = new File([blob], filename('relatorio_marcha', 'pdf'), { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Relatório de marcha' });
      else download(blob, file.name, 'application/pdf');
    } catch (e) { if (e && e.name !== 'AbortError') toast('Não foi possível compartilhar: ' + e.message); }
  }

  // ------------------------------------------------------------------
  // Importação de registros
  // ------------------------------------------------------------------
  function parseImport(text, name) {
    if (/\.json$/i.test(name) || text.trim().startsWith('{')) {
      const j = JSON.parse(text);
      const raw = j.raw || j.samples;
      if (!Array.isArray(raw)) throw new Error('JSON sem campo "raw".');
      return raw.map((r) => Array.isArray(r) ? { t: r[0], ax: r[1], ay: r[2], az: r[3], gx: r[4] ?? undefined, gy: r[5] ?? undefined, gz: r[6] ?? undefined } : r);
    }
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const header = lines[0].split(/[,;\t]/).map((h) => h.trim().toLowerCase());
    const col = (names) => header.findIndex((h) => names.includes(h));
    const it = col(['t_s', 'timestamp', 't', 'time']), ix = col(['acc_x', 'ax']), iy = col(['acc_y', 'ay']), iz = col(['acc_z', 'az']);
    const gx = col(['gyro_x', 'gx']), gy = col(['gyro_y', 'gy']), gz = col(['gyro_z', 'gz']);
    if (it < 0 || ix < 0 || iy < 0 || iz < 0) throw new Error('CSV deve conter colunas t_s, acc_x, acc_y, acc_z.');
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(/[,;\t]/);
      const s = { t: parseFloat(c[it]), ax: parseFloat(c[ix]), ay: parseFloat(c[iy]), az: parseFloat(c[iz]) };
      if (gx >= 0) { s.gx = parseFloat(c[gx]); s.gy = parseFloat(c[gy]); s.gz = parseFloat(c[gz]); }
      out.push(s);
    }
    // timestamps em ms?
    if (out.length > 2 && out[out.length - 1].t - out[0].t > 1000) for (const s of out) s.t /= 1000;
    return out;
  }

  // ------------------------------------------------------------------
  // PWA
  // ------------------------------------------------------------------
  function setupPWA() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e)));
    }
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.deferredInstall = e; $('installBtn').classList.remove('hidden'); });
    $('installBtn').addEventListener('click', async () => {
      if (!state.deferredInstall) return;
      state.deferredInstall.prompt();
      await state.deferredInstall.userChoice;
      state.deferredInstall = null; $('installBtn').classList.add('hidden');
    });
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (isIOS && !standalone) $('iosInstallHint').classList.add('show');
  }

  // ------------------------------------------------------------------
  // Inicialização
  // ------------------------------------------------------------------
  function init() {
    setupSegmented('positionSeg', 'position');
    setupSegmented('durationSeg', 'duration');
    setupSegmented('delaySeg', 'delay');
    loadSettings();
    for (const id of ['personId', 'height', 'legLength', 'age', 'sex']) $(id).addEventListener('change', saveSettings);

    $('testBtn').addEventListener('click', testSensors);
    $('startBtn').addEventListener('click', startCollection);
    $('stopBtn').addEventListener('click', () => stopCollection(false));
    $('cancelBtn').addEventListener('click', () => stopCollection(true));
    $('demoBtn').addEventListener('click', () => {
      if (!$('height').value) $('height').value = 170;
      const opts = participantOpts();
      const sim = window.GaitAnalysis.simulate({ duration: Math.min(state.settings.duration, 60) + 3, stepTime: 0.56, stepCV: 0.025, vertExcursion: 0.036, asym: 0.02, turnAt: state.settings.duration >= 30 ? 16 : null, iosSign: false, seed: Date.now() % 1000 });
      runAnalysis(sim.samples, true);
      void opts;
    });
    $('importBtn').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try { const samples = parseImport(await file.text(), file.name); runAnalysis(samples, false); }
      catch (err) { toast('Importação falhou: ' + err.message, 4000); }
      e.target.value = '';
    });
    $('pdfBtn').addEventListener('click', exportPDF);
    $('shareBtn').addEventListener('click', sharePDF);
    $('csvResultsBtn').addEventListener('click', exportResultsCSV);
    $('csvStridesBtn').addEventListener('click', exportStridesCSV);
    $('csvRawBtn').addEventListener('click', exportRawCSV);
    $('jsonBtn').addEventListener('click', exportJSON);
    $('newBtn').addEventListener('click', () => { hideResults(); state.results = null; window.scrollTo({ top: 0, behavior: 'smooth' }); });

    // barra de navegação compacta ao rolar
    const nav = $('nav');
    window.addEventListener('scroll', () => nav.classList.toggle('scrolled', window.scrollY > 40), { passive: true });
    // recolore gráficos ao mudar o tema
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (state.results) renderCharts(state.results); });
    // sem sensores no desktop: informa
    if (typeof DeviceMotionEvent === 'undefined') { $('sensorState').textContent = 'indisponíveis'; $('sensorInfo').textContent = 'Este navegador não expõe sensores de movimento; use a demonstração ou importe um registro.'; }
    $('versionInfo').textContent = `Versão ${APP_VERSION} · núcleo de análise ${window.GaitAnalysis ? window.GaitAnalysis.VERSION : '?'}`;
    setupPWA();
    window.PassoDigital = { state, runAnalysis, buildPDF };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

/*
 * O Passo Digital — núcleo de análise de marcha (gait-analysis.js)
 * ------------------------------------------------------------------
 * Módulo puro (sem DOM) que implementa o pipeline de processamento de sinais
 * inerciais do tronco (região lombar, L3-L5) para extração de parâmetros
 * espaço-temporais e de qualidade da marcha.
 *
 * Fundamentação (ver README.md para revisão completa):
 *  - Correção de inclinação pelo vetor gravitacional médio: Moe-Nilssen (1998).
 *  - Detecção de contato inicial/final por transformada wavelet gaussiana
 *    (derivada de gaussiana, escala ~10 a 100 Hz): McCamley et al. (2012);
 *    validada em idosos e Parkinson por Del Din et al. (2016) e Pham et al. (2017).
 *  - Comprimento do passo pelo pêndulo invertido com fator de correção 1,25:
 *    Zijlstra & Hof (2003); Zijlstra (2004).
 *  - Harmonic ratio por passada (20 harmônicas): Menz, Lord & Fitzpatrick (2003).
 *  - Regularidade/simetria por autocorrelação não enviesada:
 *    Moe-Nilssen & Helbostad (2004).
 *  - Variabilidade (DP e CV) do tempo de passada: Hausdorff (2001, 2005).
 *  - Domínios da marcha (ritmo, variabilidade, assimetria, passo/pace,
 *    controle postural): Lord et al. (2013).
 *  - Detecção de curvas pela velocidade angular vertical: Pham et al. (2017).
 *  - Valores de referência: Bohannon & Williams Andrews (2011), Hollman (2011),
 *    Studenski (2011), Abellan van Kan (2009).
 *
 * O módulo funciona no navegador (window.GaitAnalysis) e em Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GaitAnalysis = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GA = { VERSION: '2.0.0', DEFAULT_FS: 100, G: 9.80665 };

  // ------------------------------------------------------------------
  // Estatística básica
  // ------------------------------------------------------------------
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
  const sd = (a) => {
    const n = a.length;
    if (n < 2) return NaN;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (n - 1));
  };
  const cv = (a) => (a.length >= 2 ? (100 * sd(a)) / mean(a) : NaN);
  const median = (a) => {
    if (!a.length) return NaN;
    const s = Array.from(a).sort((x, y) => x - y);
    const h = s.length >> 1;
    return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  };
  const mad = (a) => {
    const m = median(a);
    return median(a.map((v) => Math.abs(v - m)));
  };
  const percentile = (a, p) => {
    if (!a.length) return NaN;
    const s = Array.from(a).sort((x, y) => x - y);
    const idx = (p / 100) * (s.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
  };
  const rms = (a) => (a.length ? Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length) : NaN);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  GA.stats = { mean, sd, cv, median, mad, percentile, rms };

  // ------------------------------------------------------------------
  // Reamostragem para grade uniforme (interpolação linear)
  // ------------------------------------------------------------------
  /**
   * @param {Array<{t:number,ax:number,ay:number,az:number,gx?:number,gy?:number,gz?:number}>} samples
   *        t em segundos; ax..az = aceleração incluindo gravidade (m/s²);
   *        gx..gz = velocidade angular (graus/s) ou null.
   * @param {number} fs frequência alvo (Hz)
   */
  GA.resample = function (samples, fs) {
    fs = fs || GA.DEFAULT_FS;
    const clean = [];
    let last = -Infinity;
    for (const s of samples) {
      if (!s || !isNum(s.t) || !isNum(s.ax) || !isNum(s.ay) || !isNum(s.az)) continue;
      if (s.t > last) { clean.push(s); last = s.t; }
    }
    if (clean.length < 10) throw new Error('Amostras insuficientes para reamostragem.');
    const t0 = clean[0].t, t1 = clean[clean.length - 1].t;
    const n = Math.floor((t1 - t0) * fs) + 1;
    const t = new Float64Array(n);
    const keys = ['ax', 'ay', 'az', 'gx', 'gy', 'gz'];
    const out = {};
    for (const k of keys) out[k] = new Float64Array(n);
    const gyroCount = clean.reduce((c, s) => c + (isNum(s.gx) && isNum(s.gy) && isNum(s.gz) ? 1 : 0), 0);
    const hasGyro = gyroCount / clean.length > 0.9;

    let j = 0;
    for (let i = 0; i < n; i++) {
      const ti = t0 + i / fs;
      t[i] = ti - t0;
      while (j < clean.length - 2 && clean[j + 1].t < ti) j++;
      const a = clean[j], b = clean[Math.min(j + 1, clean.length - 1)];
      const span = b.t - a.t;
      const w = span > 0 ? clamp((ti - a.t) / span, 0, 1) : 0;
      for (const k of keys) {
        const va = isNum(a[k]) ? a[k] : 0, vb = isNum(b[k]) ? b[k] : 0;
        out[k][i] = va + (vb - va) * w;
      }
    }
    // qualidade da amostragem bruta
    const dts = [];
    for (let i = 1; i < clean.length; i++) dts.push(clean[i].t - clean[i - 1].t);
    const dtMed = median(dts);
    const dropouts = dts.filter((d) => d > 2.5 * dtMed).length;
    return {
      fs, n, t, ax: out.ax, ay: out.ay, az: out.az, gx: out.gx, gy: out.gy, gz: out.gz,
      hasGyro, fsRaw: 1 / dtMed, dropouts, rawCount: clean.length, duration: t1 - t0,
    };
  };

  // ------------------------------------------------------------------
  // Filtros Butterworth (seções de 2ª ordem, transformação bilinear) com
  // filtragem direta-reversa (fase zero). Ordem efetiva = 2 × ordem.
  // ------------------------------------------------------------------
  function biquad(type, fc, fs, Q) {
    const K = Math.tan((Math.PI * fc) / fs), K2 = K * K;
    const norm = 1 / (1 + K / Q + K2);
    let b0, b1, b2;
    if (type === 'lp') { b0 = K2 * norm; b1 = 2 * b0; b2 = b0; }
    else { b0 = norm; b1 = -2 * norm; b2 = norm; }
    return { b0, b1, b2, a1: 2 * (K2 - 1) * norm, a2: (1 - K / Q + K2) * norm };
  }
  function butterSections(order, type, fc, fs) {
    const secs = [];
    const nsec = Math.max(1, Math.round(order / 2));
    const N = nsec * 2;
    for (let k = 0; k < nsec; k++) {
      const theta = (Math.PI * (2 * k + 1)) / (2 * N);
      secs.push(biquad(type, fc, fs, 1 / (2 * Math.sin(theta))));
    }
    return secs;
  }
  function applyBiquad(x, c) {
    const y = new Float64Array(x.length);
    let z1 = 0, z2 = 0;
    for (let i = 0; i < x.length; i++) {
      const xi = x[i];
      const yi = c.b0 * xi + z1;
      z1 = c.b1 * xi - c.a1 * yi + z2;
      z2 = c.b2 * xi - c.a2 * yi;
      y[i] = yi;
    }
    return y;
  }
  function filtfilt(x, secs, pad) {
    const n = x.length;
    if (n < 4) return Float64Array.from(x);
    pad = Math.min(n - 1, Math.max(3, pad | 0));
    // extensão ímpar (reflexão) para reduzir transientes nas bordas
    const ext = new Float64Array(n + 2 * pad);
    for (let i = 0; i < pad; i++) ext[i] = 2 * x[0] - x[pad - i];
    for (let i = 0; i < n; i++) ext[pad + i] = x[i];
    for (let i = 0; i < pad; i++) ext[pad + n + i] = 2 * x[n - 1] - x[n - 2 - i];
    let y = ext;
    for (const c of secs) y = applyBiquad(y, c);
    y.reverse();
    for (const c of secs) y = applyBiquad(y, c);
    y.reverse();
    return y.slice(pad, pad + n);
  }
  /** Passa-baixas Butterworth fase zero. `order` = ordem de cada passagem (2 → efetiva 4). */
  GA.lowpass = function (x, fc, fs, order) {
    order = order || 2;
    if (fc >= fs / 2) return Float64Array.from(x);
    return filtfilt(x, butterSections(order, 'lp', fc, fs), Math.round((3 * fs) / fc));
  };
  GA.highpass = function (x, fc, fs, order) {
    order = order || 2;
    return filtfilt(x, butterSections(order, 'hp', fc, fs), Math.round((3 * fs) / fc));
  };
  GA.bandpass = function (x, flo, fhi, fs, order) {
    return GA.lowpass(GA.highpass(x, flo, fs, order), fhi, fs, order);
  };
  GA.detrend = function (x) {
    const m = mean(Array.from(x));
    return Float64Array.from(x, (v) => v - m);
  };

  // ------------------------------------------------------------------
  // Suavização e derivação gaussianas (equivalentes à CWT com wavelet
  // 'gaus1' usada por McCamley et al., 2012: derivada de gaussiana).
  // ------------------------------------------------------------------
  function convolveReflect(x, k) {
    const n = x.length, half = (k.length - 1) >> 1;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = -half; j <= half; j++) {
        let idx = i + j;
        if (idx < 0) idx = -idx;
        if (idx >= n) idx = 2 * n - 2 - idx;
        if (idx < 0) idx = 0;
        s += x[idx] * k[j + half];
      }
      y[i] = s;
    }
    return y;
  }
  GA.gaussSmooth = function (x, sigma) {
    const half = Math.max(1, Math.ceil(4 * sigma));
    const k = new Float64Array(2 * half + 1);
    let sum = 0;
    for (let j = -half; j <= half; j++) { k[j + half] = Math.exp((-j * j) / (2 * sigma * sigma)); sum += k[j + half]; }
    for (let j = 0; j < k.length; j++) k[j] /= sum;
    return convolveReflect(x, k);
  };
  /** Derivada suavizada (unidades por amostra × fs = por segundo). */
  GA.gaussDeriv = function (x, sigma, fs) {
    const half = Math.max(1, Math.ceil(4 * sigma));
    const k = new Float64Array(2 * half + 1);
    let norm = 0;
    for (let j = -half; j <= half; j++) {
      const g = Math.exp((-j * j) / (2 * sigma * sigma));
      k[j + half] = (-j / (sigma * sigma)) * g; // derivada da gaussiana
      norm += j * (j / (sigma * sigma)) * g;      // garante inclinação unitária para rampa
    }
    // convolução com núcleo de derivada: y[i] = Σ x[i+j]·k[j]; para rampa x=i → Σ (i+j)·k[j] = Σ j·k[j] = -norm
    for (let j = 0; j < k.length; j++) k[j] = -k[j] / norm;
    const y = convolveReflect(x, k);
    return fs ? Float64Array.from(y, (v) => v * fs) : y;
  };

  // ------------------------------------------------------------------
  // Integração e picos
  // ------------------------------------------------------------------
  GA.cumtrapz = function (x, fs) {
    const y = new Float64Array(x.length);
    const dt = 1 / fs;
    for (let i = 1; i < x.length; i++) y[i] = y[i - 1] + 0.5 * (x[i] + x[i - 1]) * dt;
    return y;
  };

  /** Máximos locais com proeminência topográfica. */
  GA.findPeaks = function (x, opts) {
    opts = opts || {};
    const n = x.length;
    const cands = [];
    for (let i = 1; i < n - 1; i++) {
      if (x[i] > x[i - 1] && x[i] >= x[i + 1]) {
        // proeminência: desce à esquerda/direita até encontrar ponto mais alto
        let leftMin = x[i], j = i - 1;
        while (j >= 0 && x[j] <= x[i]) { if (x[j] < leftMin) leftMin = x[j]; j--; }
        let rightMin = x[i]; j = i + 1;
        while (j < n && x[j] <= x[i]) { if (x[j] < rightMin) rightMin = x[j]; j++; }
        const prom = x[i] - Math.max(leftMin, rightMin);
        cands.push({ i, v: x[i], prom });
      }
    }
    let peaks = cands;
    if (isNum(opts.minProminence)) peaks = peaks.filter((p) => p.prom >= opts.minProminence);
    if (isNum(opts.minHeight)) peaks = peaks.filter((p) => p.v >= opts.minHeight);
    if (isNum(opts.minDistance) && opts.minDistance > 1) {
      // mantém os picos mais proeminentes respeitando a distância mínima
      const sorted = [...peaks].sort((a, b) => b.prom - a.prom);
      const keep = [];
      for (const p of sorted) {
        if (keep.every((q) => Math.abs(q.i - p.i) >= opts.minDistance)) keep.push(p);
      }
      peaks = keep.sort((a, b) => a.i - b.i);
    }
    return peaks;
  };

  /** Autocorrelação não enviesada normalizada (Moe-Nilssen & Helbostad, 2004). */
  GA.autocorr = function (x, maxLag) {
    const n = x.length;
    const m = mean(Array.from(x));
    const xc = Float64Array.from(x, (v) => v - m);
    maxLag = Math.min(maxLag || n - 1, n - 2);
    let c0 = 0;
    for (let i = 0; i < n; i++) c0 += xc[i] * xc[i];
    c0 /= n;
    const ac = new Float64Array(maxLag + 1);
    for (let lag = 0; lag <= maxLag; lag++) {
      let s = 0;
      for (let i = 0; i < n - lag; i++) s += xc[i] * xc[i + lag];
      ac[lag] = c0 > 0 ? s / (n - lag) / c0 : 0;
    }
    return ac;
  };

  // ------------------------------------------------------------------
  // Correção de inclinação → eixos anatômicos (V, AP, ML)
  // Moe-Nilssen (1998): a direção vertical é definida pelo vetor gravitacional
  // médio do trecho de marcha; as componentes horizontais são obtidas por
  // projeção ortogonal. Independe da convenção de sinal do navegador.
  // ------------------------------------------------------------------
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm3 = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => { const n = norm3(a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };

  GA.toAnatomicalFrame = function (rs, opts) {
    opts = opts || {};
    const n = rs.n;
    const gxm = mean(Array.from(rs.ax)), gym = mean(Array.from(rs.ay)), gzm = mean(Array.from(rs.az));
    const gMag = Math.hypot(gxm, gym, gzm);
    const V = unit([gxm, gym, gzm]);
    // AP: normal da tela (eixo z do aparelho) projetada no plano horizontal;
    // se o aparelho estiver deitado (z ≈ vertical), usa o eixo x como fallback.
    let apRef = [0, 0, 1];
    let AP = [apRef[0] - dot(apRef, V) * V[0], apRef[1] - dot(apRef, V) * V[1], apRef[2] - dot(apRef, V) * V[2]];
    if (norm3(AP) < 0.3) {
      apRef = [1, 0, 0];
      AP = [apRef[0] - dot(apRef, V) * V[0], apRef[1] - dot(apRef, V) * V[1], apRef[2] - dot(apRef, V) * V[2]];
    }
    AP = unit(AP);
    const ML = unit(cross(V, AP));
    const v = new Float64Array(n), ap = new Float64Array(n), ml = new Float64Array(n);
    const yaw = new Float64Array(n), pitch = new Float64Array(n), roll = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = [rs.ax[i] - gxm, rs.ay[i] - gym, rs.az[i] - gzm];
      v[i] = dot(a, V); ap[i] = dot(a, AP); ml[i] = dot(a, ML);
      if (rs.hasGyro) {
        const g = [rs.gx[i], rs.gy[i], rs.gz[i]];
        yaw[i] = dot(g, V); pitch[i] = dot(g, ML); roll[i] = dot(g, AP);
      }
    }
    // ângulo entre a vertical estimada e o eixo longo do aparelho (y): checagem de montagem
    const tiltFromY = (Math.acos(clamp(Math.abs(V[1]), 0, 1)) * 180) / Math.PI;
    return { v, ap, ml, yaw, pitch, roll, V, AP, ML, gMag, tiltFromY };
  };

  // ------------------------------------------------------------------
  // Detecção de eventos (McCamley et al., 2012)
  //   1) aceleração vertical → integração → derivada gaussiana (CWT gaus1)
  //      ≡ aceleração suavizada; contatos iniciais (IC) = máximos.
  //   2) nova derivada gaussiana; contatos finais (FC, retirada do pé
  //      contralateral) = mínimos do jerk suavizado logo após cada IC.
  // ------------------------------------------------------------------
  GA.detectEvents = function (v, fs, opts) {
    opts = opts || {};
    const sigma = (opts.sigmaSec || 0.07) * fs;
    const vlp = GA.detrend(fs > 50 ? GA.lowpass(v, 20, fs, 2) : v);
    // d/dt ∫ a ≡ a; a integração seguida da derivada gaussiana equivale à suavização gaussiana
    const vel = GA.cumtrapz(vlp, fs);
    const s1 = GA.gaussDeriv(vel, sigma, fs);        // aceleração suavizada (CWT 1)
    const s2 = GA.gaussDeriv(s1, sigma, fs);         // jerk suavizado (CWT 2)

    // período de passo esperado por autocorrelação (0,25–1,0 s)
    const ac = GA.autocorr(s1, Math.round(2.0 * fs));
    let stepLag = -1, best = -Infinity;
    for (let lag = Math.round(0.25 * fs); lag <= Math.round(1.0 * fs) && lag < ac.length; lag++) {
      if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > best) { best = ac[lag]; stepLag = lag; }
    }
    const stepPeriod = stepLag > 0 ? stepLag / fs : 0.55;

    const all = GA.findPeaks(s1, {});
    const proms = all.map((p) => p.prom);
    const p90 = percentile(proms, 90);
    const minProm = Math.max(0.15, 0.25 * p90);
    const peaks = GA.findPeaks(s1, { minProminence: minProm, minDistance: Math.round(Math.max(0.25, 0.55 * stepPeriod) * fs) });
    const ic = peaks.map((p) => p.i);

    // FC: mínimo de s2 (queda mais rápida da aceleração) entre IC+30 ms e IC+min(0,35 s, 70% do intervalo até o próximo IC)
    const fc = [];
    for (let k = 0; k < ic.length; k++) {
      const start = ic[k] + Math.round(0.03 * fs);
      const nextGap = k + 1 < ic.length ? ic[k + 1] - ic[k] : Math.round(stepPeriod * fs);
      const end = Math.min(s2.length - 1, ic[k] + Math.round(Math.min(0.35 * fs, 0.7 * nextGap)));
      let bi = -1, bv = Infinity;
      for (let i = start; i <= end; i++) if (s2[i] < bv) { bv = s2[i]; bi = i; }
      fc.push(bi);
    }
    return { ic, fc, s1, s2, stepPeriod, acStep: best, minProm };
  };

  // ------------------------------------------------------------------
  // Detecção de curvas (Pham et al., 2017; El-Gohary et al., 2014)
  // ------------------------------------------------------------------
  GA.detectTurns = function (yawDegPerS, fs, opts) {
    opts = opts || {};
    const thr = opts.threshold || 20;   // graus/s
    const minAngle = opts.minAngle || 45; // graus
    const y = GA.lowpass(GA.detrend(yawDegPerS), 1.5, fs, 2);
    const segs = [];
    let inSeg = false, start = 0;
    for (let i = 0; i < y.length; i++) {
      const on = Math.abs(y[i]) > thr;
      if (on && !inSeg) { inSeg = true; start = i; }
      if (!on && inSeg) { inSeg = false; segs.push([start, i]); }
    }
    if (inSeg) segs.push([start, y.length]);
    // une segmentos separados por < 0,5 s
    const merged = [];
    for (const s of segs) {
      if (merged.length && s[0] - merged[merged.length - 1][1] < 0.5 * fs) merged[merged.length - 1][1] = s[1];
      else merged.push(s.slice());
    }
    const turns = [];
    for (const [a, b] of merged) {
      let angle = 0;
      for (let i = a; i < b; i++) angle += y[i] / fs;
      if (Math.abs(angle) >= minAngle) turns.push({ start: a / fs, end: b / fs, angle, duration: (b - a) / fs, peakRate: Math.max(...Array.from(y.slice(a, b)).map(Math.abs)) });
    }
    return turns;
  };

  // ------------------------------------------------------------------
  // Harmonic ratio (Menz et al., 2003) — DFT direta nas 20 primeiras
  // harmônicas da frequência da passada (não exige N potência de 2).
  // ------------------------------------------------------------------
  GA.harmonicRatio = function (seg, axis) {
    const N = seg.length;
    if (N < 42) return NaN;
    const m = mean(Array.from(seg));
    let even = 0, odd = 0;
    for (let k = 1; k <= 20; k++) {
      let re = 0, im = 0;
      const w = (2 * Math.PI * k) / N;
      for (let n = 0; n < N; n++) { const x = seg[n] - m; re += x * Math.cos(w * n); im -= x * Math.sin(w * n); }
      const amp = Math.hypot(re, im);
      if (k % 2 === 0) even += amp; else odd += amp;
    }
    if (axis === 'ml') return even > 0 ? odd / even : NaN; // ML: 1 ciclo por passada → ímpares dominam
    return odd > 0 ? even / odd : NaN;                     // V e AP: 2 ciclos por passada → pares dominam
  };

  // ------------------------------------------------------------------
  // Valores de referência
  // ------------------------------------------------------------------
  // Velocidade confortável (cm/s) por sexo e década — Bohannon & Williams Andrews (2011)
  const SPEED_NORMS = {
    M: [[20, 29, 135.8, 10.8], [30, 39, 143.3, 12.0], [40, 49, 143.4, 15.2], [50, 59, 143.3, 16.0], [60, 69, 133.9, 15.6], [70, 79, 126.2, 20.3], [80, 99, 96.8, 24.5]],
    F: [[20, 29, 134.1, 12.6], [30, 39, 133.7, 14.9], [40, 49, 139.0, 15.8], [50, 59, 131.3, 20.0], [60, 69, 124.1, 21.6], [70, 79, 113.2, 24.6], [80, 99, 94.3, 23.7]],
  };
  GA.speedNorm = function (age, sex) {
    if (!isNum(age) || !SPEED_NORMS[sex]) return null;
    const rows = SPEED_NORMS[sex];
    const a = clamp(Math.round(age), 20, 99);
    for (const r of rows) if (a >= r[0] && a <= r[1]) return { lo: r[0], hi: r[1], mean: r[2] / 100, sd: r[3] / 100, sex };
    return null;
  };

  /**
   * Catálogo de métricas: id, rótulo, unidade, domínio (Lord 2013), faixa de referência
   * e função de classificação (ok | warn | alert | na).
   */
  GA.METRICS = [
    { id: 'gaitSpeed', label: 'Velocidade da marcha', unit: 'm/s', domain: 'Passo (pace)', digits: 2,
      ref: 'Ref.: por idade/sexo (Bohannon 2011); < 1,0 m/s = risco aumentado; < 0,8 m/s = vulnerabilidade (Studenski 2011; Abellan van Kan 2009)',
      flag: (v, ctx) => {
        if (!isNum(v)) return 'na';
        const nrm = GA.speedNorm(ctx.age, ctx.sex);
        if (v < 0.8) return 'alert';
        if (v < 1.0) return 'warn';
        if (nrm && v < nrm.mean - 1.5 * nrm.sd) return 'warn';
        return 'ok';
      } },
    { id: 'stepLength', label: 'Comprimento do passo', unit: 'm', domain: 'Passo (pace)', digits: 3,
      ref: 'Ref.: ≈ 0,60–0,80 m em adultos; ≈ 0,60–0,70 m após 70 anos (Hollman 2011)',
      flag: (v) => (!isNum(v) ? 'na' : v < 0.45 ? 'alert' : v < 0.55 ? 'warn' : 'ok') },
    { id: 'strideLength', label: 'Comprimento da passada', unit: 'm', domain: 'Passo (pace)', digits: 3,
      ref: 'Ref.: ≈ 1,20–1,60 m (Hollman 2011)',
      flag: (v) => (!isNum(v) ? 'na' : v < 0.9 ? 'alert' : v < 1.1 ? 'warn' : 'ok') },
    { id: 'stepLengthNorm', label: 'Comprimento do passo / altura', unit: '', domain: 'Passo (pace)', digits: 3,
      ref: 'Ref.: ≈ 0,38–0,45 (normalização pela estatura)',
      flag: (v) => (!isNum(v) ? 'na' : v < 0.3 ? 'alert' : v < 0.35 ? 'warn' : 'ok') },
    { id: 'cadence', label: 'Cadência', unit: 'passos/min', domain: 'Ritmo', digits: 1,
      ref: 'Ref.: ≈ 100–125 passos/min; idosos ≈ 105–115 (Hollman 2011)',
      flag: (v) => (!isNum(v) ? 'na' : v < 85 || v > 140 ? 'alert' : v < 95 || v > 130 ? 'warn' : 'ok') },
    { id: 'strideTime', label: 'Tempo da passada (ciclo)', unit: 's', domain: 'Ritmo', digits: 3,
      ref: 'Ref.: ≈ 1,00–1,20 s',
      flag: (v) => (!isNum(v) ? 'na' : v > 1.4 ? 'alert' : v > 1.25 || v < 0.9 ? 'warn' : 'ok') },
    { id: 'stepTime', label: 'Tempo do passo', unit: 's', domain: 'Ritmo', digits: 3,
      ref: 'Ref.: ≈ 0,50–0,60 s',
      flag: (v) => (!isNum(v) ? 'na' : v > 0.7 ? 'alert' : v > 0.63 || v < 0.45 ? 'warn' : 'ok') },
    { id: 'stanceTime', label: 'Tempo de apoio (exploratório)', unit: 's', domain: 'Ritmo', digits: 3,
      ref: 'Ref.: ≈ 60–62 % da passada', flag: () => 'na' },
    { id: 'swingTime', label: 'Tempo de balanço (exploratório)', unit: 's', domain: 'Ritmo', digits: 3,
      ref: 'Ref.: ≈ 38–40 % da passada', flag: () => 'na' },
    { id: 'doubleSupportPct', label: 'Duplo apoio (exploratório)', unit: '% da passada', domain: 'Ritmo', digits: 1,
      ref: 'Ref.: ≈ 18–26 % em adultos saudáveis; aumentado em Parkinson e idosos com medo de cair',
      flag: (v) => (!isNum(v) ? 'na' : v > 35 ? 'alert' : v > 28 ? 'warn' : 'ok') },
    { id: 'strideTimeCV', label: 'CV do tempo da passada', unit: '%', domain: 'Variabilidade', digits: 2,
      ref: 'Ref.: < 3 % em adultos saudáveis; > 4–5 % associa-se a quedas e doença neurológica (Hausdorff 2001, 2005)',
      flag: (v) => (!isNum(v) ? 'na' : v > 5 ? 'alert' : v > 3 ? 'warn' : 'ok') },
    { id: 'strideTimeSD', label: 'DP do tempo da passada', unit: 'ms', domain: 'Variabilidade', digits: 0,
      ref: 'Ref.: ≈ 49 ms em não caidores vs. ≈ 106 ms em caidores (Hausdorff 2001)',
      flag: (v) => (!isNum(v) ? 'na' : v > 90 ? 'alert' : v > 60 ? 'warn' : 'ok') },
    { id: 'stepTimeCV', label: 'CV do tempo do passo', unit: '%', domain: 'Variabilidade', digits: 2,
      ref: 'Ref.: < 4 %', flag: (v) => (!isNum(v) ? 'na' : v > 7 ? 'alert' : v > 4 ? 'warn' : 'ok') },
    { id: 'stepLengthCV', label: 'CV do comprimento do passo', unit: '%', domain: 'Variabilidade', digits: 2,
      ref: 'Ref.: < 5–6 % (Hollman 2011)', flag: (v) => (!isNum(v) ? 'na' : v > 10 ? 'alert' : v > 6 ? 'warn' : 'ok') },
    { id: 'stepTimeAsym', label: 'Assimetria do tempo do passo', unit: 'ms', domain: 'Assimetria', digits: 0,
      ref: 'Ref.: < 20–25 ms (diferença absoluta entre passos alternados; Del Din 2016)',
      flag: (v) => (!isNum(v) ? 'na' : v > 40 ? 'alert' : v > 25 ? 'warn' : 'ok') },
    { id: 'stepLengthAsym', label: 'Assimetria do comprimento do passo', unit: 'cm', domain: 'Assimetria', digits: 1,
      ref: 'Ref.: < 3–4 cm', flag: (v) => (!isNum(v) ? 'na' : v > 6 ? 'alert' : v > 4 ? 'warn' : 'ok') },
    { id: 'hrV', label: 'Harmonic ratio vertical', unit: '', domain: 'Controle postural', digits: 2,
      ref: 'Ref.: ≈ 2–4 em adultos saudáveis; reduzido em caidores e Parkinson (Menz 2003)',
      flag: (v) => (!isNum(v) ? 'na' : v < 1.5 ? 'alert' : v < 2.0 ? 'warn' : 'ok') },
    { id: 'hrAP', label: 'Harmonic ratio ântero-posterior', unit: '', domain: 'Controle postural', digits: 2,
      ref: 'Ref.: ≈ 2–4 em adultos saudáveis (Menz 2003)',
      flag: (v) => (!isNum(v) ? 'na' : v < 1.5 ? 'alert' : v < 2.0 ? 'warn' : 'ok') },
    { id: 'hrML', label: 'Harmonic ratio médio-lateral', unit: '', domain: 'Controle postural', digits: 2,
      ref: 'Ref.: ≈ 1,5–3 em adultos saudáveis (Menz 2003)',
      flag: (v) => (!isNum(v) ? 'na' : v < 1.2 ? 'alert' : v < 1.5 ? 'warn' : 'ok') },
    { id: 'stepRegularity', label: 'Regularidade do passo (Ad1, V)', unit: '', domain: 'Controle postural', digits: 3,
      ref: 'Ref.: > 0,80 (autocorrelação no lag de 1 passo; Moe-Nilssen & Helbostad 2004)',
      flag: (v) => (!isNum(v) ? 'na' : v < 0.6 ? 'alert' : v < 0.8 ? 'warn' : 'ok') },
    { id: 'strideRegularity', label: 'Regularidade da passada (Ad2, V)', unit: '', domain: 'Controle postural', digits: 3,
      ref: 'Ref.: > 0,85 (autocorrelação no lag de 1 passada)',
      flag: (v) => (!isNum(v) ? 'na' : v < 0.7 ? 'alert' : v < 0.85 ? 'warn' : 'ok') },
    { id: 'symmetryAC', label: 'Simetria (|Ad1 − Ad2|, V)', unit: '', domain: 'Assimetria', digits: 3,
      ref: 'Ref.: próximo de 0 (< 0,10)', flag: (v) => (!isNum(v) ? 'na' : v > 0.2 ? 'alert' : v > 0.1 ? 'warn' : 'ok') },
    { id: 'rmsV', label: 'RMS da aceleração vertical', unit: 'm/s²', domain: 'Controle postural', digits: 2,
      ref: 'Depende da velocidade (Moe-Nilssen 1998); útil para comparação intraindividual', flag: () => 'na' },
    { id: 'rmsAP', label: 'RMS da aceleração ântero-posterior', unit: 'm/s²', domain: 'Controle postural', digits: 2, ref: 'Idem', flag: () => 'na' },
    { id: 'rmsML', label: 'RMS da aceleração médio-lateral', unit: 'm/s²', domain: 'Controle postural', digits: 2,
      ref: 'Aumento relativo do RMS-ML sugere instabilidade lateral', flag: () => 'na' },
    { id: 'jerkRMS', label: 'Jerk RMS (3D)', unit: 'm/s³', domain: 'Suavidade', digits: 1,
      ref: 'Sem norma consolidada; valores maiores = movimento menos suave (uso longitudinal)', flag: () => 'na' },
    { id: 'jerkNorm', label: 'Jerk normalizado (RMS jerk × tempo da passada / RMS acel.)', unit: '', domain: 'Suavidade', digits: 2,
      ref: 'Adimensional; menor = mais suave', flag: () => 'na' },
    { id: 'distance', label: 'Distância estimada no trecho analisado', unit: 'm', domain: 'Sessão', digits: 1, ref: 'Soma dos comprimentos de passo válidos', flag: () => 'na' },
  ];
  const METRIC_BY_ID = Object.fromEntries(GA.METRICS.map((m) => [m.id, m]));
  GA.metric = (id) => METRIC_BY_ID[id];

  // ------------------------------------------------------------------
  // Análise principal
  // ------------------------------------------------------------------
  /**
   * @param {Array} samples amostras brutas (ver GA.resample)
   * @param {Object} opts { position:'lombar'|'bolso', heightCm, legLengthCm?, age?, sex?:'M'|'F', fs?, correctionFactor? }
   */
  GA.analyze = function (samples, opts) {
    opts = Object.assign({ position: 'lombar', fs: GA.DEFAULT_FS, correctionFactor: 1.25 }, opts || {});
    const warnings = [];
    const rs = GA.resample(samples, opts.fs);
    const fs = rs.fs;
    if (rs.duration < 8) throw new Error('Registro muito curto (< 8 s). Colete pelo menos 20 s de marcha.');
    if (rs.fsRaw < 25) warnings.push(`Frequência de amostragem bruta baixa (${rs.fsRaw.toFixed(1)} Hz).`);
    if (rs.dropouts > 0) warnings.push(`${rs.dropouts} interrupção(ões) de amostragem detectada(s) e interpolada(s).`);
    if (!rs.hasGyro) warnings.push('Giroscópio indisponível: curvas não foram detectadas automaticamente.');

    if (opts.position === 'bolso') return analyzePocket(rs, opts, warnings);
    return analyzeLumbar(rs, opts, warnings);
  };

  function analyzeLumbar(rs, opts, warnings) {
    const fs = rs.fs, n = rs.n;
    const frame = GA.toAnatomicalFrame(rs);
    if (frame.tiltFromY > 35) warnings.push(`Aparelho inclinado ${frame.tiltFromY.toFixed(0)}° em relação à vertical: verifique a fixação lombar.`);
    if (Math.abs(frame.gMag - GA.G) > 1.5) warnings.push(`Módulo médio da gravidade = ${frame.gMag.toFixed(2)} m/s² (esperado ≈ 9,81): possível erro de unidade do sensor.`);

    const v20 = GA.lowpass(GA.detrend(frame.v), 20, fs, 2);
    const ap20 = GA.lowpass(GA.detrend(frame.ap), 20, fs, 2);
    const ml20 = GA.lowpass(GA.detrend(frame.ml), 20, fs, 2);

    // eventos
    const ev = GA.detectEvents(frame.v, fs);
    const ic = ev.ic, fc = ev.fc;
    if (ic.length < 6) throw new Error(`Foram detectados apenas ${ic.length} contatos iniciais. Caminhe por mais tempo e verifique a fixação do aparelho.`);

    // curvas
    const turns = rs.hasGyro ? GA.detectTurns(frame.yaw, fs) : [];
    const inTurn = (tSec) => turns.some((tr) => tSec >= tr.start - 0.5 && tSec <= tr.end + 0.5);

    // deslocamento vertical (Zijlstra & Hof 2003): dupla integração com passa-altas 0,1 Hz após cada integração
    const velV = GA.highpass(GA.cumtrapz(v20, fs), 0.1, fs, 2);
    const posV = GA.highpass(GA.cumtrapz(velV, fs), 0.1, fs, 2);

    const heightM = isNum(opts.heightCm) ? opts.heightCm / 100 : NaN;
    const legLen = isNum(opts.legLengthCm) ? opts.legLengthCm / 100 : (isNum(heightM) ? 0.53 * heightM : NaN); // Winter (2009)
    const K = opts.correctionFactor;
    if (!isNum(legLen)) warnings.push('Estatura (ou comprimento da perna) não informada: comprimento do passo, velocidade e distância não foram calculados.');

    // passos
    const steps = [];
    for (let k = 0; k < ic.length - 1; k++) {
      const a = ic[k], b = ic[k + 1];
      const tA = a / fs, tB = b / fs;
      const dur = tB - tA;
      let seg = posV.slice(a, b + 1);
      let h = Math.max(...seg) - Math.min(...seg);
      let len = NaN;
      if (isNum(legLen) && h > 0 && 2 * legLen * h - h * h > 0) len = K * 2 * Math.sqrt(2 * legLen * h - h * h);
      const ds = fc[k] > a ? (fc[k] - a) / fs : NaN; // duplo apoio iniciado neste IC
      const step = { index: k, foot: k % 2 === 0 ? 'A' : 'B', tStart: tA, tEnd: tB, duration: dur, vertExcursion: h, length: len, doubleSupport: ds, valid: true, reason: '' };
      if (inTurn(tA) || inTurn(tB)) { step.valid = false; step.reason = 'curva'; }
      steps.push(step);
    }
    // exclusão de outliers de duração (mediana ± 3·MAD, e limites fisiológicos)
    const durs = steps.filter((s) => s.valid).map((s) => s.duration);
    const dMed = median(durs), dMad = Math.max(0.02, mad(durs));
    for (const s of steps) {
      if (!s.valid) continue;
      if (s.duration < 0.25 || s.duration > 2.0 || Math.abs(s.duration - dMed) > 3 * 1.4826 * dMad + 0.05) { s.valid = false; s.reason = 'duração atípica'; }
    }
    // passadas (IC_k → IC_k+2), válidas quando ambos os passos são válidos
    const strides = [];
    for (let k = 0; k < steps.length - 1; k++) {
      const s1 = steps[k], s2 = steps[k + 1];
      const a = ic[k], b = ic[k + 2];
      const valid = s1.valid && s2.valid;
      const stride = {
        index: k, foot: s1.foot, tStart: s1.tStart, tEnd: s2.tEnd, duration: s1.duration + s2.duration,
        length: isNum(s1.length) && isNum(s2.length) ? s1.length + s2.length : NaN,
        stepTimes: [s1.duration, s2.duration], valid, reason: valid ? '' : (s1.reason || s2.reason),
        hrV: NaN, hrAP: NaN, hrML: NaN, stance: NaN, swing: NaN, doubleSupportPct: NaN,
      };
      if (valid) {
        stride.hrV = GA.harmonicRatio(v20.slice(a, b), 'v');
        stride.hrAP = GA.harmonicRatio(ap20.slice(a, b), 'ap');
        stride.hrML = GA.harmonicRatio(ml20.slice(a, b), 'ml');
        // fases temporais (exploratório): apoio = IC_k → FC após IC_k+1; balanço = restante
        const fcOwn = fc[k + 1];
        if (fcOwn > ic[k + 1] && fcOwn < b) {
          const stance = (fcOwn - a) / fs, swing = (b - fcOwn) / fs;
          const dsTot = (isNum(s1.doubleSupport) ? s1.doubleSupport : 0) + (isNum(s2.doubleSupport) ? s2.doubleSupport : 0);
          const dsPct = (100 * dsTot) / stride.duration, swingPct = (100 * swing) / stride.duration;
          if (dsPct >= 8 && dsPct <= 45 && swingPct >= 25 && swingPct <= 50) { stride.stance = stance; stride.swing = swing; stride.doubleSupportPct = dsPct; }
        }
      }
      strides.push(stride);
    }
    const vSteps = steps.filter((s) => s.valid);
    const vStrides = strides.filter((s) => s.valid);
    if (vStrides.length < 3) throw new Error('Menos de 3 passadas válidas após exclusão de curvas e outliers. Repita a coleta em linha reta.');

    // ---- métricas
    const stepT = vSteps.map((s) => s.duration);
    const strideT = vStrides.map((s) => s.duration);
    const stepL = vSteps.map((s) => s.length).filter(isNum);
    const strideL = vStrides.map((s) => s.length).filter(isNum);
    const m = {};
    m.stepTime = mean(stepT);
    m.strideTime = mean(strideT);
    m.cadence = 60 / m.stepTime;
    m.strideTimeSD = 1000 * sd(strideT);
    m.strideTimeCV = cv(strideT);
    m.stepTimeCV = cv(stepT);
    m.stepLength = stepL.length ? mean(stepL) : NaN;
    m.strideLength = strideL.length ? mean(strideL) : NaN;
    m.stepLengthCV = stepL.length >= 3 ? cv(stepL) : NaN;
    m.stepLengthNorm = isNum(m.stepLength) && isNum(heightM) ? m.stepLength / heightM : NaN;
    m.gaitSpeed = isNum(m.strideLength) ? m.strideLength / m.strideTime : NaN;
    m.distance = stepL.length ? stepL.reduce((s, v) => s + v, 0) : NaN;
    // assimetria entre pés alternados (A/B; sem identificação de lado)
    const tA = vSteps.filter((s) => s.foot === 'A').map((s) => s.duration), tB = vSteps.filter((s) => s.foot === 'B').map((s) => s.duration);
    m.stepTimeAsym = tA.length && tB.length ? 1000 * Math.abs(mean(tA) - mean(tB)) : NaN;
    const lA = vSteps.filter((s) => s.foot === 'A' && isNum(s.length)).map((s) => s.length), lB = vSteps.filter((s) => s.foot === 'B' && isNum(s.length)).map((s) => s.length);
    m.stepLengthAsym = lA.length && lB.length ? 100 * Math.abs(mean(lA) - mean(lB)) : NaN;
    // fases
    const stance = vStrides.map((s) => s.stance).filter(isNum), swing = vStrides.map((s) => s.swing).filter(isNum), dsp = vStrides.map((s) => s.doubleSupportPct).filter(isNum);
    m.stanceTime = stance.length >= 3 ? mean(stance) : NaN;
    m.swingTime = swing.length >= 3 ? mean(swing) : NaN;
    m.doubleSupportPct = dsp.length >= 3 ? mean(dsp) : NaN;
    // harmonic ratio
    m.hrV = mean(vStrides.map((s) => s.hrV).filter(isNum));
    m.hrAP = mean(vStrides.map((s) => s.hrAP).filter(isNum));
    m.hrML = mean(vStrides.map((s) => s.hrML).filter(isNum));

    // trecho contínuo válido mais longo para autocorrelação/RMS/jerk
    const seg = longestValidSegment(vSteps, ic, fs, n);
    const vSeg = v20.slice(seg.a, seg.b), apSeg = ap20.slice(seg.a, seg.b), mlSeg = ml20.slice(seg.a, seg.b);
    const acV = GA.autocorr(vSeg, Math.round(2.5 * m.strideTime * fs));
    const acAP = GA.autocorr(apSeg, Math.round(2.5 * m.strideTime * fs));
    const pk = (ac, lagSec) => {
      const c = Math.round(lagSec * fs), w = Math.round(0.3 * lagSec * fs);
      let bi = -1, bv = -Infinity;
      for (let i = Math.max(1, c - w); i <= Math.min(ac.length - 2, c + w); i++) if (ac[i] > bv) { bv = ac[i]; bi = i; }
      return { lag: bi / fs, value: bv };
    };
    const ad1 = pk(acV, m.stepTime), ad2 = pk(acV, m.strideTime);
    m.stepRegularity = ad1.value; m.strideRegularity = ad2.value; m.symmetryAC = Math.abs(ad1.value - ad2.value);
    const ad1ap = pk(acAP, m.stepTime), ad2ap = pk(acAP, m.strideTime);
    m.stepRegularityAP = ad1ap.value; m.strideRegularityAP = ad2ap.value;
    m.rmsV = rms(Array.from(vSeg)); m.rmsAP = rms(Array.from(apSeg)); m.rmsML = rms(Array.from(mlSeg));
    // jerk (derivada da aceleração 3D filtrada a 20 Hz)
    const jV = GA.gaussDeriv(vSeg, 0.02 * fs, fs), jAP = GA.gaussDeriv(apSeg, 0.02 * fs, fs), jML = GA.gaussDeriv(mlSeg, 0.02 * fs, fs);
    const jerkMag = new Float64Array(vSeg.length);
    for (let i = 0; i < vSeg.length; i++) jerkMag[i] = Math.hypot(jV[i], jAP[i], jML[i]);
    m.jerkRMS = rms(Array.from(jerkMag));
    const accMag = new Float64Array(vSeg.length);
    for (let i = 0; i < vSeg.length; i++) accMag[i] = Math.hypot(vSeg[i], apSeg[i], mlSeg[i]);
    m.jerkNorm = (m.jerkRMS * m.strideTime) / rms(Array.from(accMag));

    // ---- resultado
    const analyzedStart = vSteps[0].tStart, analyzedEnd = vSteps[vSteps.length - 1].tEnd;
    const session = {
      position: 'lombar', fs, fsRaw: rs.fsRaw, rawSamples: rs.rawCount, dropouts: rs.dropouts, hasGyro: rs.hasGyro,
      recordingDuration: rs.duration, analyzedStart, analyzedEnd, analyzedDuration: vSteps.reduce((s, x) => s + x.duration, 0),
      icCount: ic.length, stepsTotal: steps.length, stepsValid: vSteps.length, stridesTotal: strides.length, stridesValid: vStrides.length,
      excludedTurn: steps.filter((s) => s.reason === 'curva').length, excludedOutlier: steps.filter((s) => s.reason === 'duração atípica').length,
      turns, tiltFromY: frame.tiltFromY, gMag: frame.gMag, legLengthM: legLen, heightM, correctionFactor: K,
      bouts: countBouts(steps), longestSegment: { start: seg.a / fs, end: seg.b / fs },
    };
    const results = { version: GA.VERSION, position: 'lombar', metrics: m, session, steps, strides, warnings,
      signals: { t: rs.t, v: v20, ap: ap20, ml: ml20, posV, s1: ev.s1, ic, fc, yaw: rs.hasGyro ? frame.yaw : null, autocorrV: acV } };
    results.flags = GA.flagMetrics(m, opts);
    results.report = GA.buildReport(results, opts);
    return results;
  }

  function longestValidSegment(vSteps, ic, fs, n) {
    let best = { a: 0, b: n }, bestLen = 0, cur = null;
    for (const s of vSteps) {
      const a = Math.round(s.tStart * fs), b = Math.round(s.tEnd * fs);
      if (cur && a <= cur.b + 1) cur.b = b; else cur = { a, b };
      if (cur.b - cur.a > bestLen) { bestLen = cur.b - cur.a; best = { a: cur.a, b: cur.b }; }
    }
    return best;
  }
  function countBouts(steps) {
    let bouts = 0, prev = false;
    for (const s of steps) { if (s.valid && !prev) bouts++; prev = s.valid; }
    return bouts;
  }

  // ------------------------------------------------------------------
  // Análise simplificada (bolso): magnitude do vetor de aceleração
  // (independente de orientação) → métricas temporais apenas.
  // ------------------------------------------------------------------
  function analyzePocket(rs, opts, warnings) {
    const fs = rs.fs, n = rs.n;
    const mag = new Float64Array(n);
    for (let i = 0; i < n; i++) mag[i] = Math.hypot(rs.ax[i], rs.ay[i], rs.az[i]);
    const sig = GA.bandpass(GA.detrend(mag), 0.5, 3.0, fs, 2);
    const s1 = GA.gaussSmooth(sig, 0.05 * fs);
    const ac = GA.autocorr(s1, Math.round(2 * fs));
    let stepLag = -1, best = -Infinity;
    for (let lag = Math.round(0.25 * fs); lag <= Math.round(1.0 * fs) && lag < ac.length - 1; lag++)
      if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1] && ac[lag] > best) { best = ac[lag]; stepLag = lag; }
    const stepPeriod = stepLag > 0 ? stepLag / fs : 0.55;
    const all = GA.findPeaks(s1, {});
    const p90 = percentile(all.map((p) => p.prom), 90);
    const peaks = GA.findPeaks(s1, { minProminence: Math.max(0.1, 0.25 * p90), minDistance: Math.round(Math.max(0.25, 0.55 * stepPeriod) * fs) });
    const ic = peaks.map((p) => p.i);
    if (ic.length < 6) throw new Error(`Apenas ${ic.length} passos detectados (modo bolso).`);
    const turns = rs.hasGyro ? GA.detectTurns(magnitudeYaw(rs), fs) : [];
    const inTurn = (t) => turns.some((tr) => t >= tr.start - 0.5 && t <= tr.end + 0.5);
    const steps = [];
    for (let k = 0; k < ic.length - 1; k++) {
      const st = { index: k, foot: k % 2 === 0 ? 'A' : 'B', tStart: ic[k] / fs, tEnd: ic[k + 1] / fs, duration: (ic[k + 1] - ic[k]) / fs, length: NaN, vertExcursion: NaN, doubleSupport: NaN, valid: true, reason: '' };
      if (inTurn(st.tStart) || inTurn(st.tEnd)) { st.valid = false; st.reason = 'curva'; }
      steps.push(st);
    }
    const durs = steps.filter((s) => s.valid).map((s) => s.duration);
    const dMed = median(durs), dMad = Math.max(0.02, mad(durs));
    for (const s of steps) if (s.valid && (s.duration < 0.25 || s.duration > 2.0 || Math.abs(s.duration - dMed) > 3 * 1.4826 * dMad + 0.05)) { s.valid = false; s.reason = 'duração atípica'; }
    const strides = [];
    for (let k = 0; k < steps.length - 1; k++) {
      const s1s = steps[k], s2s = steps[k + 1];
      strides.push({ index: k, foot: s1s.foot, tStart: s1s.tStart, tEnd: s2s.tEnd, duration: s1s.duration + s2s.duration, length: NaN, stepTimes: [s1s.duration, s2s.duration], valid: s1s.valid && s2s.valid, reason: s1s.reason || s2s.reason, hrV: NaN, hrAP: NaN, hrML: NaN, stance: NaN, swing: NaN, doubleSupportPct: NaN });
    }
    const vSteps = steps.filter((s) => s.valid), vStrides = strides.filter((s) => s.valid);
    if (vStrides.length < 3) throw new Error('Menos de 3 passadas válidas (modo bolso).');
    const m = {};
    const stepT = vSteps.map((s) => s.duration), strideT = vStrides.map((s) => s.duration);
    m.stepTime = mean(stepT); m.strideTime = mean(strideT); m.cadence = 60 / m.stepTime;
    m.strideTimeSD = 1000 * sd(strideT); m.strideTimeCV = cv(strideT); m.stepTimeCV = cv(stepT);
    const tA = vSteps.filter((s) => s.foot === 'A').map((s) => s.duration), tB = vSteps.filter((s) => s.foot === 'B').map((s) => s.duration);
    m.stepTimeAsym = tA.length && tB.length ? 1000 * Math.abs(mean(tA) - mean(tB)) : NaN;
    const seg = longestValidSegment(vSteps, ic, fs, n);
    const acSeg = GA.autocorr(s1.slice(seg.a, seg.b), Math.round(2.5 * m.strideTime * fs));
    const pk = (acx, lagSec) => { const c = Math.round(lagSec * fs), w = Math.round(0.3 * lagSec * fs); let bi = -1, bv = -Infinity; for (let i = Math.max(1, c - w); i <= Math.min(acx.length - 2, c + w); i++) if (acx[i] > bv) { bv = acx[i]; bi = i; } return { lag: bi / fs, value: bv }; };
    const ad1 = pk(acSeg, m.stepTime), ad2 = pk(acSeg, m.strideTime);
    m.stepRegularity = ad1.value; m.strideRegularity = ad2.value; m.symmetryAC = Math.abs(ad1.value - ad2.value);
    warnings.push('Modo bolso: apenas parâmetros temporais e de regularidade são válidos; métricas espaciais e de controle postural exigem fixação lombar.');
    const session = {
      position: 'bolso', fs, fsRaw: rs.fsRaw, rawSamples: rs.rawCount, dropouts: rs.dropouts, hasGyro: rs.hasGyro,
      recordingDuration: rs.duration, analyzedStart: vSteps[0].tStart, analyzedEnd: vSteps[vSteps.length - 1].tEnd, analyzedDuration: vSteps.reduce((s, x) => s + x.duration, 0),
      icCount: ic.length, stepsTotal: steps.length, stepsValid: vSteps.length, stridesTotal: strides.length, stridesValid: vStrides.length,
      excludedTurn: steps.filter((s) => s.reason === 'curva').length, excludedOutlier: steps.filter((s) => s.reason === 'duração atípica').length,
      turns, bouts: countBouts(steps), longestSegment: { start: seg.a / fs, end: seg.b / fs }, heightM: isNum(opts.heightCm) ? opts.heightCm / 100 : NaN,
    };
    const results = { version: GA.VERSION, position: 'bolso', metrics: m, session, steps, strides, warnings,
      signals: { t: rs.t, v: sig, ap: null, ml: null, posV: null, s1, ic, fc: [], yaw: null, autocorrV: acSeg } };
    results.flags = GA.flagMetrics(m, opts);
    results.report = GA.buildReport(results, opts);
    return results;
  }
  function magnitudeYaw(rs) {
    // sem eixo anatômico confiável no bolso: usa a componente do giroscópio alinhada à gravidade média
    const gxm = mean(Array.from(rs.ax)), gym = mean(Array.from(rs.ay)), gzm = mean(Array.from(rs.az));
    const V = unit([gxm, gym, gzm]);
    const y = new Float64Array(rs.n);
    for (let i = 0; i < rs.n; i++) y[i] = rs.gx[i] * V[0] + rs.gy[i] * V[1] + rs.gz[i] * V[2];
    return y;
  }

  // ------------------------------------------------------------------
  // Classificação e relatório
  // ------------------------------------------------------------------
  GA.flagMetrics = function (m, ctx) {
    const flags = {};
    for (const def of GA.METRICS) flags[def.id] = isNum(m[def.id]) ? def.flag(m[def.id], ctx || {}) : 'na';
    return flags;
  };

  GA.formatPT = function (v, digits) {
    if (!isNum(v)) return '—';
    return v.toFixed(isNum(digits) ? digits : 2).replace('.', ',');
  };
  const fmt = GA.formatPT;
  const fmtTime = (s) => {
    if (!isNum(s)) return '—';
    const mm = Math.floor(s / 60), ss = s - mm * 60;
    return mm > 0 ? `${mm} min ${ss.toFixed(1).replace('.', ',')} s` : `${ss.toFixed(1).replace('.', ',')} s`;
  };

  /** Produz um relatório estruturado (títulos, parágrafos, tabelas) em português. */
  GA.buildReport = function (res, ctx) {
    ctx = ctx || {};
    const m = res.metrics, s = res.session, f = res.flags;
    const sections = [];
    const pocket = res.position === 'bolso';

    // 1. Período avaliado
    const p1 = [];
    p1.push(`Registro de ${fmtTime(s.recordingDuration)} com ${s.rawSamples} amostras brutas (≈ ${fmt(s.fsRaw, 0)} Hz), reamostradas a ${s.fs} Hz. ` +
      `Posição do sensor: ${pocket ? 'bolso da calça (análise simplificada)' : 'região lombar (L5)'}.`);
    p1.push(`Período de marcha analisado: de ${fmtTime(s.analyzedStart)} a ${fmtTime(s.analyzedEnd)} do registro, totalizando ${fmtTime(s.analyzedDuration)} de marcha válida ` +
      `em ${s.bouts} trecho(s) contínuo(s). Foram identificados ${s.icCount} contatos iniciais, ${s.stepsValid} passos válidos de ${s.stepsTotal} e ${s.stridesValid} passadas válidas de ${s.stridesTotal}.`);
    const excl = [];
    if (s.excludedTurn) excl.push(`${s.excludedTurn} passo(s) durante ${s.turns.length} curva(s) (≥ 45°)`);
    if (s.excludedOutlier) excl.push(`${s.excludedOutlier} passo(s) com duração atípica`);
    p1.push(excl.length ? `Excluídos da análise: ${excl.join(' e ')}.` : (s.hasGyro ? 'Nenhuma curva ou passo atípico foi excluído.' : 'Nenhum passo atípico foi excluído (curvas não avaliadas: giroscópio indisponível).'));
    if (isNum(m.distance)) p1.push(`Distância estimada percorrida nos passos válidos: ${fmt(m.distance, 1)} m.`);
    if (!pocket) p1.push(`Inclinação do aparelho em relação à vertical: ${fmt(s.tiltFromY, 0)}°. Comprimento de perna usado no modelo: ${fmt(s.legLengthM, 3)} m${isNum(ctx.legLengthCm) ? ' (medido)' : ' (0,53 × estatura)'}; fator de correção ${fmt(s.correctionFactor, 2)}.`);
    sections.push({ title: 'Período de marcha avaliado', paragraphs: p1 });

    // 2. Síntese por domínio
    const domains = ['Passo (pace)', 'Ritmo', 'Variabilidade', 'Assimetria', 'Controle postural', 'Suavidade'];
    const rows = [];
    for (const d of domains) {
      for (const def of GA.METRICS) {
        if (def.domain !== d) continue;
        if (!isNum(m[def.id])) continue;
        rows.push({ domain: d, id: def.id, label: def.label, value: fmt(m[def.id], def.digits), unit: def.unit, ref: def.ref, flag: f[def.id] });
      }
    }
    sections.push({ title: 'Parâmetros por domínio da marcha (Lord et al., 2013)', table: rows });

    // 3. Interpretação automática
    const interp = [];
    const nrm = GA.speedNorm(ctx.age, ctx.sex);
    if (isNum(m.gaitSpeed)) {
      let t = `Velocidade da marcha de ${fmt(m.gaitSpeed, 2)} m/s`;
      if (nrm) {
        const z = (m.gaitSpeed - nrm.mean) / nrm.sd;
        t += ` (referência para ${ctx.sex === 'F' ? 'mulheres' : 'homens'} de ${nrm.lo}–${nrm.hi} anos: ${fmt(nrm.mean, 2)} ± ${fmt(nrm.sd, 2)} m/s; z = ${fmt(z, 1)})`;
      }
      if (m.gaitSpeed < 0.8) t += '. Valor abaixo de 0,8 m/s, faixa associada a maior risco de desfechos adversos (dependência, quedas, institucionalização, mortalidade).';
      else if (m.gaitSpeed < 1.0) t += '. Valor entre 0,8 e 1,0 m/s: abaixo da faixa considerada indicativa de envelhecimento saudável (≥ 1,0 m/s).';
      else t += ', dentro da faixa esperada.';
      interp.push(t);
    }
    if (isNum(m.cadence)) interp.push(`Cadência de ${fmt(m.cadence, 1)} passos/min e tempo de passada de ${fmt(m.strideTime, 3)} s${f.cadence === 'ok' ? ', compatíveis com ritmo normal.' : f.cadence === 'warn' ? ', discretamente fora da faixa habitual.' : ', claramente fora da faixa habitual.'}`);
    if (isNum(m.strideTimeCV)) interp.push(`Variabilidade do tempo de passada: CV = ${fmt(m.strideTimeCV, 2)} % (DP = ${fmt(m.strideTimeSD, 0)} ms)${f.strideTimeCV === 'ok' ? ', dentro do esperado (< 3 %).' : f.strideTimeCV === 'warn' ? ', discretamente aumentada; variabilidade > 3 % associa-se a menor estabilidade da marcha.' : ', acentuadamente aumentada, achado associado a risco de quedas e disfunção do controle rítmico da marcha (p. ex., parkinsonismo, ataxia, comprometimento cognitivo).'}`);
    if (isNum(m.stepTimeAsym)) interp.push(`Assimetria do tempo do passo de ${fmt(m.stepTimeAsym, 0)} ms entre os pés alternados${f.stepTimeAsym === 'ok' ? ' (simétrica).' : f.stepTimeAsym === 'warn' ? ' (assimetria leve; correlacionar clinicamente).' : ' (assimetria relevante, sugerindo comprometimento unilateral).'}`);
    if (isNum(m.stepLength)) interp.push(`Comprimento do passo de ${fmt(m.stepLength, 2)} m (${fmt(100 * m.stepLengthNorm, 0)} % da estatura)${f.stepLength === 'ok' ? ', dentro do esperado.' : ' — reduzido; passos curtos são típicos de marcha cautelosa, parkinsoniana ou de fraqueza.'}`);
    if (isNum(m.hrV)) interp.push(`Harmonic ratio (V ${fmt(m.hrV, 2)}; AP ${fmt(m.hrAP, 2)}; ML ${fmt(m.hrML, 2)})${(f.hrV === 'ok' && f.hrAP === 'ok') ? ' indica padrão rítmico e suave das acelerações do tronco.' : ' reduzido, sugerindo menor suavidade/simetria das acelerações do tronco, achado associado a maior risco de quedas.'}`);
    if (isNum(m.strideRegularity)) interp.push(`Regularidade da passada (Ad2) = ${fmt(m.strideRegularity, 3)} e do passo (Ad1) = ${fmt(m.stepRegularity, 3)}${f.strideRegularity === 'ok' ? ' (padrão regular).' : ' (regularidade reduzida).'}`);
    if (isNum(m.doubleSupportPct)) interp.push(`Duplo apoio estimado em ${fmt(m.doubleSupportPct, 1)} % da passada (estimativa exploratória a partir dos contatos finais)${f.doubleSupportPct === 'ok' ? '.' : ', aumentado; o prolongamento do duplo apoio é típico de marcha cautelosa e parkinsoniana.'}`);
    const alerts = Object.entries(f).filter(([, v]) => v === 'alert').length, warns = Object.entries(f).filter(([, v]) => v === 'warn').length;
    interp.push(alerts === 0 && warns === 0 ? 'Síntese: todos os parâmetros classificáveis encontram-se dentro das faixas de referência.' : `Síntese: ${alerts} parâmetro(s) fora da faixa de referência e ${warns} limítrofe(s). Os achados devem ser interpretados no contexto clínico e não constituem diagnóstico.`);
    sections.push({ title: 'Interpretação automática', paragraphs: interp });

    // 4. Qualidade e limitações
    const q = [];
    if (res.warnings.length) q.push(...res.warnings);
    q.push('Os contatos iniciais foram detectados pelo método de McCamley et al. (2012); a acurácia típica é de ± 20 ms. Comprimentos e velocidade derivam do modelo do pêndulo invertido (Zijlstra & Hof, 2003), cujo erro típico é de 5–10 %. Curvas, paradas e trechos irregulares foram excluídos automaticamente quando detectáveis.');
    q.push('Este relatório é um instrumento complementar de avaliação quantitativa e não substitui a avaliação clínica nem a análise laboratorial 3D.');
    sections.push({ title: 'Qualidade do registro e limitações', paragraphs: q });

    return { generatedAt: new Date().toISOString(), sections };
  };

  // ------------------------------------------------------------------
  // Simulador de marcha (demonstração e testes)
  // ------------------------------------------------------------------
  /**
   * Gera amostras sintéticas de um sensor lombar (aparelho em retrato, tela para fora):
   * eixo y do aparelho ≈ vertical, z ≈ ântero-posterior, x ≈ médio-lateral.
   */
  GA.simulate = function (p) {
    p = Object.assign({ duration: 30, stepTime: 0.55, stepCV: 0.02, vertExcursion: 0.035, fsRaw: 60, jitter: 0.15,
      noise: 0.15, asym: 0.0, iosSign: false, tilt: 8, turnAt: null, turnDuration: 2.0, seed: 1, withGyro: true }, p || {});
    let seed = p.seed >>> 0 || 1;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const randn = () => { const u = Math.max(1e-12, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    // instantes de IC
    const ics = [0.8];
    while (ics[ics.length - 1] < p.duration - 0.8) {
      const k = ics.length;
      const T = p.stepTime * (1 + p.stepCV * randn()) * (1 + (k % 2 === 0 ? p.asym : -p.asym));
      ics.push(ics[ics.length - 1] + T);
    }
    const A = p.vertExcursion / 2; // amplitude do deslocamento vertical (pico a pico = vertExcursion)
    const samples = [];
    const dtNom = 1 / p.fsRaw;
    let t = 0, k = 0;
    const tiltRad = (p.tilt * Math.PI) / 180;
    const g = GA.G;
    while (t < p.duration) {
      while (k < ics.length - 1 && t >= ics[k + 1]) k++;
      let av = 0, aap = 0, aml = 0, yaw = 0;
      if (t >= ics[0] && t < ics[ics.length - 1]) {
        const T = ics[k + 1] - ics[k];
        const ph = (t - ics[k]) / T; // fase do passo 0..1
        const w = (2 * Math.PI) / T;
        // deslocamento vertical z = -A cos(2π·ph) → aceleração = A·w²·cos(2π·ph) (máximo no IC)
        av = A * w * w * Math.cos(2 * Math.PI * ph);
        // transiente de impacto no IC: pulso bifásico (impulso líquido nulo, como um choque real)
        const dtIC = ph * T - 0.02, sIC = 0.015;
        av += 3.0 * (-(dtIC / sIC)) * Math.exp(-(dtIC * dtIC) / (2 * sIC * sIC));
        // AP: aceleração de frenagem/propulsão, 2 ciclos por passada + assimetria por pé
        const strideSign = k % 2 === 0 ? 1 : -1;
        aap = 1.2 * Math.sin(2 * Math.PI * ph + 0.4) + 0.3 * strideSign * Math.sin(2 * Math.PI * ph);
        // ML: 1 ciclo por passada (alterna sinal por pé)
        aml = 0.8 * strideSign * Math.sin(Math.PI * ph);
      } else {
        av = 0; aap = 0; aml = 0; // parado
      }
      if (p.turnAt !== null && t >= p.turnAt && t < p.turnAt + p.turnDuration) yaw = 90 / p.turnDuration; // giro de 90°
      av += p.noise * randn(); aap += p.noise * randn(); aml += p.noise * randn();
      // frame do aparelho: y = V (up) inclinado por tilt em torno de x, z = AP (para trás)
      const ct = Math.cos(tiltRad), st = Math.sin(tiltRad);
      const worldUp = [0, 1, 0];
      // aceleração total (dinâmica + reação à gravidade, convenção W3C: parado → +g para cima)
      const aw = [aml, av + g, -aap];
      const upDev = [0, ct, st]; // eixo y do aparelho no mundo
      const zDev = [0, -st, ct];
      const xDev = [1, 0, 0];
      let ax = dot(aw, xDev), ay = dot(aw, upDev), az = dot(aw, zDev);
      const gyro = { gx: 0.3 * randn() + 20 * av * 0.05, gy: dot([0, yaw, 0], upDev) + 0.5 * randn(), gz: dot([0, yaw, 0], zDev) + 0.5 * randn() };
      if (p.iosSign) { ax = -ax; ay = -ay; az = -az; }
      const smp = { t, ax, ay, az };
      if (p.withGyro) { smp.gx = gyro.gx; smp.gy = gyro.gy; smp.gz = gyro.gz; }
      samples.push(smp);
      t += dtNom * (1 + p.jitter * (rnd() - 0.5));
      void worldUp;
    }
    return { samples, ics, params: p };
  };

  return GA;
});

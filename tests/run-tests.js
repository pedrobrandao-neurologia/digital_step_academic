/* Testes do núcleo de análise com sinais sintéticos (node tests/run-tests.js) */
const GA = require('../gait-analysis.js');

let failures = 0, passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}${detail ? '  (' + detail + ')' : ''}`); }
  else { failures++; console.log(`  ✗ ${name}${detail ? '  (' + detail + ')' : ''}`); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------- filtros
console.log('Filtros');
{
  const fs = 100, n = 2000;
  const t = Array.from({ length: n }, (_, i) => i / fs);
  const x = t.map((ti) => Math.sin(2 * Math.PI * 1 * ti) + Math.sin(2 * Math.PI * 30 * ti));
  const y = GA.lowpass(x, 10, fs, 2);
  const err = GA.stats.rms(Array.from(y).slice(200, 1800).map((v, i) => v - Math.sin(2 * Math.PI * 1 * t[i + 200])));
  check('passa-baixas remove 30 Hz e preserva 1 Hz', err < 0.03, `erro RMS ${err.toFixed(4)}`);
  const hp = GA.highpass(x.map((v, i) => v + 5 + 0.2 * t[i]), 0.5, fs, 2);
  const m = GA.stats.mean(Array.from(hp).slice(300, 1700));
  check('passa-altas remove tendência/DC', Math.abs(m) < 0.05, `média ${m.toFixed(4)}`);
  // derivada gaussiana: rampa de inclinação 3 → derivada 3
  const ramp = Float64Array.from({ length: 500 }, (_, i) => 3 * i / fs);
  const d = GA.gaussDeriv(ramp, 7, fs);
  check('derivada gaussiana normalizada', near(d[250], 3, 0.01), `d=${d[250].toFixed(4)}`);
}

// ---------- harmonic ratio
console.log('Harmonic ratio');
{
  const N = 110;
  const seg = Float64Array.from({ length: N }, (_, n) => Math.cos(2 * Math.PI * 2 * n / N) + 0.2 * Math.cos(2 * Math.PI * 1 * n / N));
  const hr = GA.harmonicRatio(seg, 'v');
  check('HR-V = pares/ímpares (1/0,2 = 5)', near(hr, 5, 0.05), `HR=${hr.toFixed(3)}`);
  const hrml = GA.harmonicRatio(seg, 'ml');
  check('HR-ML = ímpares/pares (0,2)', near(hrml, 0.2, 0.01), `HR=${hrml.toFixed(3)}`);
}

// ---------- autocorrelação
console.log('Autocorrelação');
{
  const fs = 100;
  const x = Float64Array.from({ length: 3000 }, (_, i) => Math.sin(2 * Math.PI * i / 110));
  const ac = GA.autocorr(x, 300);
  check('lag 0 = 1', near(ac[0], 1, 1e-9));
  check('pico no período (110 amostras) ≈ 1', near(ac[110], 1, 0.01), `ac=${ac[110].toFixed(3)}`);
  void fs;
}

// ---------- pipeline completo
function runSim(label, p, expect) {
  console.log(`Pipeline: ${label}`);
  const sim = GA.simulate(p);
  const res = GA.analyze(sim.samples, Object.assign({ position: 'lombar', heightCm: 175, age: 45, sex: 'M' }, expect.opts || {}));
  const m = res.metrics, s = res.session;
  // IC timing
  const fs = res.session.fs;
  const icT = res.signals.ic.map((i) => i / fs);
  const trueICs = sim.ics.slice(1, -1); // exclui IC inicial/final (transições parado↔marcha)
  let matched = 0, errs = [];
  for (const tt of trueICs) {
    let best = Infinity;
    for (const d of icT) best = Math.min(best, Math.abs(d - tt));
    if (best < 0.1) { matched++; errs.push(best); }
  }
  const lagMean = GA.stats.mean(errs), lagSD = GA.stats.sd(errs);
  check('todos os IC verdadeiros detectados', matched === trueICs.length && Math.abs(icT.length - trueICs.length) <= 2, `${matched}/${trueICs.length}, detectados ${icT.length}`);
  check('erro de tempo do IC consistente (DP < 15 ms)', lagSD < 0.015, `viés ${(1000 * lagMean).toFixed(0)} ms, DP ${(1000 * lagSD).toFixed(1)} ms`);
  const expStride = 2 * p.stepTime;
  check('tempo de passada', near(m.strideTime, expStride, 0.02), `${m.strideTime.toFixed(3)} vs ${expStride.toFixed(3)}`);
  check('cadência', near(m.cadence, 60 / p.stepTime, 3), `${m.cadence.toFixed(1)} vs ${(60 / p.stepTime).toFixed(1)}`);
  if (expect.cv !== undefined) check('CV do tempo de passada plausível', near(m.strideTimeCV, expect.cv, expect.cvTol || 1.5), `${m.strideTimeCV.toFixed(2)} % (esperado ≈ ${expect.cv})`);
  if (expect.stepLength !== undefined) check('comprimento do passo (pêndulo invertido)', near(m.stepLength, expect.stepLength, expect.stepTol || 0.08), `${m.stepLength.toFixed(3)} vs ${expect.stepLength.toFixed(3)}`);
  check(`HR vertical > ${expect.hrV || 2.5}`, m.hrV > (expect.hrV || 2.5), `HR-V=${m.hrV.toFixed(2)}`);
  check('HR ML plausível (1 ciclo por passada)', m.hrML > 1.0, `HR-ML=${m.hrML.toFixed(2)}`);
  check(`regularidade da passada > ${expect.reg || 0.8}`, m.strideRegularity > (expect.reg || 0.8), `Ad2=${m.strideRegularity.toFixed(3)}`);
  if (expect.turn) check('curva detectada e passos excluídos', s.turns.length === 1 && s.excludedTurn > 0, `curvas=${s.turns.length}, excluídos=${s.excludedTurn}`);
  else check('nenhuma curva detectada', s.turns.length === 0, `curvas=${s.turns.length}`);
  if (expect.asym !== undefined) check('assimetria do tempo do passo', near(m.stepTimeAsym, expect.asym, 25), `${m.stepTimeAsym.toFixed(0)} ms vs ${expect.asym}`);
  check('relatório gerado com 4 seções', res.report.sections.length === 4);
  check('bandeiras calculadas', res.flags.gaitSpeed !== undefined);
  return res;
}

const leg = 0.53 * 1.75;
const h = 0.035;
const expLen = 1.25 * 2 * Math.sqrt(2 * leg * h - h * h);

runSim('marcha regular 30 s (Android, 60 Hz)', { duration: 30, stepTime: 0.55, stepCV: 0.02, vertExcursion: h, seed: 3 }, { cv: 2.0 / Math.SQRT2, cvTol: 0.6, stepLength: expLen, stepTol: 0.05 });
runSim('marcha lenta e variável (iOS, sinal invertido, 100 Hz)', { duration: 40, stepTime: 0.7, stepCV: 0.06, vertExcursion: 0.02, iosSign: true, fsRaw: 100, seed: 7 }, { cv: 6 / Math.SQRT2, cvTol: 1.2, stepLength: 1.25 * 2 * Math.sqrt(2 * leg * 0.02 - 0.02 ** 2), stepTol: 0.05, reg: 0.7 });
runSim('marcha com curva de 90° no meio', { duration: 40, stepTime: 0.55, stepCV: 0.02, vertExcursion: h, turnAt: 18, seed: 11 }, { turn: true, stepLength: expLen, stepTol: 0.05 });
runSim('marcha assimétrica (±6 %)', { duration: 30, stepTime: 0.55, stepCV: 0.015, vertExcursion: h, asym: 0.06, seed: 5 }, { asym: 2 * 0.06 * 550, hrV: 1.5 });
runSim('sem giroscópio', { duration: 25, stepTime: 0.5, stepCV: 0.02, vertExcursion: h, withGyro: false, seed: 9 }, { stepLength: expLen, stepTol: 0.05 });

// ---------- bolso
console.log('Pipeline: modo bolso');
{
  const sim = GA.simulate({ duration: 25, stepTime: 0.55, stepCV: 0.02, vertExcursion: h, seed: 21, tilt: 40 });
  const res = GA.analyze(sim.samples, { position: 'bolso', heightCm: 170 });
  check('cadência no modo bolso', near(res.metrics.cadence, 60 / 0.55, 4), `${res.metrics.cadence.toFixed(1)}`);
  check('sem métricas espaciais no modo bolso', res.metrics.stepLength === undefined);
  check('aviso de modo simplificado', res.warnings.some((w) => /bolso/i.test(w)));
}

// ---------- erros esperados
console.log('Erros esperados');
{
  let threw = false;
  try { GA.analyze(GA.simulate({ duration: 5 }).samples, { heightCm: 170 }); } catch (e) { threw = /curto/.test(e.message); }
  check('registro curto gera erro claro', threw);
}

console.log(`\n${passed} verificações OK, ${failures} falha(s)`);
process.exit(failures ? 1 : 0);

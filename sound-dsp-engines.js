// 音程変更・速度変更エンジン(Worker/Node共通・DOM非依存)。ブラウザ内だけで処理し、外部へは何も送らない。
//   engine  : "auto"(音の種類に合う最適な方式) | "wsola" | "pv" | "soundtouch2"(調整版) | "soundtouch"(従来と同じ設定)
//   quality : "fast" | "standard" | "high"      material: "auto" | "voice" | "instrument" | "bgm" | "sfx"
// 構成: 時間伸縮(WSOLA または 位相ボコーダー) → 音程は伸縮後に高品質リサンプリングで変える
//       (長さ = 元の長さ / tempo、音程 = 2^(semitones/12) 倍)。詳細は docs/sound-quality.md を参照。
import { SoundTouch } from "./soundtouch.js";

/* ---------------- SoundTouch(従来エンジン。params未指定=従来と同じ設定) ---------------- */
function soundtouchRender(channels, sampleRate, { tempo = 1, semitones = 0 }, P = {}, progress = () => {}) {
  const { seq = 0, seek = 0, overlap = 8, quick = true, pre = 0 } = P;
  if (pre > 0) { // 先頭に無音の助走を足して処理し、その分を後で捨てる(立ち上がりがクロスフェードで消えるのを防ぐ)
    const pad = Math.round(sampleRate * pre / 1000), padded = channels.map((c) => { const a = new Float32Array(c.length + pad); a.set(c, pad); return a; });
    const trim = Math.round(pad / tempo), full = soundtouchRender(padded, sampleRate, { tempo, semitones }, { ...P, pre: 0, _len: Math.max(1, Math.round(channels[0].length / tempo)) + trim }, progress);
    return full.map((c) => c.slice(trim, trim + Math.max(1, Math.round(channels[0].length / tempo))));
  }
  const length = channels[0].length, outputLength = P._len || Math.max(1, Math.round(length / tempo));
  const output = channels.map(() => new Float32Array(outputLength));
  const engine = new SoundTouch();
  engine.stretch.setParameters(sampleRate, seq, seek, overlap);
  engine.stretch.quickSeek = quick;
  engine.tempo = tempo; engine.pitchSemitones = semitones;
  const B = 8192, block = new Float32Array(B * 2), ex = new Float32Array(B * 2);
  let pos = 0, written = 0;
  while (written < outputLength) {
    block.fill(0);
    const av = Math.min(B, Math.max(0, length - pos));
    for (let i = 0; i < av; i++) { block[i*2] = channels[0][pos+i]; block[i*2+1] = (channels[1]||channels[0])[pos+i]; }
    engine.inputBuffer.putSamples(block, 0, B); engine.process(); pos += B;
    while (engine.outputBuffer.frameCount && written < outputLength) {
      const n = Math.min(B, engine.outputBuffer.frameCount, outputLength - written);
      engine.outputBuffer.receiveSamples(ex, n);
      for (let i = 0; i < n; i++) { output[0][written+i] = ex[i*2]; if (output[1]) output[1][written+i] = ex[i*2+1]; }
      written += n;
    }
    progress(Math.min(1, written / outputLength));
    if (pos > length + sampleRate * 4 && written < outputLength) throw Error("flush");
  }
  return output;
}

/* ---------------- FFT(基数2) ---------------- */
const plans = new Map();
function plan(n) {
  let p = plans.get(n); if (p) return p;
  const rev = new Uint32Array(n), bits = Math.log2(n) | 0;
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
  p = { n, rev, cos, sin }; plans.set(n, p); return p;
}
function fft(re, im, inv) {
  const { n, rev, cos, sin } = plan(re.length);
  for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  const sg = inv ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let s = 0; s < n; s += size)
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const wr = cos[w], wi = sg * sin[w], a = s + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
      }
  }
}

/* ---------------- 高品質リサンプラー(Kaiser窓sinc・ポリフェーズ) ----------------
   出力[n] = 入力(n*rate)。rate>1 は高い音(折り返し防止のローパス付き)。 */
function bessel0(x) { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / (2 * k)) ** 2; s += t; if (t < 1e-12 * s) break; } return s; }
const sincTables = new Map();
function sincTable(L, fc, NP, beta) {
  const key = [L, fc.toFixed(5), NP, beta].join();
  let T = sincTables.get(key); if (T) return T;
  const half = Math.ceil(L / fc), taps = 2 * half, tab = new Float32Array((NP + 1) * taps), i0 = bessel0(beta);
  for (let ph = 0; ph <= NP; ph++) {
    const frac = ph / NP; let sum = 0;
    for (let j = 0; j < taps; j++) {
      const t = j - half + 1 - frac, x = t * fc, a = t / half;
      const s = Math.abs(x) < 1e-9 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = Math.abs(a) >= 1 ? 0 : bessel0(beta * Math.sqrt(1 - a * a)) / i0;
      const v = s * w; tab[ph * taps + j] = v; sum += v;
    }
    for (let j = 0; j < taps; j++) tab[ph * taps + j] /= sum;
  }
  T = { tab, taps, half, NP }; sincTables.set(key, T); return T;
}
export function resample(chs, rate, Lz = 16, outLen) {
  if (Math.abs(rate - 1) < 1e-9) return chs.map((c) => Float32Array.from(c));
  const n = chs[0].length, m = outLen ?? Math.max(1, Math.floor(n / rate));
  const fc = Math.min(1, 1 / rate) * 0.965, NP = 512, T = sincTable(Lz, fc, NP, 9);
  const { tab, taps, half } = T;
  return chs.map((x) => {
    const out = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      const pos = i * rate, i0 = Math.floor(pos), fr = (pos - i0) * NP, ph = Math.floor(fr), w1 = fr - ph;
      const b0 = ph * taps, b1 = b0 + taps; let acc = 0;
      let s = i0 - half + 1;
      if (s >= 0 && s + taps <= n) { for (let j = 0; j < taps; j++) acc += x[s + j] * (tab[b0 + j] * (1 - w1) + tab[b1 + j] * w1); }
      else for (let j = 0; j < taps; j++) { const k = s + j; if (k >= 0 && k < n) acc += x[k] * (tab[b0 + j] * (1 - w1) + tab[b1 + j] * w1); }
      out[i] = acc;
    }
    return out;
  });
}

/* ---------------- オンセット検出 ---------------- */
export function detectOnsets(chs, sr, sens = 1) {
  const n = chs[0].length, N = 512, hop = 128; if (n < N * 3) return [];
  const re = new Float64Array(N), im = new Float64Array(N), win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const F = Math.floor((n - N) / hop), flux = new Float64Array(F), prev = new Float64Array(N / 2);
  const kmax = Math.min(N / 2, Math.floor((12000 / sr) * N)), kmin = Math.floor((150 / sr) * N);
  for (let f = 0; f < F; f++) {
    const o = f * hop; for (let i = 0; i < N; i++) { let v = chs[0][o + i]; if (chs.length > 1) v = 0.5 * (v + chs[1][o + i]); re[i] = v * win[i]; im[i] = 0; }
    fft(re, im, false); let s = 0;
    for (let k = kmin; k < kmax; k++) { const a = Math.log1p(60 * Math.hypot(re[k], im[k])); const d = a - prev[k]; if (d > 0) s += d * (1 + k / 40); prev[k] = a; }
    flux[f] = s;
  }
  // 適応しきい値(局所中央値の倍率)
  const out = [], W = 20, mx = Math.max(...flux) || 1;
  for (let f = 2; f < F - 2; f++) {
    if (!(flux[f] >= flux[f - 1] && flux[f] > flux[f + 1] && flux[f] >= flux[f - 2] && flux[f] >= flux[f + 2])) continue;
    const a = Math.max(0, f - W), b = Math.min(F, f + W), loc = Array.from(flux.subarray(a, b)).sort((x, y) => x - y), med = loc[loc.length >> 1];
    if (flux[f] > (1.9 / sens) * med + 0.12 * mx / sens && flux[f] > 0.06 * mx) out.push(f);
  }
  // 時間領域で立ち上がり位置を精密化
  const res = []; const sm = Math.max(1, Math.round(sr * 0.0005)); let last = -1e9;
  for (const f of out) {
    const c = f * hop + N / 2, a = Math.max(0, c - N), b = Math.min(n, c + N / 2); let pk = 0;
    const env = new Float32Array(b - a); let acc = 0;
    for (let i = a; i < b; i++) { let v = Math.abs(chs[0][i]); if (chs.length > 1) v = Math.max(v, Math.abs(chs[1][i])); env[i - a] = v; }
    const e2 = new Float32Array(b - a); for (let i = 0; i < env.length; i++) { acc = 0; const lo = Math.max(0, i - sm), hi = Math.min(env.length, i + sm + 1); for (let j = lo; j < hi; j++) acc += env[j]; e2[i] = acc / (hi - lo); if (e2[i] > pk) pk = e2[i]; }
    let pos = c; for (let i = 0; i < e2.length; i++) if (e2[i] >= 0.25 * pk) { pos = a + i; break; }
    // さらに遡って立ち上がり開始
    let j = pos - a; while (j > 0 && e2[j - 1] < e2[j] && e2[j - 1] > 0.04 * pk) j--; pos = a + j;
    if (pos - last >= sr * 0.05) { res.push(pos); last = pos; }
  }
  return res;
}

/* ---------------- WSOLA(L/R同時探索・粗密2段探索) ---------------- */
function wsolaSlice(x, S, P, sr) {
  const C = x.length, n = x[0].length, outLen = Math.max(1, Math.round(n * S));
  const out = x.map(() => new Float32Array(outLen));
  let Hs = Math.round((P.hop * sr) / 1000), O = Math.round((P.ov * sr) / 1000), Dl = Math.round((P.dl * sr) / 1000);
  const D = P.dec;
  // 短い素材: 窓を縮める
  const lim = Math.floor((n - 8) / 3); if (Hs + O > lim) { const k = lim / (Hs + O); Hs = Math.max(16, Math.floor(Hs * k)); O = Math.max(8, Math.min(Hs, Math.floor(O * k))); Dl = Math.max(4, Math.floor(Dl * k)); }
  O = Math.min(O, Hs); const W = Hs + O;
  if (n < W + 16 || n < 64) { // 極端に短い: 先頭を保ったまま、末尾を保持/切り詰め
    for (let c = 0; c < C; c++) { const o = out[c]; for (let i = 0; i < outLen; i++) o[i] = x[c][Math.min(n - 1, Math.round(i / S))] ; } return out;
  }
  // 粗探索用: D点平均(箱型LPF)。エネルギー累積は全域で作る
  const lp = x.map((c) => { const a = new Float32Array(n); let s = 0; for (let i = 0; i < n; i++) { s += c[i]; if (i >= D) s -= c[i - D]; a[i] = s / D; } return a; });
  // lp[i] は x[i-D+1..i] の平均 → 位置合わせのため D/2 ずらして扱う(全候補共通なので相対比較に影響なし)
  const cum = new Float64Array(n + 1); for (let i = 0; i < n; i++) { let e = 0; for (let c = 0; c < C; c++) e += lp[c][i] * lp[c][i]; cum[i + 1] = cum[i] + e; }
  const win = new Float32Array(O); for (let j = 0; j < O; j++) win[j] = 0.5 - 0.5 * Math.cos((Math.PI * (j + 0.5)) / O);
  const wref = new Float32Array(O); for (let j = 0; j < O; j++) wref[j] = Math.sin((Math.PI * (j + 0.5)) / O) ** 0.5 + 0.2; // 中央重視(両端に最小重み)
  const maxP = n - W;
  // フレーム0: そのままコピー(立ち上がりを保つ)
  let k = 0; const first = Math.min(Hs, outLen);
  for (let c = 0; c < C; c++) out[c].set(x[c].subarray(0, first), 0);
  const ref = x.map((a) => Float32Array.from(a.subarray(Hs, Hs + O))), fr = x.map(() => new Float32Array(W));
  let refPos = Hs; // 直前フレームの「自然な続き」の位置(粗探索用の整数位置)
  const bias = P.bias ?? 0.02;
  const ncc = (q) => { let dot = 0, en = 1e-9; for (let c = 0; c < C; c++) { const a = x[c], r = ref[c]; for (let j = 0; j < O; j++) { const v = a[q + j]; dot += wref[j] * r[j] * v; en += v * v; } } return dot / Math.sqrt(en); };
  while (true) {
    k++; const o0 = k * Hs; if (o0 >= outLen) break;
    const tau = Math.round((k * Hs) / S);
    let best = Math.min(maxP, Math.max(0, tau)), frac = 0;
    if (refPos + O <= n && Dl > 0) {
      const lo = Math.max(0, tau - Dl), hi = Math.min(maxP, tau + Dl);
      if (hi >= lo) {
        // 粗探索(D点平均の信号で、D刻みに探す)
        let bc = -1e30, bp = Math.min(Math.max(tau, lo), hi);
        const nd = Math.floor(O / D), rn = Math.sqrt(cum[Math.min(n, refPos + O)] - cum[refPos] + 1e-9);
        for (let q = lo; q <= hi; q += D) {
          let dot = 0;
          for (let c = 0; c < C; c++) { const a = lp[c]; for (let j = 0; j < nd; j++) dot += wref[j * D] * a[refPos + j * D] * a[q + j * D]; }
          const en = cum[Math.min(n, q + O)] - cum[q] + 1e-9;
          const sc = dot / Math.sqrt(en) - bias * (Math.abs(q - tau) / Dl) * rn * 0.3;
          if (sc > bc) { bc = sc; bp = q; }
        }
        // 精密探索(全サンプル) + 放物線補間で小数サンプル位置を求める
        const fl = Math.max(lo, bp - D), fh = Math.min(hi, bp + D); let fb = -1e30; best = bp;
        const sc = new Float64Array(fh - fl + 1);
        for (let q = fl; q <= fh; q++) { const v = ncc(q); sc[q - fl] = v; if (v > fb) { fb = v; best = q; } }
        if (P.sub !== false && best > fl && best < fh) {
          const a1 = sc[best - fl - 1], b1 = sc[best - fl], c1 = sc[best - fl + 1], d = a1 - 2 * b1 + c1;
          if (d < 0) frac = Math.max(-0.5, Math.min(0.5, (0.5 * (a1 - c1)) / d));
        }
      }
    }
    best = Math.min(best, maxP);
    // フレームを取り出す(小数位置は3次補間)
    const ip = Math.floor(best + frac), t = best + frac - ip;
    for (let c = 0; c < C; c++) {
      const a = x[c], f = fr[c];
      if (Math.abs(t) < 0.03 || Math.abs(t - 1) < 0.03) { const s0 = Math.round(best + frac); for (let j = 0; j < W; j++) f[j] = a[Math.min(n - 1, Math.max(0, s0 + j))]; }
      else for (let j = 0; j < W; j++) {
        const i = ip + j, y0 = a[Math.max(0, i - 1)], y1 = a[Math.min(n - 1, Math.max(0, i))], y2 = a[Math.min(n - 1, i + 1)], y3 = a[Math.min(n - 1, i + 2)];
        f[j] = y1 + 0.5 * t * (y2 - y0 + t * (2 * y0 - 5 * y1 + 4 * y2 - y3 + t * (3 * (y1 - y2) + y3 - y0)));
      }
      const o = out[c], r = ref[c];
      for (let j = 0; j < O && o0 + j < outLen; j++) o[o0 + j] = r[j] * (1 - win[j]) + f[j] * win[j];
      for (let j = O; j < Hs && o0 + j < outLen; j++) o[o0 + j] = f[j];
      r.set(f.subarray(Hs, Hs + O));
    }
    refPos = Math.round(best + frac) + Hs;
  }
  return out;
}
const SEG_PRE_MS = 2.5;
export function wsolaStretch(chs, sr, S, P, onsetsOn = true, onsetSens = 1, progress = () => {}) {
  const n = chs[0].length, outLen = Math.max(1, Math.round(n * S));
  if (Math.abs(S - 1) < 1e-9) return chs.map((c) => Float32Array.from(c));
  const pre = Math.round((SEG_PRE_MS * sr) / 1000), minSeg = Math.round(sr * 0.05);
  let bounds = [0];
  if (onsetsOn) for (const o of detectOnsets(chs, sr, onsetSens)) { const b = Math.max(0, o - pre); if (b - bounds[bounds.length - 1] >= minSeg && n - b >= minSeg) bounds.push(b); }
  bounds.push(n);
  const out = chs.map(() => new Float32Array(outLen)); const fade = Math.round(sr * 0.0007);
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i], b = bounds[i + 1], oa = Math.round(a * S), ob = i + 2 < bounds.length ? Math.round(b * S) : outLen;
    const seg = chs.map((c) => c.subarray(a, b)); const w = wsolaSlice(seg, (ob - oa) / (b - a), P, sr);
    for (let c = 0; c < chs.length; c++) {
      const s = w[c], dst = out[c];
      if (i > 0) for (let j = 0; j < fade && j < s.length; j++) s[j] *= j / fade;
      if (i + 2 < bounds.length) for (let j = 0; j < fade && j < s.length; j++) s[s.length - 1 - j] *= j / fade;
      for (let j = 0; j < s.length && oa + j < outLen; j++) dst[oa + j] += s[j];
    }
    progress((i + 1) / (bounds.length - 1));
  }
  return out;
}

/* ---------------- 位相ボコーダー(位相ロック付き・L/R位相関係を保持) ---------------- */
export function pvStretch(chs, sr, S, P, progress = () => {}) {
  const n = chs[0].length, C = chs.length, N = P.fft, Hs = N / 4, m = Math.max(1, Math.round(n * S));
  if (Math.abs(S - 1) < 1e-9) return chs.map((c) => Float32Array.from(c));
  const K = Math.ceil(m / Hs) + 2, half = N / 2, win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const out = chs.map(() => new Float64Array(m + 2 * N)), wsum = new Float64Array(m + 2 * N);
  const zr = new Float64Array(N), zi = new Float64Array(N);
  const Lr = new Float64Array(half + 1), Li = new Float64Array(half + 1), Rr = new Float64Array(half + 1), Ri = new Float64Array(half + 1);
  const phiPrev = new Float64Array(half + 1), psiPrev = new Float64Array(half + 1), phi = new Float64Array(half + 1), mag = new Float64Array(half + 1), psi = new Float64Array(half + 1);
  const peaks = new Int32Array(half + 1); const th = new Float64Array(half + 1);
  let prevStart = null;
  const L = chs[0], R = chs[1] || chs[0], twoPi = 2 * Math.PI;
  for (let k = 0; k < K; k++) {
    const center = Math.round((k * Hs) / S), st = center - half;
    for (let i = 0; i < N; i++) { const q = st + i; const w = win[i]; zr[i] = q >= 0 && q < n ? L[q] * w : 0; zi[i] = C > 1 ? (q >= 0 && q < n ? R[q] * w : 0) : 0; }
    fft(zr, zi, false);
    for (let b = 0; b <= half; b++) {
      const b2 = (N - b) & (N - 1), ar = zr[b], ai = zi[b], cr = zr[b2], ci = -zi[b2];
      Lr[b] = 0.5 * (ar + cr); Li[b] = 0.5 * (ai + ci);
      const dr = ar - cr, di = ai - ci; Rr[b] = 0.5 * di; Ri[b] = -0.5 * dr; // (Z - conj(Z'))/(2j)
      if (C === 1) { Rr[b] = Lr[b]; Ri[b] = Li[b]; }
      const mr = Lr[b] + Rr[b], mi = Li[b] + Ri[b]; mag[b] = Math.hypot(mr, mi); phi[b] = Math.atan2(mi, mr);
    }
    const hopAct = prevStart === null ? Hs / S : st - prevStart; prevStart = st;
    // ピーク検出
    let np = 0, mxm = 0; for (let b = 0; b <= half; b++) if (mag[b] > mxm) mxm = mag[b];
    for (let b = 2; b < half - 1; b++) { const v = mag[b]; if (v > 1e-5 * mxm && v > mag[b - 1] && v >= mag[b + 1] && v > mag[b - 2] && v >= mag[b + 2]) peaks[np++] = b; }
    if (k === 0 || np === 0) { for (let b = 0; b <= half; b++) psi[b] = phi[b]; }
    else {
      for (let q = 0; q < np; q++) {
        const b = peaks[q], dph = phi[b] - phiPrev[b] - (twoPi * b * hopAct) / N; const wr = dph - twoPi * Math.round(dph / twoPi);
        const omega = (twoPi * b) / N + wr / hopAct; const ps = psiPrev[b] + omega * Hs;
        const lo = q === 0 ? 0 : (peaks[q - 1] + b + 1) >> 1, hi = q === np - 1 ? half : (b + peaks[q + 1]) >> 1;
        for (let j = lo; j <= hi; j++) psi[j] = ps + (phi[j] - phi[b]);
      }
    }
    for (let b = 0; b <= half; b++) { phiPrev[b] = phi[b]; psiPrev[b] = psi[b]; th[b] = psi[b] - phi[b]; }
    // 回転して逆変換(2ch同時: L + jR)
    for (let b = 0; b <= half; b++) {
      const c = Math.cos(th[b]), s = Math.sin(th[b]);
      const lr = Lr[b] * c - Li[b] * s, li = Lr[b] * s + Li[b] * c, rr = Rr[b] * c - Ri[b] * s, ri = Rr[b] * s + Ri[b] * c;
      zr[b] = lr - ri; zi[b] = li + rr; // L + jR
      if (b > 0 && b < half) { zr[N - b] = lr + ri; zi[N - b] = -li + rr; }
    }
    fft(zr, zi, true);
    const o0 = k * Hs - half + N; // 先頭にN分の余白
    for (let i = 0; i < N; i++) { const w = win[i], idx = o0 + i; if (idx < 0 || idx >= m + 2 * N) continue; out[0][idx] += zr[i] / N * w; if (C > 1) out[1][idx] += zi[i] / N * w; wsum[idx] += w * w; }
    if ((k & 63) === 0) progress(k / K);
  }
  return out.map((o) => { const r = new Float32Array(m); for (let i = 0; i < m; i++) { const w = wsum[i + N]; r[i] = w > 1e-3 ? o[i + N] / w : 0; } return r; });
}


/* ---------------- 位相ボコーダー用: 立ち上がり部分を元の波形で置き換え(アタックの鮮明さを保つ) ---------------- */
function patchOnsets(out, chs, S, onsets, sr, opt = {}) {
  const pre = Math.round(((opt.pre ?? 2.5) * sr) / 1000), post = Math.round(((opt.post ?? 35) * sr) / 1000), fade = Math.round(((opt.fade ?? 3) * sr) / 1000);
  const n = chs[0].length, m = out[0].length;
  for (const t of onsets) {
    const o = Math.round(t * S), a = t - pre, b = t + post, oa = o - pre;
    if (a < 0 || b > n || oa < 0 || oa + post + pre > m) continue;
    for (let c = 0; c < out.length; c++) {
      const dst = out[c], s = chs[c];
      // 直前(プリエコー)を弱める: 立ち上がり前 fade*3 の範囲を滑らかに下げる
      const duck = fade * 4;
      for (let j = 0; j < duck; j++) { const i = oa - fade - j - 1; if (i >= 0) dst[i] *= 1 - 0.85 * (1 - j / duck) ** 1.5; }
      for (let j = 0; j < pre + post; j++) {
        let w = 1; if (j < fade) w = j / fade; else if (j > pre + post - fade) w = (pre + post - j) / fade;
        dst[oa + j] = dst[oa + j] * (1 - w) + s[a + j] * w;
      }
    }
  }
  return out;
}

/* ---------------- 音の種類の自動判定(声 / 楽器 / BGM / 効果音) ---------------- */
export function classify(chs, sr) {
  const n = chs[0].length, dur = n / sr;
  if (dur < 1.2) return "sfx";
  // 11kHz前後へ間引いた自己相関で「単音の周期性(声・単旋律)」を測る
  const D = Math.max(1, Math.round(sr / 11025)), sr2 = sr / D, m = Math.floor(n / D), x = new Float32Array(m);
  for (let i = 0; i < m; i++) { let s = 0; for (let c = 0; c < chs.length; c++) for (let k = 0; k < D; k++) s += chs[c][i * D + k]; x[i] = s / (D * chs.length); }
  const w = Math.round(sr2 * 0.04), hop = Math.round(sr2 * 0.02), lo = Math.round(sr2 / 500), hi = Math.round(sr2 / 70);
  let pk = 0; for (let i = 0; i < m; i++) pk = Math.max(pk, Math.abs(x[i]));
  let frames = 0, voiced = 0, act = 0; const f0s = [];
  for (let i = 0; i + w < m; i += hop) {
    let e = 0; for (let j = 0; j < w; j++) e += x[i + j] * x[i + j];
    frames++; if (Math.sqrt(e / w) < 0.04 * pk) continue; act++;
    let best = 0, bl = 0;
    for (let l = lo; l <= hi; l++) { let a = 0, b = 0; for (let j = 0; j + l < w; j++) { a += x[i + j] * x[i + j + l]; b += x[i + j + l] * x[i + j + l]; } const r = a / Math.sqrt(e * b + 1e-12); if (r > best) { best = r; bl = l; } }
    if (best > 0.7) { voiced++; f0s.push(sr2 / bl); }
  }
  const vf = act ? voiced / act : 0, silence = 1 - act / Math.max(1, frames);
  let dev = 0; if (f0s.length > 4) { const d = []; for (let i = 1; i < f0s.length; i++) d.push(Math.abs(1200 * Math.log2(f0s[i] / f0s[i - 1]))); d.sort((a, b) => a - b); dev = d[d.length >> 1]; }
  if (vf < 0.4) return "bgm";
  return dev > 10 || silence > 0.12 ? "voice" : "instrument";
}

/* ---------------- 設定表 ---------------- */
export const QUALITY = {
  fast: { dec: 8, L: 8, fft: 1024, dlK: 0.75 },
  standard: { dec: 4, L: 16, fft: 2048, dlK: 1 },
  high: { dec: 2, L: 32, fft: 4096, dlK: 1 },
};
// WSOLAの窓(ms): hop=フレーム間隔, ov=つなぎ目の重なり, dl=探索幅(±)
export const MATERIAL = {
  voice: { engine: "wsola", hop: 14, ov: 14, dl: 8, onsets: true },
  instrument: { engine: "wsola", hop: 24, ov: 24, dl: 12, onsets: true },
  bgm: { engine: "wsola", hop: 36, ov: 36, dl: 20, onsets: true },
  sfx: { engine: "wsola", hop: 8, ov: 8, dl: 8, onsets: true },
};
// SoundTouch調整版: 比較テストで選んだ値(シーケンス60ms/探索窓15ms/重なり8ms/全探索/先頭に無音の助走20ms)
export const ST2 = { seq: 60, seek: 15, overlap: 8, quick: false, pre: 20 };
export function render(channels, sr, opts = {}, progress = () => {}) {
  const { tempo = 1, semitones = 0, engine = "auto", quality = "standard" } = opts;
  const material = !opts.material || opts.material === "auto" ? classify(channels, sr) : opts.material;
  const n = channels[0].length, outLen = Math.max(1, Math.round(n / tempo)), p = 2 ** (semitones / 12);
  if (engine === "soundtouch") return soundtouchRender(channels, sr, { tempo, semitones }, opts.stParams || {}, progress); // 従来の設定そのまま
  if (engine === "soundtouch2") return soundtouchRender(channels, sr, { tempo, semitones }, opts.stParams || { ...ST2, quick: quality === "fast" }, progress); // 調整版
  const Q = QUALITY[quality] || QUALITY.standard, M = { ...(MATERIAL[material] || MATERIAL.bgm), ...(opts.params || {}) };
  for (const k of ["hop", "ov", "dl", "bias", "sens", "onsets", "fft", "sub"]) if (opts[k] !== undefined) M[k] = opts[k];
  const eng = engine === "auto" ? M.engine : engine, S = p / tempo;
  let y;
  if (Math.abs(S - 1) < 1e-9) y = channels.map((c) => Float32Array.from(c));
  else if (eng === "pv") {
    y = pvStretch(channels, sr, S, { fft: M.fft || Q.fft }, progress);
    if (M.patch !== false) y = patchOnsets(y, channels, S, detectOnsets(channels, sr, M.sens || 1), sr, M.patchOpt);
  }
  else y = wsolaStretch(channels, sr, S, { hop: M.hop, ov: M.ov, dl: M.dl * Q.dlK, dec: Q.dec, bias: M.bias, sub: M.sub }, M.onsets !== false, M.sens || 1, progress);
  if (Math.abs(p - 1) > 1e-9) y = resample(y, p, Q.L, outLen);
  return y.map((c) => { if (c.length === outLen) return c; const o = new Float32Array(outLen); o.set(c.subarray(0, Math.min(outLen, c.length))); return o; });
}
export { soundtouchRender };

/* ---------------- 結果の情報つきで返す(新エンジンが失敗したら従来方式へ自動で戻る) ---------------- */
const MAT_LABEL = { voice: "声", instrument: "楽器", bgm: "BGM", sfx: "効果音" }, ENG_LABEL = { wsola: "WSOLA", pv: "位相ボコーダー", soundtouch: "従来SoundTouch", soundtouch2: "SoundTouch調整版" }, Q_LABEL = { fast: "高速", standard: "標準", high: "高品質" };
export function renderWithInfo(channels, sr, opts = {}, progress = () => {}) {
  const engine = opts.engine || "auto", quality = QUALITY[opts.quality] ? opts.quality : "standard";
  const material = !opts.material || opts.material === "auto" ? classify(channels, sr) : opts.material;
  let used = engine === "auto" ? (MATERIAL[material] || MATERIAL.bgm).engine : engine, out, note = "";
  const ok = (o) => o.every((c) => { for (let i = 0; i < c.length; i += 1) if (!Number.isFinite(c[i])) return false; return true; });
  try { out = render(channels, sr, { ...opts, engine, quality, material }, progress); if (!ok(out)) throw Error("invalid output"); }
  catch (e) { if (engine === "soundtouch") throw e; out = render(channels, sr, { ...opts, engine: "soundtouch", quality, material }, progress); used = "soundtouch"; note = "（新エンジンでエラーのため従来方式に切替）"; }
  for (const c of out) for (let i = 0; i < c.length; i++) { const v = c[i]; if (v > 1) c[i] = 1; else if (v < -1) c[i] = -1; }
  return { channels: out, info: { engine: used, material, quality, label: `${ENG_LABEL[used] || used}・${MAT_LABEL[material] || material}・${Q_LABEL[quality]}${note}` } };
}

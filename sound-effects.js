/* ======================================================================
   sound-effects.js — 音の加工（PaintAudio.fx を追加）
   フェードイン/アウト・エコー・リバーブ・フィルター・音量・ノーマライズ・
   逆再生・無音化・ロボット声・ビブラート・トレモロ・ひずみ・8bit風。
   - 入力の音データ（{sampleRate, channels:[Float32Array…]}）は書き換えず、新しい音を返す
   - 戻り値は PaintAudio.transform と同じ形 {promise, cancel()}（キャンセルは AbortError）
   - 大きな音でも画面が固まらないよう、一定量ごとに処理を譲りながら進める
   ※ sound-core.js の後、sound-editor.js の前に読み込むこと
   ====================================================================== */
(function (global) {
  "use strict";
  const audio = global.PaintAudio;
  if (!audio) throw Error("sound-effects.js は sound-core.js の後に読み込んでください");

  const CHUNK = 1 << 17; // 1回に処理するサンプル数
  const TAIL_MAX_SECONDS = 8; // エコー/リバーブの余韻の最大長
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const abort = () => new DOMException("キャンセルしました", "AbortError");
  const frames = (pcm) => pcm.channels[0].length;
  const copy = (pcm) => ({ sampleRate: pcm.sampleRate, channels: pcm.channels.map((c) => c.slice()) });

  // ---- 長い処理を小分けにして進める ----
  async function chunks(n, ctl, fn) {
    for (let i = 0; i < n; i += CHUNK) {
      if (ctl.cancelled) throw abort();
      const end = Math.min(n, i + CHUNK);
      fn(i, end);
      ctl.done += end - i;
      ctl.progress(clamp(Math.round((100 * ctl.done) / Math.max(1, ctl.total)), 0, 99));
      await tick();
    }
  }
  // 全チャンネル × n サンプルの処理量を宣言してから、チャンネルごとに実行
  async function perChannel(pcm, ctl, n, fn) {
    ctl.total = pcm.channels.length * n;
    ctl.done = 0;
    const out = [];
    for (let ch = 0; ch < pcm.channels.length; ch++) out.push(await fn(pcm.channels[ch], ch));
    return out;
  }
  async function scale(channels, g, ctl) {
    for (const c of channels)
      await chunks(c.length, ctl, (a, b) => {
        for (let i = a; i < b; i++) c[i] *= g;
      });
  }
  // 1.0 を超える音は全体を少し下げて、音割れを防ぐ
  async function limitPeak(channels, ctl) {
    let peak = 0;
    for (const c of channels)
      for (let i = 0; i < c.length; i++) {
        const v = Math.abs(c[i]);
        if (v > peak) peak = v;
      }
    if (peak > 1) {
      await scale(channels, 1 / peak, ctl);
      ctl.notes.push("音割れしないよう、全体の音量を少し下げました。");
    }
  }
  // 余韻の最後に短いフェードアウトを入れて、ぶつっという音を防ぐ
  function endFade(channels, sampleRate, tail) {
    const len = Math.min(Math.round(0.1 * sampleRate), tail);
    for (const c of channels)
      for (let i = 0; i < len; i++) c[c.length - 1 - i] *= len > 1 ? i / (len - 1) : 0;
  }

  // ---- 各加工 ----
  const EFFECTS = {
    fadeIn: {
      label: "フェードイン",
      params: { seconds: [0, 0, 600] },
      async apply(pcm, p, ctl) {
        const n = frames(pcm),
          L = p.seconds > 0 ? Math.min(n, Math.max(1, Math.round(p.seconds * pcm.sampleRate))) : n;
        const out = copy(pcm);
        await perChannel(out, ctl, L, (c) =>
          chunks(L, ctl, (a, b) => {
            for (let i = a; i < b; i++) c[i] *= L > 1 ? i / (L - 1) : 1;
          }),
        );
        return out;
      },
    },
    fadeOut: {
      label: "フェードアウト",
      params: { seconds: [0, 0, 600] },
      async apply(pcm, p, ctl) {
        const n = frames(pcm),
          L = p.seconds > 0 ? Math.min(n, Math.max(1, Math.round(p.seconds * pcm.sampleRate))) : n;
        const out = copy(pcm);
        await perChannel(out, ctl, L, (c) =>
          chunks(L, ctl, (a, b) => {
            for (let i = a; i < b; i++) c[n - L + i] *= L > 1 ? 1 - i / (L - 1) : 0;
          }),
        );
        return out;
      },
    },
    reverse: {
      label: "逆再生",
      async apply(pcm, p, ctl) {
        const n = frames(pcm),
          out = copy(pcm);
        await perChannel(out, ctl, n, (c, ch) =>
          chunks(n, ctl, (a, b) => {
            for (let i = a; i < b; i++) c[i] = pcm.channels[ch][n - 1 - i];
          }),
        );
        return out;
      },
    },
    normalize: {
      label: "ノーマライズ",
      async apply(pcm, p, ctl) {
        let peak = 0;
        for (const c of pcm.channels)
          for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
        if (peak < 1e-5) throw Error("無音のため、ノーマライズできません。");
        const out = copy(pcm),
          g = 10 ** (-1 / 20) / peak; // 最大音量を −1 dB に揃える
        ctl.total = out.channels.length * frames(out);
        ctl.done = 0;
        await scale(out.channels, g, ctl);
        return out;
      },
    },
    gain: {
      label: "音量",
      params: { db: [6, -30, 30] },
      async apply(pcm, p, ctl) {
        const out = copy(pcm),
          g = 10 ** (p.db / 20);
        let clipped = 0;
        ctl.total = out.channels.length * frames(out);
        ctl.done = 0;
        for (const c of out.channels)
          await chunks(c.length, ctl, (a, b) => {
            for (let i = a; i < b; i++) {
              const v = c[i] * g;
              if (v > 1 || v < -1) clipped++;
              c[i] = clamp(v, -1, 1);
            }
          });
        if (clipped) ctl.notes.push("一部が上限を超えて音割れしています。dBを下げてください。");
        return out;
      },
    },
    silence: {
      label: "無音化",
      async apply(pcm) {
        return { sampleRate: pcm.sampleRate, channels: pcm.channels.map((c) => new Float32Array(c.length)) };
      },
    },
    echo: {
      label: "エコー",
      // 間隔(ミリ秒) / 減衰(1回ごとに残る音の割合 %) / 強さ(最初のエコーの大きさ %)
      params: { delayMs: [300, 20, 2000], decay: [50, 5, 90], level: [50, 5, 100] },
      async apply(pcm, p, ctl) {
        const sr = pcm.sampleRate,
          n = frames(pcm),
          D = Math.max(1, Math.round((p.delayMs / 1000) * sr)),
          fb = p.decay / 100,
          mix = p.level / 100;
        const echoes = clamp(Math.ceil(Math.log(0.001 / mix) / Math.log(fb)), 1, 30);
        const tail = Math.max(D, Math.min(echoes * D, Math.round(TAIL_MAX_SECONDS * sr)));
        const total = n + tail;
        const out = await perChannel(pcm, ctl, total, async (x) => {
          const y = new Float32Array(total),
            wet = new Float32Array(total);
          await chunks(total, ctl, (a, b) => {
            for (let t = a; t < b; t++) {
              if (t >= D) wet[t] = (t - D < n ? x[t - D] : 0) + fb * wet[t - D];
              y[t] = (t < n ? x[t] : 0) + mix * wet[t];
            }
          });
          return y;
        });
        endFade(out, sr, tail);
        await limitPeak(out, ctl);
        return { sampleRate: sr, channels: out };
      },
    },
    reverb: {
      label: "リバーブ",
      // 広さ(部屋の大きさ %) / 強さ(残響の大きさ %)   ※ Freeverb 方式
      params: { room: [50, 0, 100], level: [30, 0, 100] },
      async apply(pcm, p, ctl) {
        const sr = pcm.sampleRate,
          n = frames(pcm),
          s = sr / 44100,
          feedback = 0.7 + 0.28 * (p.room / 100),
          damp = 0.4,
          mix = p.level / 100;
        const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617],
          allpasses = [556, 441, 341, 225];
        const tailSeconds = clamp((0.04 * Math.log(1000)) / -Math.log(feedback) + 0.2, 0.5, 6);
        const tail = Math.round(tailSeconds * sr),
          total = n + tail;
        const WET = 3;
        const out = await perChannel(pcm, ctl, total, async (x, ch) => {
          const spread = ch ? Math.round(23 * s) : 0;
          const cb = combs.map((d) => new Float32Array(Math.max(2, Math.round(d * s) + spread))),
            cpos = combs.map(() => 0),
            cstore = combs.map(() => 0);
          const ab = allpasses.map((d) => new Float32Array(Math.max(2, Math.round(d * s) + spread))),
            apos = allpasses.map(() => 0);
          const y = new Float32Array(total);
          await chunks(total, ctl, (a, b) => {
            for (let t = a; t < b; t++) {
              const input = (t < n ? x[t] : 0) * 0.015;
              let acc = 0;
              for (let k = 0; k < 8; k++) {
                const buf = cb[k],
                  v = buf[cpos[k]];
                cstore[k] = v * (1 - damp) + cstore[k] * damp;
                buf[cpos[k]] = input + cstore[k] * feedback;
                if (++cpos[k] >= buf.length) cpos[k] = 0;
                acc += v;
              }
              for (let k = 0; k < 4; k++) {
                const buf = ab[k],
                  v = buf[apos[k]],
                  o = v - acc;
                buf[apos[k]] = acc + v * 0.5;
                if (++apos[k] >= buf.length) apos[k] = 0;
                acc = o;
              }
              y[t] = (t < n ? x[t] : 0) + acc * WET * mix;
            }
          });
          return y;
        });
        endFade(out, sr, tail);
        await limitPeak(out, ctl);
        return { sampleRate: sr, channels: out };
      },
    },
    filter: {
      label: "フィルター",
      // type: lowpass(高音をカット) / highpass(低音をカット) / bandpass(電話・ラジオ風)
      params: { type: ["lowpass"], freq: [1000, 50, 18000] },
      async apply(pcm, p, ctl) {
        const sr = pcm.sampleRate,
          n = frames(pcm),
          f = clamp(p.freq, 20, sr * 0.45),
          w = (2 * Math.PI * f) / sr,
          cos = Math.cos(w),
          Q = p.type === "bandpass" ? 1.2 : Math.SQRT1_2,
          alpha = Math.sin(w) / (2 * Q);
        let b0, b1, b2;
        if (p.type === "highpass") [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
        else if (p.type === "bandpass") [b0, b1, b2] = [alpha, 0, -alpha];
        else [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
        const a0 = 1 + alpha,
          c = { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
        const sections = p.type === "bandpass" ? 1 : 2; // 12dB/oct を2段で 24dB/oct に
        const out = await perChannel(pcm, ctl, n, async (x) => {
          const y = new Float32Array(n);
          const st = Array.from({ length: sections }, () => [0, 0, 0, 0]); // x1 x2 y1 y2
          await chunks(n, ctl, (a, b) => {
            for (let i = a; i < b; i++) {
              let v = x[i];
              for (let k = 0; k < sections; k++) {
                const s = st[k],
                  o = c.b0 * v + c.b1 * s[0] + c.b2 * s[1] - c.a1 * s[2] - c.a2 * s[3];
                s[1] = s[0];
                s[0] = v;
                s[3] = s[2];
                s[2] = o;
                v = o;
              }
              y[i] = v;
            }
          });
          return y;
        });
        await limitPeak(out, ctl);
        return { sampleRate: sr, channels: out };
      },
    },
    robot: {
      label: "ロボット声",
      params: { amount: [50, 1, 100] },
      async apply(pcm, p, ctl) {
        const sr = pcm.sampleRate,
          m = p.amount / 100,
          n = frames(pcm),
          w = (2 * Math.PI * 70) / sr; // 70Hz の波を掛け合わせる（リング変調）
        const out = await perChannel(pcm, ctl, n, async (x) => {
          const y = new Float32Array(n);
          await chunks(n, ctl, (a, b) => {
            for (let i = a; i < b; i++) y[i] = x[i] * (1 - m + m * Math.sin(w * i));
          });
          return y;
        });
        return { sampleRate: sr, channels: out };
      },
    },
    vibrato: {
      label: "ビブラート",
      params: { amount: [50, 1, 100] },
      async apply(pcm, p, ctl) {
        const sr = pcm.sampleRate,
          n = frames(pcm),
          depth = ((0.5 + (p.amount / 100) * 5.5) / 1000) * sr, // 0.5〜6ms 分の揺れ
          w = (2 * Math.PI * 5.5) / sr; // 毎秒5.5回
        const out = await perChannel(pcm, ctl, n, async (x) => {
          const y = new Float32Array(n);
          await chunks(n, ctl, (a, b) => {
            for (let i = a; i < b; i++) {
              const pos = Math.max(0, i - depth * (0.5 + 0.5 * Math.sin(w * i))),
                i0 = Math.floor(pos),
                fr = pos - i0;
              y[i] = x[i0] * (1 - fr) + x[Math.min(n - 1, i0 + 1)] * fr;
            }
          });
          return y;
        });
        return { sampleRate: sr, channels: out };
      },
    },
    tremolo: {
      label: "トレモロ",
      params: { amount: [50, 1, 100] },
      async apply(pcm, p, ctl) {
        const sr = pcm.sampleRate,
          n = frames(pcm),
          depth = p.amount / 100,
          w = (2 * Math.PI * 6) / sr; // 毎秒6回
        const out = await perChannel(pcm, ctl, n, async (x) => {
          const y = new Float32Array(n);
          await chunks(n, ctl, (a, b) => {
            for (let i = a; i < b; i++) y[i] = x[i] * (1 - depth * (0.5 - 0.5 * Math.cos(w * i)));
          });
          return y;
        });
        return { sampleRate: sr, channels: out };
      },
    },
    distort: {
      label: "ひずみ",
      params: { amount: [50, 1, 100] },
      async apply(pcm, p, ctl) {
        const n = frames(pcm),
          k = 1 + (p.amount / 100) * 19,
          norm = Math.tanh(k);
        const out = await perChannel(pcm, ctl, n, async (x) => {
          const y = new Float32Array(n);
          await chunks(n, ctl, (a, b) => {
            for (let i = a; i < b; i++) y[i] = Math.tanh(k * x[i]) / norm;
          });
          return y;
        });
        return { sampleRate: pcm.sampleRate, channels: out };
      },
    },
    crush: {
      label: "8bit風",
      params: { amount: [50, 1, 100] },
      async apply(pcm, p, ctl) {
        const n = frames(pcm),
          bits = Math.round(12 - (9 * p.amount) / 100), // 12〜3bit
          step = 2 ** (bits - 1),
          hold = 1 + Math.floor((p.amount / 100) * 8); // 1〜9サンプルごとに値を保持
        const out = await perChannel(pcm, ctl, n, async (x) => {
          const y = new Float32Array(n);
          let held = 0;
          await chunks(n, ctl, (a, b) => {
            for (let i = a; i < b; i++) {
              if (i % hold === 0) held = Math.round(x[i] * step) / step;
              y[i] = held;
            }
          });
          return y;
        });
        return { sampleRate: pcm.sampleRate, channels: out };
      },
    },
  };

  // ---- 引数を範囲内に収める（数値が壊れていても既定値に戻す） ----
  function normalize(name, params = {}) {
    const def = EFFECTS[name];
    if (!def) throw Error("未対応の加工です: " + name);
    const out = {};
    for (const [key, spec] of Object.entries(def.params || {})) {
      const raw = params[key];
      if (key === "type") {
        out.type = ["lowpass", "highpass", "bandpass"].includes(raw) ? raw : spec[0];
      } else {
        const v = Number(raw);
        out[key] = Number.isFinite(v) && raw !== "" && raw !== null ? clamp(v, spec[1], spec[2]) : spec[0];
      }
    }
    return out;
  }

  // PaintAudio.transform と同じ形 {promise, cancel()} を返す。notes は処理後に読める注意書き。
  function run(name, pcm, params = {}, progress = () => {}) {
    const def = EFFECTS[name];
    if (!def) throw Error("未対応の加工です: " + name);
    audio.validate(pcm);
    const p = normalize(name, params),
      notes = [],
      ctl = { cancelled: false, progress, total: 1, done: 0, notes };
    let reject;
    const aborted = new Promise((_, r) => (reject = r));
    const work = (async () => audio.validate(await def.apply(pcm, p, ctl)))();
    work.catch(() => {}); // キャンセル後に遅れて起きるエラーを無視
    return {
      promise: Promise.race([work, aborted]),
      notes,
      params: p,
      cancel() {
        ctl.cancelled = true;
        reject(abort());
      },
    };
  }

  audio.fx = {
    names: Object.keys(EFFECTS),
    label: (name) => EFFECTS[name]?.label || name,
    normalize,
    run,
    TAIL_MAX_SECONDS,
  };
})(window);

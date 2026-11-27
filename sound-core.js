(function (global) {
  "use strict";
  const MAX_SECONDS = 600,
    MAX_BYTES = 64 * 1024 * 1024;
  let context,
    epoch = 0;
  const decoded = new WeakMap(),
    buffers = new WeakMap(),
    voices = new Set(),
    versions = new Map();
  function audioContext() {
    const Audio = global.AudioContext || global.webkitAudioContext;
    if (!Audio) throw Error("このブラウザはWeb Audioに対応していません");
    if (!context || context.state === "closed") context = new Audio({ sampleRate: 44100 });
    return context;
  }
  function validate(pcm) {
    if (
      !pcm.channels?.length ||
      pcm.channels.length > 2 ||
      !pcm.channels[0].length ||
      pcm.channels.some((c) => c.length !== pcm.channels[0].length) ||
      pcm.channels[0].length / pcm.sampleRate > MAX_SECONDS ||
      !Number.isFinite(pcm.sampleRate) ||
      pcm.sampleRate < 8000 ||
      pcm.sampleRate > 96000
    ) {
      throw Error("音はモノラル／ステレオ、長さ10分以内で読み込んでください");
    }
    return pcm;
  }
  function decodeIMA(bytes) {
    // Scratch legacy sounds use WAVE IMA ADPCM (tag 0x11), which browsers often
    // cannot decode. Decode the real predictor/index blocks rather than dropping them.
    if (bytes.length < 12) return null;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const word = (p) => String.fromCharCode(...bytes.subarray(p, p + 4));
    if (word(0) !== "RIFF" || word(8) !== "WAVE") return null;
    let fmt, data, fact;
    for (let p = 12; p + 8 <= bytes.length;) {
      const size = v.getUint32(p + 4, true),
        end = p + 8 + size;
      if (end > bytes.length) throw Error("WAVファイルの長さが壊れています");
      if (word(p) === "fmt ") fmt = { p: p + 8, size };
      if (word(p) === "data") data = { p: p + 8, size };
      if (word(p) === "fact" && size >= 4) fact = v.getUint32(p + 8, true);
      p = end + (size & 1);
    }
    if (!fmt || fmt.size < 16 || v.getUint16(fmt.p, true) !== 0x11) return null;
    if (!data || fmt.size < 20) throw Error("ADPCMの音声ヘッダーが壊れています");
    const count = v.getUint16(fmt.p + 2, true),
      sampleRate = v.getUint32(fmt.p + 4, true);
    const alignment = v.getUint16(fmt.p + 12, true),
      bits = v.getUint16(fmt.p + 14, true);
    const perBlock = v.getUint16(fmt.p + 18, true);
    if (
      ![1, 2].includes(count) ||
      bits !== 4 ||
      alignment < count * 4 ||
      !perBlock ||
      sampleRate < 8000 ||
      sampleRate > 96000 ||
      perBlock > Math.floor(((alignment - count * 4) * 2) / count) + 1
    ) {
      throw Error("このADPCM音声の形式には対応していません");
    }
    const capacity = Math.ceil(data.size / alignment) * perBlock;
    const n = fact > 0 && fact <= capacity ? fact : capacity;
    if (!n || n / sampleRate > MAX_SECONDS) throw Error("ADPCMの音は10分以内にしてください");
    const channels = Array.from({ length: count }, () => new Float32Array(n));
    const steps = [
      7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66,
      73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408,
      449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
      2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630,
      9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
      32767,
    ];
    const indices = [-1, -1, -1, -1, 2, 4, 6, 8];
    let blockNumber = 0;
    for (let p = data.p; p < data.p + data.size; p += alignment, blockNumber++) {
      const end = Math.min(p + alignment, data.p + data.size);
      if (end - p < 4 * count) throw Error("ADPCMのブロックが途中で切れています");
      const predictor = [],
        index = [],
        positions = [];
      for (let ch = 0; ch < count; ch++) {
        predictor[ch] = v.getInt16(p + ch * 4, true);
        index[ch] = Math.min(88, bytes[p + ch * 4 + 2]);
        positions[ch] = blockNumber * perBlock;
        if (positions[ch] < n) channels[ch][positions[ch]++] = predictor[ch] / 32768;
      }
      let cursor = p + count * 4;
      while (cursor < end)
        for (let ch = 0; ch < count; ch++) {
          // Stereo WAVE interleaves four bytes from each channel, not each nibble.
          for (let j = 0; j < 4 && cursor < end; j++) {
            const value = bytes[cursor++];
            for (const code of [value & 15, value >> 4]) {
              const step = steps[index[ch]];
              let delta = step >> 3;
              if (code & 1) delta += step >> 2;
              if (code & 2) delta += step >> 1;
              if (code & 4) delta += step;
              predictor[ch] = Math.max(
                -32768,
                Math.min(32767, predictor[ch] + (code & 8 ? -delta : delta)),
              );
              index[ch] = Math.max(0, Math.min(88, index[ch] + indices[code & 7]));
              if (positions[ch] < n && positions[ch] < (blockNumber + 1) * perBlock) {
                channels[ch][positions[ch]++] = predictor[ch] / 32768;
              }
            }
          }
        }
    }
    return validate({ channels, sampleRate });
  }
  async function decode(bytes) {
    if (!(bytes instanceof Uint8Array) || !bytes.length) throw Error("音声データがありません");
    let promise = decoded.get(bytes);
    if (!promise) {
      promise = (async () => {
        const ima = decodeIMA(bytes);
        if (ima) return ima;
        let buffer;
        try {
          buffer = await audioContext().decodeAudioData(bytes.slice().buffer);
        } catch {
          throw Error(
            "この音源を読み込めません。破損していないMP3・WAV・OGG・M4A等をお試しください（対応形式はブラウザによります）",
          );
        }
        if (buffer.numberOfChannels > 2)
          throw Error("3チャンネル以上の音源は、先にモノラルかステレオへ変換してください");
        return validate({
          sampleRate: buffer.sampleRate,
          channels: Array.from({ length: buffer.numberOfChannels }, (_, i) =>
            buffer.getChannelData(i).slice(),
          ),
        });
      })();
      decoded.set(bytes, promise);
      promise.catch(() => decoded.delete(bytes));
    }
    return promise;
  }
  function encode(pcm) {
    validate(pcm);
    const channels = pcm.channels.length,
      length = pcm.channels[0].length;
    const bytes = new Uint8Array(44 + length * channels * 2),
      v = new DataView(bytes.buffer);
    const text = (offset, s) => {
      for (let i = 0; i < s.length; i++) bytes[offset + i] = s.charCodeAt(i);
    };
    text(0, "RIFF");
    v.setUint32(4, bytes.length - 8, true);
    text(8, "WAVE");
    text(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, channels, true);
    v.setUint32(24, pcm.sampleRate, true);
    v.setUint32(28, pcm.sampleRate * channels * 2, true);
    v.setUint16(32, channels * 2, true);
    v.setUint16(34, 16, true);
    text(36, "data");
    v.setUint32(40, bytes.length - 44, true);
    for (let i = 0, p = 44; i < length; i++)
      for (const channel of pcm.channels) {
        const value = Math.max(-1, Math.min(1, Number.isFinite(channel[i]) ? channel[i] : 0));
        v.setInt16(p, Math.round(value * (value < 0 ? 32768 : 32767)), true);
        p += 2;
      }
    return bytes;
  }
  const length = (pcm) => pcm.channels[0].length;
  function slice(pcm, start, end) {
    return { sampleRate: pcm.sampleRate, channels: pcm.channels.map((c) => c.slice(start, end)) };
  }
  function resample(pcm, rate) {
    if (pcm.sampleRate === rate) return pcm;
    const n = Math.max(1, Math.round((length(pcm) * rate) / pcm.sampleRate));
    return {
      sampleRate: rate,
      channels: pcm.channels.map((c) => {
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const t = (i * pcm.sampleRate) / rate,
            j = Math.min(c.length - 1, Math.floor(t)),
            f = t - j;
          out[i] = c[j] * (1 - f) + c[Math.min(j + 1, c.length - 1)] * f;
        }
        return out;
      }),
    };
  }
  function replace(pcm, start, end, inserted) {
    if (inserted) inserted = resample(inserted, pcm.sampleRate);
    const add = inserted ? length(inserted) : 0,
      n = Math.max(1, length(pcm) - (end - start) + add);
    const channels = Array.from(
      { length: Math.max(pcm.channels.length, inserted?.channels.length || 0) },
      (_, ch) => {
        const out = new Float32Array(n),
          original = pcm.channels[ch] || pcm.channels[0];
        out.set(original.subarray(0, start));
        if (inserted) out.set(inserted.channels[ch] || inserted.channels[0], start);
        out.set(original.subarray(end), start + add);
        return out;
      },
    );
    return validate({ sampleRate: pcm.sampleRate, channels });
  }
  const ENGINES = ["auto", "wsola", "pv", "soundtouch2", "soundtouch"], QUALITIES = ["fast", "standard", "high"], MATERIALS = ["auto", "voice", "instrument", "bgm", "sfx"];
  function transform(pcm, { tempo = 1, semitones = 0, engine = "auto", quality = "standard", material = "auto" } = {}, progress = () => {}) {
    validate(pcm);
    if (
      !Number.isFinite(tempo) ||
      tempo < 0.25 ||
      tempo > 4 ||
      !Number.isFinite(semitones) ||
      Math.abs(semitones) > 24 ||
      length(pcm) / pcm.sampleRate / tempo > MAX_SECONDS ||
      !ENGINES.includes(engine) ||
      !QUALITIES.includes(quality) ||
      !MATERIALS.includes(material)
    ) {
      throw Error("速度は0.25〜4倍、音程は±24半音、処理後の長さは10分以内にしてください");
    }
    // 注: パスは index.html（document.baseURI）基準。ワーカーを移動したらここも直すこと
    const worker = new Worker(new URL("./sound-dsp-worker.js", document.baseURI), {
      type: "module",
    });
    let settled = false,
      rejectPromise;
    const promise = new Promise((resolve, reject) => {
      rejectPromise = reject;
      worker.onmessage = ({ data }) => {
        if (data.progress !== undefined) {
          progress(data.progress);
          return;
        }
        settled = true;
        worker.terminate();
        if (data.error) reject(Error(data.error));
        else resolve(Object.assign(validate({ channels: data.channels, sampleRate: data.sampleRate }), { info: data.info }));
      };
      worker.onerror = (e) => {
        settled = true;
        worker.terminate();
        reject(Error(e.message || "音声処理に失敗しました"));
      };
      // Transfer disposable copies, never detach the editable PCM or undo history.
      const channels = pcm.channels.map((c) => c.slice());
      worker.postMessage(
        { channels, sampleRate: pcm.sampleRate, tempo, semitones, engine, quality, material },
        channels.map((c) => c.buffer),
      );
    });
    return {
      promise,
      cancel() {
        if (settled) return;
        settled = true;
        worker.terminate();
        rejectPromise(new DOMException("キャンセルしました", "AbortError"));
      },
    };
  }
  function stop(group) {
    if (group === undefined) {
      epoch++;
      versions.clear();
    } else versions.set(group, (versions.get(group) || 0) + 1);
    for (const voice of [...voices]) if (group === undefined || voice.group === group) voice.stop();
  }
  async function play(
    pcm,
    { start = 0, end = length(pcm), group = "editor", volume = 100, guard = () => true, pitch, pan } = {},
  ) {
    const ctx = audioContext(),
      requestEpoch = epoch,
      requestVersion = versions.get(group) || 0;
    await ctx.resume();
    if (requestEpoch !== epoch || requestVersion !== (versions.get(group) || 0) || !guard()) {
      throw new DOMException("再生を取り消しました", "AbortError");
    }
    let buffer = buffers.get(pcm);
    if (!buffer) {
      buffer = ctx.createBuffer(pcm.channels.length, length(pcm), pcm.sampleRate);
      pcm.channels.forEach((c, i) => buffer.copyToChannel(c, i));
      buffers.set(pcm, buffer);
    }
    const source = ctx.createBufferSource(),
      gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = Math.max(0, Math.min(1, volume / 100));
    if (pitch) source.playbackRate.value = Math.pow(2, pitch / 120); // Scratch: 音程10 = 1半音
    let panner = null;
    if (pan !== undefined && ctx.createStereoPanner) {
      panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, pan / 100));
    }
    source.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(ctx.destination);
    } else gain.connect(ctx.destination);
    let finish;
    const ended = new Promise((resolve) => {
      finish = resolve;
    });
    const voice = {
      source,
      gain,
      panner,
      group,
      ended,
      context: ctx,
      startedAt: ctx.currentTime,
      start,
      end,
      stop() {
        try {
          source.stop();
        } catch {}
        cleanup();
      },
    };
    let done = false;
    function cleanup() {
      if (done) return;
      done = true;
      source.disconnect();
      gain.disconnect();
      if (panner) panner.disconnect();
      voices.delete(voice);
      finish();
    }
    source.onended = cleanup;
    voices.add(voice);
    try {
      source.start(0, start / pcm.sampleRate, Math.max(1, end - start) / pcm.sampleRate);
    } catch (error) {
      cleanup();
      throw error;
    }
    return voice;
  }
  function ownerFor(T) {
    return global.SCN?.ownerOf(T.c || T.src?.c)?.s;
  }
  function volumeFor(T) {
    return T.volume ?? ownerFor(T)?.ex?.volume ?? 100;
  }
  async function playTarget(T, name) {
    const owner = ownerFor(T),
      sounds = owner?.ex?.sounds || [];
    let meta = sounds.find((s) => s.name === String(name));
    if (!meta && String(name).trim() && Number.isFinite(Number(name)) && sounds.length) {
      const i = (((Math.round(Number(name)) - 1) % sounds.length) + sounds.length) % sounds.length;
      meta = sounds[i];
    }
    if (!meta) return; // Scratch ignores requests for a nonexistent sound.
    const bytes = owner.snd[meta.md5ext || meta.assetId + "." + meta.dataFormat];
    const requestEpoch = epoch,
      version = versions.get(T.id) || 0;
    const guard = () => !T.dead && epoch === requestEpoch && version === (versions.get(T.id) || 0);
    const pcm = await decode(bytes);
    if (!guard()) return;
    for (const old of [...voices]) if (old.group === T.id && old.meta === meta) old.stop();
    const fx = T.sfx || {};
    const voice = await play(pcm, { group: T.id, volume: volumeFor(T), guard, pitch: fx.pitch || 0, pan: fx.pan || 0 });
    voice.meta = meta;
    await voice.ended;
  }
  function setVolume(T, value) {
    T.volume = Math.min(100, Math.max(0, Number(value) || 0));
    for (const voice of voices) if (voice.group === T.id) voice.gain.gain.value = T.volume / 100;
  }
  // 音の効果(Scratch互換): 音程 -360〜360(10で1半音) / 左右 -100〜100。再生中の音にも、あとから鳴らす音にも効く
  const SFX = { pitch: [-360, 360], pan: [-100, 100] };
  function setEffect(T, name, value, relative) {
    const r = SFX[name];
    if (!r) return;
    const fx = T.sfx || (T.sfx = { pitch: 0, pan: 0 });
    const v = Math.min(r[1], Math.max(r[0], (relative ? fx[name] : 0) + (Number(value) || 0)));
    fx[name] = v;
    for (const voice of voices) {
      if (voice.group !== T.id) continue;
      if (name === "pitch") voice.source.playbackRate.value = Math.pow(2, v / 120);
      else if (voice.panner) voice.panner.pan.value = v / 100;
    }
  }
  function installRuntime(SCN) {
    const H = SCN.H;
    H.CATS.push({ id: "sound", n: "音", c: "#cf63cf" });
    H.PAL.sound = [];
    H.menuDefs.sound = (o) => {
      const sounds = (o && ownerFor(o)?.ex?.sounds) || [];
      return sounds.length ? sounds.map((s) => [s.name, s.name]) : [["", "(音がありません)"]];
    };
    const report = (error) => {
      if (error.name !== "AbortError") global.toast("音の再生に失敗しました: " + error.message);
    };
    SCN.def("sound_start", "sound", "stack", "音[S]を鳴らす", { S: ["m", "sound"] }, (T, A) => {
      playTarget(T, A.S).catch(report);
    });
    SCN.def(
      "sound_playwait",
      "sound",
      "stack",
      "終わるまで音[S]を鳴らす",
      { S: ["m", "sound"] },
      function* (T, A, th) {
        let done = false,
          error;
        playTarget(T, A.S).then(
          () => {
            done = true;
          },
          (e) => {
            done = true;
            error = e;
          },
        );
        while (!done) {
          yield;
          if (th.stop || T.dead) return;
        }
        if (error && error.name !== "AbortError") throw error;
      },
    );
    SCN.def("sound_stopall", "sound", "stack", "すべての音を止める", {}, () => stop());
    H.menuDefs.sfx = () => [
      ["pitch", "音程"],
      ["pan", "左右にパン"],
    ];
    SCN.def("sound_fxchange", "sound", "stack", "[E]の効果を[V]ずつ変える", { E: ["m", "sfx", "pitch"], V: ["n", 10] }, (T, A) =>
      setEffect(T, String(A.E), H.toNum(A.V), true),
    );
    SCN.def("sound_fxset", "sound", "stack", "[E]の効果を[V]にする", { E: ["m", "sfx", "pitch"], V: ["n", 100] }, (T, A) =>
      setEffect(T, String(A.E), H.toNum(A.V), false),
    );
    SCN.def("sound_fxclear", "sound", "stack", "音の効果をなくす", {}, (T) => {
      setEffect(T, "pitch", 0, false);
      setEffect(T, "pan", 0, false);
    });
    SCN.def("sound_setvolume", "sound", "stack", "音量を[V]%にする", { V: ["n", 100] }, (T, A) =>
      setVolume(T, H.toNum(A.V)),
    );
    SCN.def(
      "sound_changevolume",
      "sound",
      "stack",
      "音量を[V]ずつ変える",
      { V: ["n", -10] },
      (T, A) => setVolume(T, volumeFor(T) + H.toNum(A.V)),
    );
    SCN.def("sound_volume", "sound", "r", "音量", {}, (T) => volumeFor(T));
    H.stopSound = stop;
  }
  global.PaintAudio = {
    audioContext,
    decode,
    encode,
    slice,
    replace,
    resample,
    transform,
    play,
    stop,
    playTarget,
    installRuntime,
    length,
    validate,
    MAX_SECONDS,
    MAX_BYTES,
    get activeCount() {
      return voices.size;
    },
  };
})(window);

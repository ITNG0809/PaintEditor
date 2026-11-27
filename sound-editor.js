(function (global) {
  "use strict";
  const audio = global.PaintAudio,
    q = (s) => root.querySelector(s);
  const state = {
    open: false,
    owner: null,
    record: null,
    clipboard: null,
    busy: false,
    generation: 0,
    worker: null,
    preview: null,
    frame: 0,
    anchor: 0,
    drag: false,
  };
  const records = new WeakMap(),
    waveforms = new WeakMap();
  let root, entry;
  const frames = (pcm) => audio.length(pcm),
    seconds = (pcm) => frames(pcm) / pcm.sampleRate;
  const time = (n) => (Number.isFinite(n) ? n.toFixed(2) : "0.00");
  const assetKey = (meta) => meta.md5ext || meta.assetId + "." + meta.dataFormat;
  const sounds = (owner) => owner?.ex?.sounds || [];
  Object.assign(IC, {
    snd_wave: '<path d="M3 10v4M7 6v12M12 3v18M17 7v10M21 10v4"/>',
    snd_play: '<path d="m8 5 11 7-11 7z"/>',
    snd_stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    snd_speed: '<path d="m3 5 8 7-8 7zm10 0 8 7-8 7z"/>',
    snd_pitch:
      '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="17" cy="16" rx="3" ry="2.5"/>',
    snd_undo: '<path d="M9 6 4 11l5 5M4 11h10a6 6 0 0 1 0 12" transform="translate(0 -3)"/>',
    snd_redo: '<path d="m15 6 5 5-5 5m5-5H10a6 6 0 0 0 0 12" transform="translate(0 -3)"/>',
  });
  const icon = (name) => ic(name, 18);
  const button = (action, label, i, cls = "") =>
    `<button type="button" data-action="${action}" class="${cls}" aria-label="${label}">${i ? icon(i) : ""}<span>${label}</span></button>`;
  // 音の加工パネル用の小さな部品（js/sound-effects.js の加工を呼ぶ）
  const fxNum = (id, group, label, value, min, max, step, unit, placeholder = "") =>
    `<label class="se-mini">${label}<input id="${id}" type="number" min="${min}" max="${max}" step="${step}" value="${value}" placeholder="${placeholder}" aria-label="${group}の${label}（${unit}）">${unit}</label>`;
  const fxApplyButton = (action, group) =>
    `<button type="button" data-action="${action}" class="primary" aria-label="${group}を適用"><span>適用</span></button>`;
  function status(message, error = false) {
    if (!root) return;
    const node = q(".se-status");
    node.textContent = message;
    node.classList.toggle("error", error);
  }
  function hasSelection() {
    const r = state.record;
    return r && r.end > r.start;
  }
  function range(allWhenEmpty = true) {
    const r = state.record;
    return hasSelection()
      ? [r.start, r.end]
      : allWhenEmpty
        ? [0, frames(r.pcm)]
        : [r.start, r.start];
  }
  function build() {
    if (root) return;
    root = document.createElement("section");
    root.id = "sound-editor";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "音エディター");
    root.innerHTML = `
      <header class="se-header">
        <label>編集するスプライト<select id="se_owner" aria-label="編集するスプライト"></select></label>
      </header>
      <div class="se-body">
        <aside class="se-sidebar">
          <div class="se-library-title"><strong>音のライブラリ</strong><span class="se-count">0</span></div>
          <div class="se-list" role="listbox" aria-label="音の一覧"></div>
          ${button("import", "音を読み込む", "plus", "primary se-import")}
          <input id="se_file" type="file" hidden multiple accept="audio/*,.mp3,.wav,.ogg,.oga,.m4a,.aac,.flac,.aif,.aiff,.webm,.mp4,.sprite3,.sb3,.zip">
          <p class="se-import-note">MP3 / WAV / OGG / M4A / FLAC など<br>sprite3・sb3内の音にも対応<br>1ファイル64 MB・音の長さ10分まで</p>
        </aside>
        <main class="se-main">
          <div class="se-empty">
            ${icon("snd_wave")}<h2>音を、思いどおりに。</h2>
            <p>音を読み込むか、左のライブラリから選んでください。<br>波形の編集から、音程とスピードの調整まで。</p>
            ${button("import", "最初の音を読み込む", "plus", "primary")}
          </div>
          <div class="se-workspace" hidden>
            <div class="se-heading">
              <div class="se-title"><span class="se-eyebrow">SOUND EDITOR</span>
                <input id="se_name" type="text" aria-label="音の名前" maxlength="80" spellcheck="false">
                <div class="se-meta"></div>
              </div>
              <div class="se-actions">
                ${button("undo", "元に戻す", "snd_undo")}${button("redo", "やり直す", "snd_redo")}
                ${button("export", "WAVを書き出す", "save")}
                ${button("delete-sound", "音を削除", "del", "danger")}
              </div>
            </div>
            <div class="se-wave-card" style="margin-top:24px">
              <div class="se-wave-tools">
                ${button("play", "再生", "snd_play", "primary")}${button("stop", "停止", "snd_stop")}
                <span class="se-time">0.00 / 0.00 秒</span>
                <span class="se-hint">ドラッグで範囲選択 · クリックで挿入位置を指定</span>
              </div>
              <div class="se-canvas-wrap">
                <canvas id="se_wave" tabindex="0" role="img" aria-label="音の波形。開始と終了の数値入力でも範囲選択できます"></canvas>
                <div class="se-ruler"></div>
              </div>
              <div class="se-selection">
                <label>開始<input id="se_start" type="number" step="0.01" min="0" aria-label="選択開始（秒）">秒</label>
                <label>終了<input id="se_end" type="number" step="0.01" min="0" aria-label="選択終了（秒）">秒</label>
                <span class="se-selected"></span>${button("select-all", "すべて選択", "")}
              </div>
            </div>
            <div class="se-edit-bar" style="margin-top:16px">
              ${button("cut", "切り取り", "scissors")}${button("copy", "コピー", "copy")}${button("paste", "貼り付け", "paste")}
              <span class="se-divider"></span>${button("remove", "選択範囲を削除", "del")}${button("trim", "選択範囲だけ残す", "")}
            </div>
            <div class="se-effects" style="margin-top:24px">
              <section class="se-effect">
                <h2>${icon("snd_speed")}スピード</h2>
                <p>音程はそのまま、速く・ゆっくりに。<br>選択範囲がないときは音全体に適用します。</p>
                <div class="se-effect-controls">
                  <select id="se_tempo" aria-label="速度の倍率">
                    <option value=".25">0.25倍</option><option value=".5">0.5倍</option><option value=".75">0.75倍</option>
                    <option value="1.25" selected>1.25倍</option><option value="1.5">1.5倍</option><option value="2">2倍</option><option value="4">4倍</option>
                  </select>${button("tempo", "適用する", "", "primary")}
                </div>
              </section>
              <section class="se-effect">
                <h2>${icon("snd_pitch")}音程</h2>
                <p>速さと長さはそのまま、高く・低く。<br>12半音で1オクターブ変化します。</p>
                <div class="se-effect-controls">
                  <select id="se_pitch" aria-label="音程の変化">
                    <option value="-24">−24半音（2オクターブ下）</option><option value="-12">−12半音（1オクターブ下）</option>
                    <option value="-7">−7半音</option><option value="-5">−5半音</option><option value="-2">−2半音</option><option value="-1">−1半音</option>
                    <option value="1" selected>＋1半音</option><option value="2">＋2半音</option><option value="5">＋5半音</option>
                    <option value="7">＋7半音</option><option value="12">＋12半音（1オクターブ上）</option><option value="24">＋24半音（2オクターブ上）</option>
                  </select>${button("pitch", "適用する", "", "primary")}
                </div>
              </section>
            </div>
            <section class="se-fx" aria-label="音の加工">
              <div class="se-fx-quick">
                <strong>音の加工</strong>
                ${button("fx-fadeIn", "フェードイン", "")}${button("fx-fadeOut", "フェードアウト", "")}
                ${fxNum("se_fade", "フェード", "長さ", "", 0, 600, 0.1, "秒", "全体")}
                <span class="se-divider"></span>
                ${button("fx-reverse", "逆再生", "")}${button("fx-normalize", "ノーマライズ", "")}${button("fx-silence", "選択範囲を無音に", "")}
              </div>
              <span class="se-fx-note">選択範囲があればその範囲に、なければ音全体に適用します。エコー・リバーブは余韻のぶん長くなります。</span>
              <div class="se-fx-grid">
                <div class="se-fx-row" title="音を大きく・小さく（dB）。+6dBでおよそ2倍">
                  <b>音量</b>${fxNum("se_gain", "音量", "変化", 6, -30, 30, 1, "dB")}${fxApplyButton("fx-gain", "音量")}
                </div>
                <div class="se-fx-row" title="間隔：エコーが返ってくるまでの時間／減衰：1回ごとに残る音の割合／強さ：最初のエコーの大きさ">
                  <b>エコー</b>${fxNum("se_echo_ms", "エコー", "間隔", 300, 20, 2000, 10, "ms")}${fxNum("se_echo_decay", "エコー", "減衰", 50, 5, 90, 5, "%")}${fxNum("se_echo_level", "エコー", "強さ", 50, 5, 100, 5, "%")}${fxApplyButton("fx-echo", "エコー")}
                </div>
                <div class="se-fx-row" title="広さ：部屋の大きさ（大きいほど余韻が長い）／強さ：残響の大きさ">
                  <b>リバーブ</b>${fxNum("se_rev_room", "リバーブ", "広さ", 50, 0, 100, 5, "%")}${fxNum("se_rev_level", "リバーブ", "強さ", 30, 0, 100, 5, "%")}${fxApplyButton("fx-reverb", "リバーブ")}
                </div>
                <div class="se-fx-row" title="周波数より上（ローパス）／下（ハイパス）をカット、または周りだけ残す（バンドパス）">
                  <b>フィルター</b><select id="se_filter_type" aria-label="フィルターの種類"><option value="lowpass">ローパス（こもらせる）</option><option value="highpass">ハイパス（低音を削る）</option><option value="bandpass">バンドパス（電話風）</option></select>${fxNum("se_filter_freq", "フィルター", "周波数", 1000, 50, 18000, 50, "Hz")}${fxApplyButton("fx-filter", "フィルター")}
                </div>
                <div class="se-fx-row" title="声や音色を変える。強さが大きいほど変化が大きくなります">
                  <b>変化</b><select id="se_voice_type" aria-label="声や音色の変化の種類"><option value="robot">ロボット声</option><option value="vibrato">ビブラート</option><option value="tremolo">トレモロ</option><option value="distort">ひずみ</option><option value="crush">8bit風</option></select>${fxNum("se_voice_amount", "変化", "強さ", 50, 1, 100, 5, "%")}${fxApplyButton("fx-voice", "変化")}
                </div>
              </div>
            </section>
          </div>
          <footer class="se-footer">
            <span class="se-status" role="status" aria-live="polite"></span>
            ${button("cancel", "処理をキャンセル", "")}
            ${button("save-project", "音を含めてプロジェクト保存", "save")}
          </footer>
        </main>
      </div>`;
    if (global.PaintNav) root.querySelector(".se-header").prepend(global.PaintNav.make("sound", ""));
    document.body.append(root);
    root.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action)
        Promise.resolve(actions[action]?.()).catch((error) => status(error.message, true));
    });
    q("#se_owner").onchange = () => selectOwner(SPS[Number(q("#se_owner").value)]);
    q("#se_file").onchange = (event) => {
      const files = [...event.target.files];
      event.target.value = "";
      importFiles(files).catch((error) => status(error.message, true));
    };
    q("#se_name").onchange = rename;
    for (const id of ["se_start", "se_end"])
      q("#" + id).onchange = () => {
        if (!state.record || state.busy) return;
        const r = state.record,
          n = frames(r.pcm),
          rate = r.pcm.sampleRate;
        const a = Math.min(n, Math.max(0, Math.round(Number(q("#se_start").value) * rate) || 0));
        const b = Math.min(n, Math.max(0, Math.round(Number(q("#se_end").value) * rate) || 0));
        select(Math.min(a, b), Math.max(a, b));
      };
    const canvas = q("#se_wave");
    const point = (e) =>
      Math.round(
        Math.max(
          0,
          Math.min(1, (e.clientX - canvas.getBoundingClientRect().left) / canvas.clientWidth),
        ) * frames(state.record.pcm),
      );
    canvas.onpointerdown = (e) => {
      if (!state.record || state.busy) return;
      e.preventDefault();
      stopPreview();
      canvas.focus();
      state.anchor = point(e);
      state.drag = true;
      canvas.setPointerCapture(e.pointerId);
      select(state.anchor, state.anchor);
    };
    canvas.onpointermove = (e) => {
      if (!state.drag || !state.record) return;
      const p = point(e);
      select(Math.min(p, state.anchor), Math.max(p, state.anchor));
    };
    canvas.onpointerup = canvas.onpointercancel = () => {
      state.drag = false;
    };
    new ResizeObserver(draw).observe(canvas);
    global.addEventListener("keydown", keyboard, true);
    update();
  }
  function ownerOptions() {
    const select = q("#se_owner");
    select.replaceChildren();
    SPS.forEach((owner, i) => {
      const option = document.createElement("option");
      option.value = i;
      option.textContent = owner.stage ? "ステージ" : owner.n;
      option.selected = owner === state.owner;
      select.append(option);
    });
  }
  async function selectOwner(owner) {
    cancel();
    stopPreview();
    state.owner = owner;
    state.record = null;
    ownerOptions();
    renderList();
    update();
    if (sounds(owner).length) await selectSound(sounds(owner)[0]);
    else
      status(
        "音はスプライトごとに保存されます。MP3等を読み込むか、音を含むScratchファイルを開いてください。",
      );
  }
  function renderList() {
    const list = q(".se-list");
    list.replaceChildren();
    const items = sounds(state.owner);
    q(".se-count").textContent = items.length;
    for (const meta of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", String(state.record?.meta === meta));
      b.disabled = state.busy;
      b.innerHTML = `<span class="se-sound-icon">${icon("snd_wave")}</span><span class="se-sound-label"><b></b><small></small></span>`;
      b.querySelector("b").textContent = meta.name;
      b.querySelector("small").textContent =
        `${time((meta.sampleCount || 0) / (meta.rate || 44100))} 秒 · ${(meta.dataFormat || "audio").toUpperCase()}`;
      b.onclick = () => selectSound(meta).catch((error) => status(error.message, true));
      list.append(b);
    }
  }
  async function recordFor(owner, meta) {
    const key = assetKey(meta),
      bytes = owner.snd?.[key];
    let map = records.get(owner);
    if (!map) {
      map = new Map();
      records.set(owner, map);
    }
    let record = map.get(meta);
    if (record?.bytes === bytes) return record;
    const pcm = await audio.decode(bytes);
    record = { owner, meta, bytes, pcm, start: 0, end: frames(pcm), undo: [], redo: [] };
    map.set(meta, record);
    return record;
  }
  async function selectSound(meta) {
    cancel();
    stopPreview();
    state.record = null;
    const generation = state.generation,
      owner = state.owner;
    state.busy = true;
    status("音を読み込み中…");
    update();
    renderList();
    try {
      const record = await recordFor(owner, meta);
      if (generation !== state.generation || !state.open) return;
      state.record = record;
      status(
        "波形をドラッグして編集できます。変更はプロジェクトへ反映されます。保存には音を含むプロジェクト保存を使ってください。",
      );
    } catch (error) {
      if (generation === state.generation) status(error.message, true);
    } finally {
      if (generation === state.generation) {
        state.busy = false;
        update();
        renderList();
      }
    }
  }
  function update() {
    if (!root) return;
    const r = state.record;
    q(".se-empty").hidden = !!r;
    q(".se-workspace").hidden = !r;
    root.setAttribute("aria-busy", String(state.busy));
    for (const node of root.querySelectorAll("button,select,input")) {
      const action = node.dataset.action;
      node.disabled = state.busy && !["cancel", "close"].includes(action);
    }
    q('[data-action="cancel"]').hidden = !state.busy;
    if (r) {
      if (document.activeElement !== q("#se_name")) q("#se_name").value = r.meta.name;
      q(".se-meta").textContent =
        `${time(seconds(r.pcm))} 秒  /  ${(r.pcm.sampleRate / 1000).toFixed(1)} kHz  /  ${r.pcm.channels.length === 1 ? "モノラル" : "ステレオ"}  /  ${(r.meta.dataFormat || "audio").toUpperCase()}`;
      q('[data-action="undo"]').disabled ||= !r.undo.length;
      q('[data-action="redo"]').disabled ||= !r.redo.length;
      q('[data-action="paste"]').disabled ||= !state.clipboard;
      for (const a of ["cut", "copy", "remove", "trim", "fx-silence"])
        q(`[data-action="${a}"]`).disabled ||= !hasSelection();
      q("#se_start").max = q("#se_end").max = seconds(r.pcm);
      q("#se_start").value = (r.start / r.pcm.sampleRate).toFixed(4);
      q("#se_end").value = (r.end / r.pcm.sampleRate).toFixed(4);
      q(".se-selected").textContent = hasSelection()
        ? `${time((r.end - r.start) / r.pcm.sampleRate)} 秒を選択`
        : "挿入位置";
    }
    draw();
  }
  function draw() {
    if (!root || root.hidden || !state.record) return;
    const canvas = q("#se_wave"),
      r = state.record,
      pcm = r.pcm,
      n = frames(pcm),
      dpr = devicePixelRatio || 1;
    const width = canvas.clientWidth,
      height = canvas.clientHeight;
    if (!width || !height) return;
    const w = Math.round(width * dpr),
      h = Math.round(height * dpr);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const x = canvas.getContext("2d");
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, width, height);
    x.fillStyle = "#fcfbff";
    x.fillRect(0, 0, width, height);
    x.strokeStyle = "#eeeaf5";
    x.lineWidth = 1;
    x.beginPath();
    for (let i = 0; i <= 10; i++) {
      const p = (width * i) / 10;
      x.moveTo(p, 0);
      x.lineTo(p, height);
    }
    x.stroke();
    const a = (r.start / n) * width,
      b = (r.end / n) * width;
    if (a !== b) {
      x.fillStyle = "#a57be322";
      x.fillRect(a, 0, b - a, height);
    }
    const lane = height / pcm.channels.length;
    let peaks = waveforms.get(pcm);
    if (!peaks) {
      const bins = Math.min(n, 4096);
      peaks = pcm.channels.map((channel) => {
        const lo = new Float32Array(bins),
          hi = new Float32Array(bins);
        for (let bin = 0; bin < bins; bin++) {
          const first = Math.floor((bin / bins) * n),
            last = Math.ceil(((bin + 1) / bins) * n);
          for (let i = first; i < last; i++) {
            lo[bin] = Math.min(lo[bin], channel[i]);
            hi[bin] = Math.max(hi[bin], channel[i]);
          }
        }
        return { lo, hi };
      });
      waveforms.set(pcm, peaks);
    }
    peaks.forEach(({ lo, hi }, ch) => {
      const mid = lane * (ch + 0.5),
        amplitude = lane * 0.37;
      x.strokeStyle = "#d6c9eb";
      x.beginPath();
      x.moveTo(0, mid);
      x.lineTo(width, mid);
      x.stroke();
      x.strokeStyle = "#9470d1";
      x.beginPath();
      for (let px = 0; px < width; px++) {
        const first = Math.floor((px / width) * lo.length),
          last = Math.max(first + 1, Math.ceil(((px + 1) / width) * lo.length));
        let low = 0,
          high = 0;
        for (let i = first; i < last && i < lo.length; i++) {
          low = Math.min(low, lo[i]);
          high = Math.max(high, hi[i]);
        }
        x.moveTo(px + 0.5, mid - high * amplitude);
        x.lineTo(px + 0.5, mid - low * amplitude);
      }
      x.stroke();
    });
    x.strokeStyle = "#855cd6";
    x.lineWidth = 1.5;
    x.beginPath();
    x.moveTo(a, 0);
    x.lineTo(a, height);
    if (b !== a) {
      x.moveTo(b, 0);
      x.lineTo(b, height);
    }
    x.stroke();
    let playhead = state.record.start;
    if (state.preview) {
      playhead = Math.min(
        state.preview.end,
        state.preview.start +
          (state.preview.context.currentTime - state.preview.startedAt) * pcm.sampleRate,
      );
      const p = (playhead / n) * width;
      x.strokeStyle = "#f18a66";
      x.beginPath();
      x.moveTo(p, 0);
      x.lineTo(p, height);
      x.stroke();
    }
    q(".se-time").textContent = `${time(playhead / pcm.sampleRate)} / ${time(seconds(pcm))} 秒`;
    const ruler = q(".se-ruler");
    if (ruler.dataset.duration !== n + ":" + pcm.sampleRate) {
      ruler.dataset.duration = n + ":" + pcm.sampleRate;
      ruler.replaceChildren();
      for (let i = 0; i <= 5; i++) {
        const label = document.createElement("span");
        label.textContent = time((seconds(pcm) * i) / 5) + "s";
        ruler.append(label);
      }
    }
  }
  function select(start, end) {
    if (!state.record) return;
    state.record.start = start;
    state.record.end = end;
    update();
  }
  function snapshot(r) {
    return { pcm: r.pcm, name: r.meta.name, start: r.start, end: r.end };
  }
  function remember(r) {
    r.undo.push(snapshot(r));
    r.redo = [];
    let size = r.undo.reduce((n, s) => n + frames(s.pcm) * s.pcm.channels.length * 4, 0);
    while (r.undo.length > 20 || (size > 96 * 1024 * 1024 && r.undo.length > 1)) {
      const old = r.undo.shift();
      size -= frames(old.pcm) * old.pcm.channels.length * 4;
    }
  }
  function store(r, pcm, name = r.meta.name) {
    if (name !== r.meta.name) renameReferences(r.owner, r.meta.name, name);
    const bytes = audio.encode(pcm),
      id = md5(bytes),
      key = id + ".wav",
      oldKey = assetKey(r.meta);
    r.owner.snd ||= {};
    r.owner.snd[key] = bytes;
    Object.assign(r.meta, {
      name,
      assetId: id,
      md5ext: key,
      dataFormat: "wav",
      rate: pcm.sampleRate,
      sampleCount: frames(pcm),
      format: "",
    });
    if (oldKey !== key && !sounds(r.owner).some((s) => assetKey(s) === oldKey))
      delete r.owner.snd[oldKey];
    r.pcm = pcm;
    r.bytes = bytes;
    r.start = Math.min(frames(pcm), r.start);
    r.end = Math.min(frames(pcm), r.end);
    dirty = 1;
    clearTimeout(fin.t);
    fin.t = setTimeout(bkRun, 1200);
    renderList();
    update();
  }
  function edit(pcm, start, end, message) {
    const r = state.record;
    remember(r);
    stopPreview();
    store(r, pcm);
    select(start, end);
    status(message + "（元に戻す操作が使えます）");
  }
  function copySelection() {
    if (!hasSelection() || state.busy) return;
    state.clipboard = audio.slice(state.record.pcm, state.record.start, state.record.end);
    update();
    status(
      `${time(seconds(state.clipboard))}秒をコピーしました。別の音やスプライトにも貼り付けできます。`,
    );
  }
  function removeSelection(cut = false) {
    if (!hasSelection() || state.busy) return;
    const r = state.record,
      a = r.start,
      b = r.end;
    if (cut) copySelection();
    edit(
      audio.replace(r.pcm, a, b, null),
      Math.min(a, Math.max(1, frames(r.pcm) - (b - a))),
      Math.min(a, Math.max(1, frames(r.pcm) - (b - a))),
      cut ? "切り取りました" : "削除しました",
    );
  }
  function paste() {
    if (!state.clipboard || !state.record || state.busy) return;
    const r = state.record,
      clip = audio.resample(state.clipboard, r.pcm.sampleRate);
    edit(
      audio.replace(r.pcm, r.start, r.end, clip),
      r.start,
      r.start + frames(clip),
      "貼り付けました",
    );
  }
  function history(redo) {
    const r = state.record;
    if (!r || state.busy) return;
    const from = redo ? r.redo : r.undo,
      to = redo ? r.undo : r.redo;
    const previous = from.pop();
    if (!previous) return;
    to.push(snapshot(r));
    stopPreview();
    store(r, previous.pcm, previous.name);
    select(previous.start, previous.end);
    status(redo ? "やり直しました" : "元に戻しました");
  }
  function renameReferences(owner, previous, name) {
    for (const block of Object.values(owner.ex.blocks || {})) {
      if (block?.opcode === "sound_sounds_menu" && block.fields?.SOUND_MENU?.[0] === previous) {
        block.fields.SOUND_MENU[0] = name;
      }
    }
    for (const scene of SCN.S.scenes)
      for (const o of scene.objs) {
        if (SCN.ownerOf(o.c)?.s !== owner) continue;
        const walk = (list) => {
          for (const b of list) {
            if (["sound_start", "sound_playwait"].includes(b.op) && b.in.S === previous)
              b.in.S = name;
            for (const sub of Object.values(b.c || {})) walk(sub);
          }
        };
        o.sc.forEach((s) => walk(s.b));
      }
    SCN.touch();
  }
  function rename() {
    const r = state.record;
    if (!r || state.busy) return;
    const name = q("#se_name").value.trim().slice(0, 80);
    if (!name || sounds(r.owner).some((s) => s !== r.meta && s.name === name)) {
      q("#se_name").value = r.meta.name;
      status("空の名前や、同じスプライト内で重複した名前は使えません。", true);
      return;
    }
    if (name === r.meta.name) return;
    remember(r);
    store(r, r.pcm, name);
    status("音の名前を変更しました");
  }
  async function effect(mode) {
    if (!state.record || state.busy) return;
    stopPreview();
    const r = state.record,
      [a, b] = range();
    const params =
      mode === "tempo"
        ? { tempo: Number(q("#se_tempo").value) }
        : { semitones: Number(q("#se_pitch").value) };
    const resultLength = frames(r.pcm) - (b - a) + Math.round((b - a) / (params.tempo || 1));
    if (resultLength / r.pcm.sampleRate > audio.MAX_SECONDS)
      throw Error("処理後の音が10分を超えます。範囲を短くしてください。");
    state.busy = true;
    const generation = ++state.generation;
    update();
    renderList();
    try {
      state.worker = audio.transform(audio.slice(r.pcm, a, b), params, (p) =>
        status(`音声処理中… ${p}%`),
      );
      const pcm = await state.worker.promise;
      if (generation !== state.generation || !state.open || state.record !== r) return;
      const result = audio.replace(r.pcm, a, b, pcm);
      remember(r);
      store(r, result);
      select(a, a + frames(pcm));
      status(
        mode === "tempo"
          ? "音程を保ってスピードを変更しました。変更済みの音を再生できます。"
          : "スピードと長さを保って音程を変更しました。変更済みの音を再生できます。",
      );
    } catch (error) {
      if (generation === state.generation) status(error.message, error.name !== "AbortError");
    } finally {
      if (generation === state.generation) {
        state.worker = null;
        state.busy = false;
        update();
        renderList();
      }
    }
  }
  // ---- 音の加工（js/sound-effects.js）。スピード/音程と同じく、元に戻す・キャンセルに対応 ----
  const FX_VOICE = { amount: "se_voice_amount" };
  const FX_INPUTS = {
    fadeIn: { seconds: "se_fade" },
    fadeOut: { seconds: "se_fade" },
    gain: { db: "se_gain" },
    echo: { delayMs: "se_echo_ms", decay: "se_echo_decay", level: "se_echo_level" },
    reverb: { room: "se_rev_room", level: "se_rev_level" },
    filter: { type: "se_filter_type", freq: "se_filter_freq" },
    robot: FX_VOICE,
    vibrato: FX_VOICE,
    tremolo: FX_VOICE,
    distort: FX_VOICE,
    crush: FX_VOICE,
  };
  async function fxApply(name) {
    if (!state.record || state.busy) return;
    if (name === "silence" && !hasSelection())
      throw Error("無音にする範囲を、波形をドラッグして選んでください。");
    stopPreview();
    const fx = audio.fx,
      r = state.record,
      [a, b] = range(),
      inputs = FX_INPUTS[name] || {},
      raw = {};
    for (const [key, id] of Object.entries(inputs)) raw[key] = q("#" + id).value;
    state.busy = true;
    const generation = ++state.generation;
    update();
    renderList();
    try {
      const job = (state.worker = fx.run(name, audio.slice(r.pcm, a, b), raw, (p) =>
        status(`${fx.label(name)}を処理中… ${p}%`),
      ));
      // 範囲外の数値は補正して、入力欄にも反映する（空欄の「全体」はそのまま）
      for (const [key, id] of Object.entries(inputs)) {
        const input = q("#" + id);
        if (input.value !== "") input.value = job.params[key];
      }
      const pcm = await job.promise;
      if (generation !== state.generation || !state.open || state.record !== r) return;
      if ((frames(r.pcm) - (b - a) + frames(pcm)) / r.pcm.sampleRate > audio.MAX_SECONDS)
        throw Error("処理後の音が10分を超えます。範囲を短くしてください。");
      const result = audio.replace(r.pcm, a, b, pcm);
      remember(r);
      store(r, result);
      select(a, a + frames(pcm));
      const longer = (frames(pcm) - (b - a)) / r.pcm.sampleRate;
      status(
        `${fx.label(name)}を適用しました。` +
          (longer > 0.01 ? `余韻のぶん${time(longer)}秒長くなりました。` : "") +
          job.notes.join("") +
          "（元に戻す操作が使えます）",
      );
    } catch (error) {
      if (generation === state.generation) status(error.message, error.name !== "AbortError");
    } finally {
      if (generation === state.generation) {
        state.worker = null;
        state.busy = false;
        update();
        renderList();
      }
    }
  }
  function cancel() {
    state.generation++;
    state.worker?.cancel();
    state.worker = null;
    state.busy = false;
    if (root) {
      status("処理をキャンセルしました。音は変更していません。");
      update();
      renderList();
    }
  }
  function stopPreview() {
    state.preview?.stop();
    state.preview = null;
    audio.stop("editor");
    cancelAnimationFrame(state.frame);
    state.frame = 0;
    draw();
  }
  async function preview() {
    if (!state.record || state.busy) return;
    if (state.preview) {
      stopPreview();
      return;
    }
    const r = state.record,
      [start, end] = range(false);
    const generation = state.generation;
    try {
      const voice = await audio.play(r.pcm, {
        start,
        end: end > start ? end : frames(r.pcm),
        guard: () => state.open && state.record === r && generation === state.generation,
      });
      state.preview = voice;
      const animate = () => {
        if (!state.preview) return;
        draw();
        state.frame = requestAnimationFrame(animate);
      };
      animate();
      voice.ended.then(() => {
        if (state.preview === voice) stopPreview();
      });
    } catch (error) {
      if (error.name !== "AbortError") status(error.message, true);
    }
  }
  async function importFiles(files) {
    if (state.busy || !files.length) return;
    stopPreview();
    const generation = ++state.generation;
    state.busy = true;
    update();
    renderList();
    let added = 0,
      last,
      failures = [];
    const owner = state.owner;
    try {
      for (const file of files) {
        if (generation !== state.generation || !state.open) return;
        if (/\.(sprite3|sb3|zip)$/i.test(file.name)) {
          await s3in(file);
          if (generation !== state.generation || !state.open) return;
          state.owner = SPS[SPI];
          ownerOptions();
          state.record = null;
          continue;
        }
        if (file.size > audio.MAX_BYTES) {
          failures.push(file.name + ": 64 MBを超えています");
          continue;
        }
        try {
          status(file.name + " を読み込み中…");
          const bytes = new Uint8Array(await file.arrayBuffer()),
            pcm = await audio.decode(bytes);
          if (generation !== state.generation || !state.open) return;
          const target = state.owner === owner ? owner : state.owner;
          const list = ((target.ex ||= {}).sounds ||= []);
          const base = file.name.replace(/\.[^.]+$/, "").slice(0, 70) || "音";
          let name = base,
            n = 2;
          while (list.some((s) => s.name === name)) name = base + " " + n++;
          const meta = { name };
          list.push(meta);
          const r = { owner: target, meta, pcm, start: 0, end: frames(pcm), undo: [], redo: [] };
          if (!records.has(target)) records.set(target, new Map());
          records.get(target).set(meta, r);
          store(r, pcm);
          last = r;
          added++;
        } catch (error) {
          failures.push(file.name + ": " + error.message);
        }
      }
    } finally {
      if (generation === state.generation) {
        state.busy = false;
        if (last?.owner === state.owner) state.record = last;
        ownerOptions();
        renderList();
        update();
        if (!state.record && sounds(state.owner).length) await selectSound(sounds(state.owner)[0]);
        status(
          failures.length
            ? failures.join("\n")
            : added
              ? `${added}個の音を読み込みました。Scratch互換WAVとして保存されます。`
              : "Scratchファイル内の音をライブラリに反映しました。",
          !!failures.length,
        );
      }
    }
  }
  function keyboard(event) {
    if (!state.open || document.querySelector("#uidlg")) return;
    const typing = event.target.matches("input,select,textarea") || event.target.isContentEditable;
    if (event.key === "Tab") {
      const nodes = [
        ...root.querySelectorAll(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),canvas",
        ),
      ].filter((n) => n.getClientRects().length);
      if (
        (event.shiftKey && document.activeElement === nodes[0]) ||
        (!event.shiftKey && document.activeElement === nodes.at(-1))
      ) {
        event.preventDefault();
        (event.shiftKey ? nodes.at(-1) : nodes[0]).focus();
      }
      event.stopImmediatePropagation();
      return;
    }
    if (typing) {
      if (event.key === "Escape") {
        event.target.blur();
        event.stopImmediatePropagation();
      }
      return;
    }
    event.stopImmediatePropagation();
    const modifier = event.ctrlKey || event.metaKey,
      key = event.key.toLowerCase();
    let action;
    if (modifier)
      action = {
        a: "select-all",
        c: "copy",
        x: "cut",
        v: "paste",
        z: event.shiftKey ? "redo" : "undo",
        y: "redo",
      }[key];
    else action = { " ": "play", delete: "remove", backspace: "remove", escape: "close" }[key];
    if (action) {
      event.preventDefault();
      Promise.resolve(actions[action]()).catch((e) => status(e.message, true));
    }
  }
  async function open() {
    build();
    spLeave();
    spSave();
    SCN.close();
    state.open = true;
    root.hidden = false;
    entry.classList.add("on");
    await selectOwner(SPS[SPI]);
    q('.se-header .pe-nav-b.on')?.focus();
  }
  function close() {
    cancel();
    stopPreview();
    state.open = false;
    state.record = null;
    root.hidden = true;
    entry.classList.remove("on");
    entry.focus();
  }
  const actions = {
    open,
    close,
    import: () => q("#se_file").click(),
    copy: copySelection,
    cut: () => removeSelection(true),
    remove: () => removeSelection(false),
    paste,
    undo: () => history(false),
    redo: () => history(true),
    play: preview,
    stop: stopPreview,
    "select-all": () => {
      if (state.record && !state.busy) select(0, frames(state.record.pcm));
    },
    trim: () => {
      if (hasSelection() && !state.busy) {
        const r = state.record,
          pcm = audio.slice(r.pcm, r.start, r.end);
        edit(pcm, 0, frames(pcm), "選択範囲だけを残しました");
      }
    },
    tempo: () => effect("tempo"),
    pitch: () => effect("pitch"),
    "fx-fadeIn": () => fxApply("fadeIn"),
    "fx-fadeOut": () => fxApply("fadeOut"),
    "fx-reverse": () => fxApply("reverse"),
    "fx-normalize": () => fxApply("normalize"),
    "fx-silence": () => fxApply("silence"),
    "fx-gain": () => fxApply("gain"),
    "fx-echo": () => fxApply("echo"),
    "fx-reverb": () => fxApply("reverb"),
    "fx-filter": () => fxApply("filter"),
    "fx-voice": () => fxApply(q("#se_voice_type").value),
    cancel,
    export: () => {
      if (state.record)
        dl(
          new Blob([audio.encode(state.record.pcm)], { type: "audio/wav" }),
          safeName(state.record.meta.name) + ".wav",
        );
    },
    "save-project": () => dl(new Blob([ser()], { type: "application/json" }), "project.costume"),
    "delete-sound": async () => {
      if (!state.record || state.busy) return;
      const r = state.record;
      if (
        !(await uiConfirm(
          `音「${r.meta.name}」を削除しますか？\n音を使うブロックは残ります。この削除は元に戻せません。`,
        ))
      )
        return;
      stopPreview();
      const list = sounds(r.owner),
        key = assetKey(r.meta);
      list.splice(list.indexOf(r.meta), 1);
      if (!list.some((s) => assetKey(s) === key)) delete r.owner.snd[key];
      records.get(r.owner)?.delete(r.meta);
      state.record = null;
      dirty = 1;
      await selectOwner(r.owner);
    },
  };
  entry = document.createElement("button");
  entry.id = "sound_open";
  entry.type = "button";
  entry.className = "mbtn";
  entry.innerHTML = icon("snd_wave") + "<span>音</span>";
  entry.title = "音の読み込み・波形編集・音程とスピードの調整";
  entry.onclick = () =>
    open().catch((e) => {
      build();
      status(e.message, true);
    });
  document.querySelector("#scn_open").after(entry);
  global.PaintSoundEditor = {
    open,
    close,
    importFiles,
    selectOwner,
    selectSound,
    select,
    actions,
    get state() {
      return state;
    },
  };
})(window);

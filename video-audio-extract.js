/* 動画音声抽出：動画を読み込み、プレビューしながら範囲を決めて、音声だけを取り出す専用画面。
 * 音エディターの「動画から音声を抽出」から開き、結果は PaintSoundEditor.addPcm で音エディターへ渡す。
 * 抽出方式（上から順に試し、失敗したら次へ）:
 *   1) mp4  : MP4/MOV の音声トラックから必要な範囲だけを読み出してデコード（低メモリ・高速）
 *   2) file : ファイルを読み込んで decodeAudioData し、範囲を切り出す（中サイズまで）
 *   3) live : 非表示の動画を実時間で再生して取り込む（大きな動画・特殊な形式の最後の手段）
 * 動画ファイル自体は一切変更しません。 */
(function (global) {
  "use strict";
  const audio = global.PaintAudio,
    mp4 = global.PaintMp4Audio;
  const MAX_SECONDS = audio.MAX_SECONDS,
    DECODE_FILE_LIMIT = 300 * 1024 * 1024,
    DECODE_MEMORY_LIMIT = 420 * 1024 * 1024,
    MIN_RANGE = 0.05;
  const state = {
    open: false,
    file: null,
    url: "",
    duration: 0,
    start: 0,
    end: 0,
    demux: null,
    noAudio: false,
    busy: false,
    abort: null,
    result: null,
    previewEnd: null,
    voice: null,
    raf: 0,
  };
  let root, video, trackEl;
  const q = (s) => root.querySelector(s);
  const icon = (name) => (typeof IC !== "undefined" && IC[name] && typeof ic === "function" ? ic(name, 18) : "");
  const btn = (action, label, i = "", cls = "") =>
    `<button type="button" data-action="${action}" class="${cls}">${i ? icon(i) : ""}<span>${label}</span></button>`;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function fmt(t) {
    if (!Number.isFinite(t)) t = 0;
    t = Math.max(0, t);
    const h = Math.floor(t / 3600),
      m = Math.floor((t % 3600) / 60),
      s = t % 60;
    const ss = s.toFixed(2).padStart(5, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
  }
  const mb = (n) => (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + " MB";
  function status(message, error = false) {
    if (!root) return;
    const node = q(".ve-status");
    node.textContent = message;
    node.classList.toggle("error", error);
  }
  function progress(frac, label) {
    const bar = q(".ve-progress");
    bar.hidden = frac == null;
    if (frac != null) {
      bar.querySelector("i").style.width = clamp(frac * 100, 0, 100).toFixed(1) + "%";
      bar.setAttribute("aria-valuenow", String(Math.round(clamp(frac, 0, 1) * 100)));
    }
    if (label) status(label);
  }
  const download = (blob, name) => {
    if (typeof dl === "function") return dl(blob, name);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const safe = (n) =>
    (typeof safeName === "function" ? safeName(n) : String(n).replace(/[\\/:*?"<>|]+/g, "_")) || "audio";

  // ---------------------------------------------------------------- 画面
  function build() {
    if (root) return;
    root = document.createElement("section");
    root.id = "video-extract";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "動画音声抽出");
    root.innerHTML = `
      <header class="ve-header">
        ${btn("back", "音エディターへ戻る", "", "ve-back")}
        <h1>動画音声抽出</h1>
      </header>
      <main class="ve-main">
        <section class="ve-drop" aria-label="動画の読み込み">
          ${icon("snd_wave")}
          <h2>動画から、音だけを取り出す。</h2>
          <p>動画ファイルをここへドラッグ＆ドロップするか、下のボタンで選んでください。<br>動画は書き換えません。処理はすべてこのブラウザ内で行います。</p>
          ${btn("pick", "動画ファイルを選ぶ", "plus", "primary")}
          <small>MP4 / MOV / WebM / MKV / OGV など（再生できる形式はブラウザによります）</small>
        </section>
        <input id="ve_file" type="file" hidden accept="video/*,.mp4,.m4v,.mov,.webm,.mkv,.ogv,.ogg,.3gp,.avi">
        <div class="ve-work" hidden>
          <div class="ve-fileinfo">
            <div><b class="ve-fname"></b><span class="ve-fmeta"></span></div>
            ${btn("pick", "別の動画を読み込む", "plus")}
          </div>
          <div class="ve-card ve-player">
            <div class="ve-screen"><video playsinline preload="metadata" tabindex="-1"></video></div>
            <div class="ve-controls">
              ${btn("toggle", "再生", "snd_play", "primary ve-toggle")}
              <span class="ve-clock" aria-live="off">0:00.00 / 0:00.00</span>
              <input class="ve-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="再生位置">
              <label class="ve-vol">音量<input class="ve-volume" type="range" min="0" max="1" step="0.01" value="1" aria-label="音量"></label>
              ${btn("mute", "ミュート", "")}
            </div>
          </div>
          <div class="ve-card ve-range">
            <div class="ve-title"><strong>抽出する範囲</strong><span class="ve-hint">つまみをドラッグ、または数値で指定。トラックを押すと再生位置が動きます</span></div>
            <div class="ve-timeline">
              <div class="ve-track" aria-label="タイムライン">
                <div class="ve-sel"></div>
                <div class="ve-play"></div>
                <div class="ve-head" data-h="start" role="slider" tabindex="0" aria-label="抽出の開始位置（矢印キーで0.1秒、Shiftで1秒）"><i></i></div>
                <div class="ve-head" data-h="end" role="slider" tabindex="0" aria-label="抽出の終了位置（矢印キーで0.1秒、Shiftで1秒）"><i></i></div>
              </div>
              <div class="ve-ruler"></div>
            </div>
            <div class="ve-fields">
              <label>開始<input id="ve_start" type="number" step="0.01" min="0" aria-label="開始（秒）">秒</label>
              <label>終了<input id="ve_end" type="number" step="0.01" min="0" aria-label="終了（秒）">秒</label>
              <span class="ve-len"></span>
              ${btn("set-start", "現在位置を開始に", "")}${btn("set-end", "現在位置を終了に", "")}${btn("select-all", "全体を選ぶ", "")}
            </div>
            <div class="ve-fields">
              ${btn("preview", "選択範囲を再生", "snd_play", "primary")}
              ${btn("preview-from", "現在位置から範囲の終わりまで", "")}
              <label class="ve-check"><input id="ve_loop" type="checkbox">ループ</label>
              <span class="ve-hint">範囲の終わりで自動停止します</span>
            </div>
          </div>
          <div class="ve-card ve-extract">
            <div class="ve-title"><strong>音声を抽出</strong></div>
            <div class="ve-fields">
              ${btn("extract-range", "選択範囲を抽出", "snd_wave", "primary")}
              ${btn("extract-all", "動画全体の音声を抽出", "snd_wave")}
              <label class="ve-check"><input id="ve_auto" type="checkbox">抽出したらすぐ音エディターで開く</label>
            </div>
            <div class="ve-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" hidden><i></i></div>
            <div class="ve-line"><span class="ve-status" role="status" aria-live="polite"></span>${btn("cancel", "中止", "", "ve-cancel")}</div>
          </div>
          <div class="ve-card ve-result" hidden>
            <div class="ve-title"><strong>抽出できました</strong><span class="ve-rmeta"></span></div>
            <div class="ve-fields"><label class="ve-name">名前<input id="ve_name" type="text" maxlength="70" spellcheck="false" aria-label="音の名前"></label></div>
            <canvas class="ve-wave" aria-label="抽出した音の波形"></canvas>
            <div class="ve-fields">
              ${btn("rplay", "抽出した音を再生", "snd_play")}${btn("rstop", "停止", "snd_stop")}
              <span class="ve-spacer"></span>
              ${btn("to-editor", "音エディターで編集する", "snd_wave", "primary")}
              ${btn("save", "音声ファイル(WAV)として保存", "save")}
              ${btn("again", "別の範囲を抽出する", "")}
            </div>
          </div>
        </div>
      </main>`;
    if (global.PaintNav) root.querySelector(".ve-header").append(global.PaintNav.make("", ""));
    document.body.append(root);
    video = root.querySelector("video");
    trackEl = q(".ve-track");
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-action]");
      if (!b || b.disabled) return;
      Promise.resolve(actions[b.dataset.action]?.()).catch((err) => status(err.message, true));
    });
    // 画面内のキー操作が、背後のエディターのショートカットに渡らないようにする
    for (const t of ["keydown", "keyup"]) root.addEventListener(t, (e) => e.stopPropagation());
    root.addEventListener("click", (e) => {
      if (e.target.closest(".pe-nav-b")) shut(false);
    }, true);
    global.addEventListener("keydown", keyboard, true);
    q("#ve_file").onchange = (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (file) loadFile(file);
    };
    // ドラッグ＆ドロップ
    let depth = 0;
    root.addEventListener("dragenter", (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      depth++;
      root.classList.add("dragging");
    });
    root.addEventListener("dragover", (e) => {
      if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
    });
    root.addEventListener("dragleave", () => {
      if (--depth <= 0) {
        depth = 0;
        root.classList.remove("dragging");
      }
    });
    root.addEventListener("drop", (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      depth = 0;
      root.classList.remove("dragging");
      loadFile(e.dataTransfer.files[0]);
    });
    // 動画プレイヤー
    video.addEventListener("play", () => {
      q(".ve-toggle span").textContent = "一時停止";
      loop();
    });
    for (const t of ["pause", "ended"])
      video.addEventListener(t, () => {
        q(".ve-toggle span").textContent = "再生";
        cancelAnimationFrame(state.raf);
        state.raf = 0;
        refresh();
      });
    for (const t of ["timeupdate", "seeked", "durationchange"]) video.addEventListener(t, refresh);
    q(".ve-seek").oninput = () => {
      state.previewEnd = null;
      seek((q(".ve-seek").value / 1000) * state.duration);
    };
    q(".ve-volume").oninput = () => {
      video.volume = Number(q(".ve-volume").value);
      video.muted = false;
      refresh();
    };
    for (const id of ["ve_start", "ve_end"])
      q("#" + id).onchange = () => {
        const a = Number(q("#ve_start").value),
          b = Number(q("#ve_end").value);
        setRange(Number.isFinite(a) ? a : state.start, Number.isFinite(b) ? b : state.end, id === "ve_start");
      };
    setupTimeline();
    new ResizeObserver(() => drawResult()).observe(q(".ve-wave"));
  }
  function setupTimeline() {
    let mode = null;
    const timeAt = (e) => {
      const r = trackEl.getBoundingClientRect();
      return clamp((e.clientX - r.left) / r.width, 0, 1) * state.duration;
    };
    const apply = (e) => {
      const t = timeAt(e);
      if (mode === "start") setRange(Math.min(t, state.end - MIN_RANGE), state.end, true);
      else if (mode === "end") setRange(state.start, Math.max(t, state.start + MIN_RANGE), false);
      else {
        state.previewEnd = null;
        seek(t);
      }
    };
    trackEl.addEventListener("pointerdown", (e) => {
      if (state.busy || !state.duration) return;
      e.preventDefault();
      mode = e.target.closest(".ve-head")?.dataset.h || "seek";
      if (mode !== "seek") e.target.closest(".ve-head").focus();
      trackEl.setPointerCapture(e.pointerId);
      apply(e);
    });
    trackEl.addEventListener("pointermove", (e) => {
      if (mode) apply(e);
    });
    const end = () => {
      mode = null;
    };
    trackEl.addEventListener("pointerup", end);
    trackEl.addEventListener("pointercancel", end);
    trackEl.addEventListener("keydown", (e) => {
      const h = e.target.closest(".ve-head")?.dataset.h;
      const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
      if (!h || !step || state.busy) return;
      e.preventDefault();
      const d = step * (e.shiftKey ? 1 : 0.1);
      if (h === "start") setRange(Math.min(state.start + d, state.end - MIN_RANGE), state.end, true);
      else setRange(state.start, Math.max(state.end + d, state.start + MIN_RANGE), false);
    });
  }
  function keyboard(e) {
    if (!state.open) return;
    if (e.key === "Tab") {
      const nodes = [...root.querySelectorAll("button:not(:disabled),input:not(:disabled):not([hidden]),[tabindex='0']")].filter(
        (n) => n.getClientRects().length,
      );
      if (!nodes.length) return;
      if (!root.contains(document.activeElement)) {
        e.preventDefault();
        nodes[0].focus();
      } else if (e.shiftKey && document.activeElement === nodes[0]) {
        e.preventDefault();
        nodes.at(-1).focus();
      } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
        e.preventDefault();
        nodes[0].focus();
      }
      e.stopImmediatePropagation();
      return;
    }
    if (!root.contains(e.target)) {
      // フォーカスが背後にあっても、背後のショートカットは動かさない
      e.stopImmediatePropagation();
      if (e.key === "Escape") actions.back();
      return;
    }
    if (e.key === "Escape" && !e.target.matches("input[type=number],input[type=text]")) {
      e.preventDefault();
      actions.back();
    }
  }

  // ---------------------------------------------------------------- 表示の更新
  function setRange(start, end, startChanged = true) {
    const d = state.duration;
    start = clamp(Number.isFinite(start) ? start : 0, 0, d);
    end = clamp(Number.isFinite(end) ? end : d, 0, d);
    if (end - start < MIN_RANGE) {
      if (startChanged) start = Math.max(0, end - MIN_RANGE);
      else end = Math.min(d, start + MIN_RANGE);
      if (end - start < MIN_RANGE) {
        start = Math.max(0, d - MIN_RANGE);
        end = d;
      }
    }
    state.start = start;
    state.end = end;
    stopPreview(false);
    refresh();
  }
  function refresh() {
    if (!root || !state.file) return;
    const d = state.duration || 0,
      t = video.currentTime || 0,
      pct = (x) => (d ? (clamp(x, 0, d) / d) * 100 : 0) + "%";
    q(".ve-sel").style.left = pct(state.start);
    q(".ve-sel").style.width = d ? ((state.end - state.start) / d) * 100 + "%" : "0";
    q(".ve-play").style.left = pct(t);
    const hs = trackEl.querySelector('[data-h="start"]'),
      he = trackEl.querySelector('[data-h="end"]');
    hs.style.left = pct(state.start);
    he.style.left = pct(state.end);
    for (const [h, v] of [[hs, state.start], [he, state.end]]) {
      h.setAttribute("aria-valuemin", "0");
      h.setAttribute("aria-valuemax", d.toFixed(2));
      h.setAttribute("aria-valuenow", v.toFixed(2));
      h.setAttribute("aria-valuetext", fmt(v));
    }
    if (document.activeElement !== q("#ve_start")) q("#ve_start").value = state.start.toFixed(2);
    if (document.activeElement !== q("#ve_end")) q("#ve_end").value = state.end.toFixed(2);
    q("#ve_start").max = q("#ve_end").max = d.toFixed(2);
    q(".ve-len").textContent = `選択 ${fmt(state.end - state.start)}（${fmt(state.start)} → ${fmt(state.end)}）`;
    q(".ve-clock").textContent = `${fmt(t)} / ${fmt(d)}`;
    if (document.activeElement !== q(".ve-seek")) q(".ve-seek").value = d ? Math.round((t / d) * 1000) : 0;
    q('[data-action="mute"] span').textContent = video.muted || video.volume === 0 ? "ミュート中" : "ミュート";
    const ruler = q(".ve-ruler");
    if (ruler.dataset.d !== String(d)) {
      ruler.dataset.d = String(d);
      ruler.replaceChildren();
      for (let i = 0; i <= 4; i++) {
        const s = document.createElement("span");
        s.textContent = fmt((d * i) / 4).replace(/\.\d+$/, "");
        ruler.append(s);
      }
    }
  }
  function lock() {
    for (const node of root.querySelectorAll("button,input,select,[role=slider]")) {
      const a = node.dataset.action;
      if (a === "cancel" || a === "back") continue;
      if (node.matches("[role=slider]")) node.tabIndex = state.busy ? -1 : 0;
      else node.disabled = state.busy;
    }
    q(".ve-cancel").hidden = !state.busy;
    root.setAttribute("aria-busy", String(state.busy));
    if (!state.busy) {
      q('[data-action="rplay"]').disabled = !state.result;
      q('[data-action="rstop"]').disabled = !state.result;
    }
  }

  // ---------------------------------------------------------------- 動画の読み込み・再生
  function loop() {
    cancelAnimationFrame(state.raf);
    const tick = () => {
      if (video.paused) return;
      if (state.previewEnd != null && video.currentTime >= state.previewEnd - 0.01) {
        if (q("#ve_loop").checked) {
          video.currentTime = state.start;
        } else {
          video.pause();
          video.currentTime = state.previewEnd;
          state.previewEnd = null;
          status("範囲の終わりで停止しました。");
          return;
        }
      }
      refresh();
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
  }
  function seek(t) {
    if (!state.file) return;
    video.currentTime = clamp(t, 0, state.duration);
    refresh();
  }
  function stopPreview(pause = true) {
    state.previewEnd = null;
    if (pause && !video?.paused) video.pause();
  }
  const once = (target, ok, bad, ms = 20000) =>
    new Promise((resolve, reject) => {
      const done = (fn, v) => {
        clearTimeout(timer);
        target.removeEventListener(ok, onOk);
        if (bad) target.removeEventListener(bad, onBad);
        fn(v);
      };
      const onOk = () => done(resolve);
      const onBad = () => done(reject, target.error || Error("読み込みに失敗しました"));
      const timer = setTimeout(() => done(reject, Error("読み込みがタイムアウトしました")), ms);
      target.addEventListener(ok, onOk);
      if (bad) target.addEventListener(bad, onBad);
    });
  function mediaMessage(err, file) {
    const ext = (file.name.match(/\.([^.]+)$/) || [, ""])[1].toUpperCase();
    if (err?.code === 4 || err?.code === 3 || err?.code === 1 || /タイムアウト/.test(err?.message || "")) {
      if (/タイムアウト/.test(err.message)) return "動画の読み込みに時間がかかりすぎました。ファイルが壊れていないか確認してください。";
      return `この動画は、お使いのブラウザでは再生できない形式（${ext || "不明"}）かもしれません。映像や音声のコーデックが未対応の可能性があります。MP4（H.264＋AAC）またはWebMに変換してお試しください。`;
    }
    return "動画を読み込めませんでした。ファイルが壊れているか、対応していない形式です。";
  }
  /** 映像トラックはあるのに音声トラックが0本なら、音声なしの動画とみなす（Chromium系で有効） */
  function noAudioHint() {
    try {
      const stream = video.captureStream?.();
      return !!stream && stream.getVideoTracks().length > 0 && stream.getAudioTracks().length === 0;
    } catch {
      return false;
    }
  }
  async function loadFile(file) {
    if (state.busy) return;
    build();
    if (file.type.startsWith("audio/") || /\.(mp3|wav|ogg|oga|m4a|aac|flac|aiff?)$/i.test(file.name) && !file.type.startsWith("video/")) {
      return fail("これは音声ファイルです。音声は、音エディターの「音を読み込む」から読み込んでください。ここには動画ファイルを選びます。");
    }
    if (!file.type.startsWith("video/") && !/\.(mp4|m4v|mov|webm|mkv|ogv|ogg|3gp|avi)$/i.test(file.name)) {
      return fail(`「${file.name}」は動画ファイルではないようです。MP4・MOV・WebMなどを選んでください。`);
    }
    state.busy = true;
    lock();
    progress(0.02, "動画を読み込み中…");
    const url = URL.createObjectURL(file);
    try {
      stopPreview();
      audio.stop("video-extract");
      video.removeAttribute("src");
      video.load();
      video.src = url;
      await once(video, "loadedmetadata", "error");
      if (!Number.isFinite(video.duration)) {
        // 長さが不明（Infinity）な動画は、末尾へ一度シークして長さを確定させる
        video.currentTime = 1e101;
        await once(video, "durationchange", "error", 8000).catch(() => {});
        video.currentTime = 0;
      }
      if (!Number.isFinite(video.duration) || !(video.duration > 0)) throw Error("動画の長さを取得できませんでした。");
      if (state.url) URL.revokeObjectURL(state.url);
      Object.assign(state, {
        file,
        url,
        duration: video.duration,
        start: 0,
        end: video.duration,
        result: null,
        demux: null,
        noAudio: false,
      });
      // 音声トラックの確認（MP4/MOVは中身を直接解析。そのほかはブラウザの情報を使う）
      let note = "";
      try {
        const info = await mp4.open(file);
        if (info?.noAudio) state.noAudio = true;
        else if (info) state.demux = info;
      } catch (e) {
        if (!e.unsupported) note = "";
      }
      if (video.mozHasAudio === false || (video.audioTracks && video.audioTracks.length === 0)) state.noAudio = true;
      if (!state.demux && noAudioHint()) state.noAudio = true;
      q(".ve-drop").hidden = true;
      q(".ve-work").hidden = false;
      q(".ve-result").hidden = true;
      q(".ve-fname").textContent = file.name;
      q(".ve-fmeta").textContent =
        ` ${fmt(state.duration)} ・ ${mb(file.size)}` +
        (video.videoWidth ? ` ・ ${video.videoWidth}×${video.videoHeight}` : "") +
        (state.noAudio ? " ・ 音声トラックなし" : "");
      video.volume = Number(q(".ve-volume").value);
      refresh();
      progress(null);
      status(
        state.noAudio
          ? "この動画には音声トラックがありません。音声は抽出できません。"
          : state.duration > MAX_SECONDS
            ? `動画が10分を超えています。音エディターは10分までなので、範囲を選んで抽出してください。${note}`
            : "範囲を選んで「選択範囲を抽出」、または「動画全体の音声を抽出」を押してください。",
        state.noAudio,
      );
    } catch (error) {
      URL.revokeObjectURL(url);
      if (state.file) {
        video.src = state.url; // 前の動画に戻す
      } else {
        video.removeAttribute("src");
        video.load();
      }
      progress(null);
      status(mediaMessage(error, file), true);
      if (!state.file) {
        q(".ve-drop").hidden = false;
        q(".ve-work").hidden = true;
      }
    } finally {
      state.busy = false;
      lock();
    }
  }
  function fail(message) {
    status(message, true);
    if (!state.file) {
      q(".ve-drop").hidden = false;
      q(".ve-work").hidden = true;
    }
  }

  // ---------------------------------------------------------------- 音声の抽出
  /** AudioBuffer の [a,b) を、2ch以下の PCM にして返す（多チャンネルはステレオへ合成） */
  function toPcm(buffer, a, b) {
    const n = buffer.numberOfChannels,
      len = b - a;
    const get = (i) => buffer.getChannelData(i).subarray(a, b);
    let channels;
    if (n <= 2) channels = Array.from({ length: n }, (_, i) => get(i).slice());
    else {
      const L = new Float32Array(len),
        R = new Float32Array(len),
        k = Math.SQRT1_2;
      const add = (out, ch, gain) => {
        const src = get(ch);
        for (let i = 0; i < len; i++) out[i] += src[i] * gain;
      };
      if (n >= 6) {
        // 5.1 / 7.1: L R C LFE (Lb Rb) Ls Rs
        add(L, 0, 1);
        add(R, 1, 1);
        add(L, 2, k);
        add(R, 2, k);
        add(L, n === 6 ? 4 : 6, k);
        add(R, n === 6 ? 5 : 7, k);
        if (n === 8) {
          add(L, 4, k * 0.7);
          add(R, 5, k * 0.7);
        }
      } else
        for (let i = 0; i < n; i++) add(i % 2 ? R : L, i, 1 / Math.ceil(n / 2));
      let peak = 0;
      for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      if (peak > 1)
        for (let i = 0; i < len; i++) {
          L[i] /= peak;
          R[i] /= peak;
        }
      channels = [L, R];
    }
    return { sampleRate: buffer.sampleRate, channels };
  }
  const decodeBuffer = (arrayBuffer) =>
    audio.audioContext().decodeAudioData(arrayBuffer);

  async function viaMp4(start, end, hooks) {
    const info = state.demux;
    if (!info) throw Error("MP4/MOVの音声トラックを直接読めない動画です");
    hooks.progress(0.05, "動画から音声の部分だけを読み込み中…");
    const { bytes, firstTime } = await info.extract(start, end, {
      signal: hooks.signal,
      onProgress: (f) => hooks.progress(0.05 + f * 0.7),
    });
    hooks.progress(0.8, "音声をデコード中…");
    const buffer = await decodeBuffer(bytes.buffer);
    const rate = buffer.sampleRate,
      from = clamp(Math.round((start - firstTime) * rate), 0, buffer.length),
      to = clamp(Math.round((end - firstTime) * rate), from + 1, buffer.length);
    if (to - from < 1) throw Error("この範囲の音声が見つかりません");
    return toPcm(buffer, from, to);
  }
  async function viaFile(start, end, hooks) {
    const file = state.file;
    if (file.size > DECODE_FILE_LIMIT) throw Error("ファイルが大きいため、一括デコードは行いません");
    if (state.duration * 44100 * 4 * 2 > DECODE_MEMORY_LIMIT) throw Error("動画が長く、一括デコードはメモリを使いすぎます");
    const data = new Uint8Array(file.size);
    for (let pos = 0; pos < file.size; pos += 8 << 20) {
      if (hooks.signal.aborted) throw new DOMException("中止", "AbortError");
      data.set(new Uint8Array(await file.slice(pos, pos + (8 << 20)).arrayBuffer()), pos);
      hooks.progress(0.05 + (pos / file.size) * 0.5, "動画ファイルを読み込み中…");
    }
    hooks.progress(0.6, "音声をデコード中…（動画が大きいと時間がかかります）");
    const buffer = await decodeBuffer(data.buffer);
    if (hooks.signal.aborted) throw new DOMException("中止", "AbortError");
    const rate = buffer.sampleRate,
      from = clamp(Math.round(start * rate), 0, buffer.length),
      to = clamp(Math.round(end * rate), from + 1, buffer.length);
    return toPcm(buffer, from, to);
  }
  const RECORDER_SRC = `class R extends AudioWorkletProcessor{constructor(){super();this.a=[];this.b=[];this.n=0}
process(i){const x=i[0];if(x&&x.length){this.a.push(x[0].slice());this.b.push((x[1]||x[0]).slice());this.n+=x[0].length;
if(this.n>=4096){this.port.postMessage([this.a,this.b]);this.a=[];this.b=[];this.n=0}}return true}}
registerProcessor('ve-rec',R)`;
  async function viaLive(start, end, hooks) {
    const need = Math.round((end - start) * 44100);
    const v = document.createElement("video");
    v.className = "ve-hidden-video";
    v.playsInline = true;
    v.preload = "auto";
    v.src = state.url;
    document.body.append(v);
    let ctx, node, mute, src, timer;
    const parts = [[], []];
    let got = 0,
      playing = false;
    const cleanup = () => {
      clearInterval(timer);
      try {
        v.pause();
      } catch {}
      try {
        node?.disconnect();
        src?.disconnect();
        mute?.disconnect();
      } catch {}
      ctx?.close().catch(() => {});
      v.remove();
    };
    try {
      await once(v, "loadedmetadata", "error");
      v.currentTime = start;
      await once(v, "seeked", "error", 15000);
      const AC = global.AudioContext || global.webkitAudioContext;
      ctx = new AC({ sampleRate: 44100 });
      await ctx.resume();
      src = ctx.createMediaElementSource(v);
      mute = ctx.createGain();
      mute.gain.value = 0;
      const push = (a, b) => {
        if (!playing || got >= need) return;
        const take = Math.min(a.length, need - got);
        parts[0].push(a.subarray(0, take));
        parts[1].push(b.subarray(0, take));
        got += take;
      };
      try {
        const url = URL.createObjectURL(new Blob([RECORDER_SRC], { type: "text/javascript" }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        node = new AudioWorkletNode(ctx, "ve-rec", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: "explicit",
        });
        node.port.onmessage = (e) => {
          const [A, B] = e.data;
          for (let i = 0; i < A.length; i++) push(A[i], B[i]);
        };
      } catch {
        node = ctx.createScriptProcessor(4096, 2, 2);
        node.onaudioprocess = (e) => push(e.inputBuffer.getChannelData(0).slice(), e.inputBuffer.getChannelData(1).slice());
      }
      src.connect(node);
      node.connect(mute);
      mute.connect(ctx.destination);
      v.addEventListener("playing", () => (playing = true), { once: true });
      await v.play();
      const t0 = performance.now();
      await new Promise((resolve, reject) => {
        timer = setInterval(() => {
          if (hooks.signal.aborted) return reject(new DOMException("中止", "AbortError"));
          hooks.progress(
            0.05 + (got / need) * 0.9,
            `再生しながら音声を取り込み中… ${fmt(got / 44100)} / ${fmt(need / 44100)}（実際の再生時間と同じだけかかります）`,
          );
          if (got >= need || v.ended) return resolve();
          if (performance.now() - t0 > 12000 && got === 0)
            reject(Error("音声が流れてきません。音声トラックがない、または自動再生がブロックされた可能性があります"));
        }, 120);
      });
      if (got < 1) throw Error("音声を取り込めませんでした");
      const join = (list) => {
        const out = new Float32Array(got);
        let p = 0;
        for (const c of list) {
          out.set(c, p);
          p += c.length;
        }
        return out;
      };
      let L = join(parts[0]),
        R = join(parts[1]),
        same = true;
      for (let i = 0; i < L.length && same; i++) if (L[i] !== R[i]) same = false;
      return { sampleRate: 44100, channels: same ? [L] : [L, R] };
    } finally {
      cleanup();
    }
  }
  /** 範囲 [start,end] の音声を PCM で返す。方式を順に試し、失敗理由をまとめる */
  async function extractPcm(start, end, hooks) {
    if (state.noAudio) throw Error("この動画には音声トラックがありません。");
    if (end - start > MAX_SECONDS)
      throw Error(
        `抽出する長さが10分を超えています（${fmt(end - start)}）。音エディターは10分までなので、範囲を10分以内に絞ってください。`,
      );
    const methods = [
      ["MP4直接読み出し", viaMp4],
      ["ファイル一括デコード", viaFile],
      ["再生しながら取り込み", viaLive],
    ];
    const reasons = [];
    for (const [name, fn] of methods) {
      if (state.only && state.only !== name) continue; // 検証用
      if (fn === viaLive && noAudioHint()) throw Error("この動画には音声トラックがありません。");
      if (hooks.signal.aborted) throw new DOMException("中止", "AbortError");
      try {
        const pcm = await fn(start, end, hooks);
        audio.validate(pcm);
        return { pcm, method: name };
      } catch (error) {
        if (error.name === "AbortError") throw error;
        reasons.push(`${name}: ${error.message || error}`);
      }
    }
    // すべて失敗：音声トラックが無い可能性を最後に確かめる
    try {
      const tracks = video.captureStream?.().getAudioTracks?.();
      if (tracks && tracks.length === 0) throw Error("この動画には音声トラックがありません。");
    } catch (e) {
      if (/音声トラック/.test(e.message)) throw e;
    }
    throw Error(
      "音声を取り出せませんでした。音声のコーデックがブラウザ未対応か、ファイルが壊れている可能性があります。\n詳細: " +
        reasons.join(" / "),
    );
  }
  async function runExtract(whole) {
    if (!state.file || state.busy) return;
    stopPreview();
    audio.stop("video-extract");
    const start = whole ? 0 : state.start,
      end = whole ? state.duration : state.end;
    if (end - start < MIN_RANGE) throw Error("範囲が短すぎます。");
    const abort = new AbortController();
    state.abort = abort;
    state.busy = true;
    q(".ve-result").hidden = true;
    state.result = null;
    lock();
    progress(0.02, "音声を抽出しています…");
    try {
      const { pcm, method } = await extractPcm(start, end, {
        signal: abort.signal,
        progress: (f, label) => progress(f, label),
      });
      if (abort.signal.aborted) throw new DOMException("中止", "AbortError");
      let peak = 0;
      for (const c of pcm.channels) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]));
      const base = state.file.name.replace(/\.[^.]+$/, "").slice(0, 50) || "動画の音声";
      state.result = {
        pcm,
        method,
        name: whole ? base : `${base} ${start.toFixed(1)}-${end.toFixed(1)}s`,
        silent: peak < 1e-4,
      };
      showResult();
      progress(null);
      status(
        `${fmt(pcm.channels[0].length / pcm.sampleRate)} の音声を抽出しました（${method}）。` +
          (state.result.silent ? " ※この範囲は無音のようです。" : ""),
      );
      if (q("#ve_auto").checked) await actions["to-editor"]();
    } catch (error) {
      progress(null);
      status(error.name === "AbortError" ? "抽出を中止しました。" : error.message, error.name !== "AbortError");
    } finally {
      state.busy = false;
      state.abort = null;
      lock();
    }
  }
  function showResult() {
    const r = state.result,
      n = r.pcm.channels[0].length;
    q(".ve-result").hidden = false;
    q("#ve_name").value = r.name;
    q(".ve-rmeta").textContent =
      ` ${fmt(n / r.pcm.sampleRate)} ・ ${(r.pcm.sampleRate / 1000).toFixed(1)} kHz ・ ${r.pcm.channels.length === 1 ? "モノラル" : "ステレオ"}`;
    drawResult();
    lock();
    q(".ve-result").scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }
  function drawResult() {
    const r = state.result;
    if (!root || !r || q(".ve-result").hidden) return;
    const c = q(".ve-wave"),
      dpr = devicePixelRatio || 1,
      w = c.clientWidth,
      h = c.clientHeight;
    if (!w || !h) return;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const x = c.getContext("2d");
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = "#fcfbff";
    x.fillRect(0, 0, w, h);
    const ch = r.pcm.channels,
      n = ch[0].length,
      lane = h / ch.length;
    x.strokeStyle = "#9470d1";
    let peak = 0.05; // 小さな音も見やすいよう、表示だけ最大値に合わせて拡大する
    for (const data of ch) for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 20000))) peak = Math.max(peak, Math.abs(data[i]));
    const zoom = Math.min(1 / peak, 40);
    ch.forEach((data, k) => {
      const mid = lane * (k + 0.5);
      x.beginPath();
      for (let px = 0; px < w; px++) {
        const a = Math.floor((px / w) * n),
          b = Math.max(a + 1, Math.floor(((px + 1) / w) * n));
        let lo = 0,
          hi = 0;
        for (let i = a, step = Math.max(1, Math.floor((b - a) / 64)); i < b; i += step) {
          lo = Math.min(lo, data[i]);
          hi = Math.max(hi, data[i]);
        }
        x.moveTo(px + 0.5, mid - hi * zoom * lane * 0.45);
        x.lineTo(px + 0.5, mid - lo * zoom * lane * 0.45);
      }
      x.stroke();
    });
  }

  // ---------------------------------------------------------------- 操作
  function shut(returnFocus = true) {
    if (!state.open) return;
    state.abort?.abort();
    stopPreview();
    audio.stop("video-extract");
    state.open = false;
    root.hidden = true;
    if (returnFocus) document.querySelector("#sound-editor:not([hidden]) [data-action='video-extract']")?.focus();
  }
  const actions = {
    back: () => shut(),
    pick: () => q("#ve_file").click(),
    toggle: async () => {
      if (!state.file) return;
      if (video.paused) {
        state.previewEnd = null;
        await video.play();
      } else video.pause();
    },
    mute: () => {
      video.muted = !video.muted;
      refresh();
    },
    "set-start": () => setRange(Math.min(video.currentTime, state.end - MIN_RANGE), state.end, true),
    "set-end": () => setRange(state.start, Math.max(video.currentTime, state.start + MIN_RANGE), false),
    "select-all": () => setRange(0, state.duration, true),
    preview: async () => {
      if (!state.file) return;
      if (!video.paused && state.previewEnd != null) return stopPreview();
      video.currentTime = state.start;
      await once(video, "seeked", "error", 8000).catch(() => {});
      state.previewEnd = state.end;
      await video.play();
      status("選択範囲を再生中…（終わりで自動停止）");
    },
    "preview-from": async () => {
      if (!state.file) return;
      const t = video.currentTime;
      if (t < state.start || t >= state.end - 0.05) {
        video.currentTime = state.start;
        await once(video, "seeked", "error", 8000).catch(() => {});
      }
      state.previewEnd = state.end;
      await video.play();
    },
    "extract-range": () => runExtract(false),
    "extract-all": () => runExtract(true),
    cancel: () => state.abort?.abort(),
    rplay: async () => {
      const r = state.result;
      if (!r) return;
      stopPreview();
      audio.stop("video-extract");
      try {
        await audio.play(r.pcm, { group: "video-extract", guard: () => state.open && state.result === r });
      } catch (e) {
        if (e.name !== "AbortError") status(e.message, true);
      }
    },
    rstop: () => audio.stop("video-extract"),
    "to-editor": async () => {
      const r = state.result;
      if (!r) return;
      const editor = global.PaintSoundEditor;
      if (!editor?.addPcm) throw Error("音エディターが見つかりません");
      const name = q("#ve_name").value.trim() || r.name;
      audio.stop("video-extract");
      stopPreview();
      shut(false);
      try {
        await editor.addPcm(r.pcm, name);
      } catch (error) {
        // 失敗したら抽出画面へ戻し、結果は残す
        open().then(() => status("音エディターへ渡せませんでした: " + error.message, true));
      }
    },
    save: () => {
      const r = state.result;
      if (!r) return;
      const name = safe(q("#ve_name").value.trim() || r.name);
      download(new Blob([audio.encode(r.pcm)], { type: "audio/wav" }), name + ".wav");
      status(`「${name}.wav」を保存しました。`);
    },
    again: () => {
      q(".ve-result").hidden = true;
      audio.stop("video-extract");
      status("別の範囲を選んで、もう一度抽出できます。");
      q(".ve-range").scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    },
  };
  async function open() {
    build();
    state.open = true;
    root.hidden = false;
    lock();
    refresh();
    root.querySelector(state.file ? '[data-action="toggle"]' : '[data-action="pick"].primary')?.focus();
  }
  global.PaintVideoExtract = {
    open,
    close: shut,
    loadFile,
    get state() {
      return state;
    },
    _extractPcm: extractPcm,
  };
})(window);

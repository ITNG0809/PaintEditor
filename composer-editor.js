/* 作曲エディター: BGM-notpc を EditorS の独立した画面として開く。
 * BGM-notpc 本体（composer.html と composer-*.js / composer-style.css）は、機能も操作もそのまま。
 * 1ページ分の大きなアプリなので、専用の枠（iframe）に入れて、EditorS側の画面・キー操作・保存と干渉しないようにしている。
 *   ・初めて開くときに読み込む（起動を重くしない）。読み込んだ後は、閉じても作りかけの曲はそのまま残る
 *   ・保存(.bgmnp)・JSON・WAV・MIDI・SF2 などは、BGM-notpc本来の機能がそのまま動く
 *   ・画面を離れる（ほかのエディターへ移る）と、鳴っている曲は止まる
 * 開き方: メニューバーの「作曲」、またはほかのエディターの切り替えボタン（PaintNav）の「作曲エディター」 */
(function (global) {
  "use strict";
  const SRC = "./composer.html";
  const state = { open: false, loaded: false, failed: false };
  let root, frame, note;
  const post = (type) => {
    try {
      frame?.contentWindow?.postMessage({ ns: "editors-composer", v: 1, type }, "*");
    } catch (_) {}
  };
  function build() {
    if (root) return;
    root = document.createElement("section");
    root.id = "composer";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "作曲エディター");
    root.innerHTML = `
      <header class="cp-header"><h1>作曲エディター</h1><span class="cp-sp"></span></header>
      <div class="cp-body">
        <div class="cp-note" role="status"></div>
        <iframe class="cp-frame" title="作曲エディター" allow="autoplay; fullscreen" referrerpolicy="same-origin"></iframe>
      </div>`;
    if (global.PaintNav) root.querySelector(".cp-header").append(global.PaintNav.make("composer", ""));
    document.body.append(root);
    frame = root.querySelector("iframe");
    note = root.querySelector(".cp-note");
    // この画面にフォーカスがあるときのキー操作が、背後のエディターのショートカットへ渡らないようにする
    for (const t of ["keydown", "keyup"]) root.addEventListener(t, (e) => e.stopPropagation());
    frame.addEventListener("load", () => {
      state.loaded = true;
      note.hidden = true;
      if (state.open) focusFrame();
    });
    frame.addEventListener("error", () => fail("作曲エディターの読み込みに失敗しました。"));
  }
  const focusFrame = () => {
    try {
      frame.contentWindow.focus();
    } catch (_) {}
  };
  function fail(message) {
    state.failed = true;
    note.hidden = false;
    note.textContent = message + " ページを再読み込みしてからもう一度お試しください。";
    note.classList.add("error");
  }
  async function open() {
    build();
    // 音エディターなど、ほかの画面で鳴っている音は止める
    try {
      global.PaintAudio?.stop();
    } catch (_) {}
    state.open = true;
    root.hidden = false;
    if (!frame.getAttribute("src")) {
      note.hidden = false;
      note.classList.remove("error");
      note.textContent = "作曲エディターを読み込み中…";
      frame.src = SRC;
    } else {
      post("show");
      focusFrame();
    }
  }
  function close() {
    if (!state.open) return;
    post("hide");
    state.open = false;
    root.hidden = true;
  }
  // メニューバーに「作曲」ボタンを追加（音エディターのボタンの隣）
  (function () {
    const anchor = document.querySelector("#sound_open") || document.querySelector("#scn_open");
    if (!anchor) return;
    const b = document.createElement("button");
    b.id = "composer_open";
    b.type = "button";
    b.className = "mbtn";
    b.innerHTML = (typeof ic === "function" ? ic("nv_cmp", 20) : "") + "<span>作曲</span>";
    b.title = "ピアノロール・ソングエディターで曲を作る（作曲エディター）";
    b.onclick = () => open().catch((e) => alert("作曲エディターを開けませんでした: " + e.message));
    anchor.after(b);
  })();
  global.PaintComposer = {
    open,
    close,
    get state() {
      return state;
    },
    get frame() {
      return frame;
    },
  };
})(window);

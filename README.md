# PaintEditor（コスチュームエディター ＋ アニメーション）

ブラウザだけで動く、Scratch風のコスチュームエディターです。
**ビルド不要の静的サイト**なので、このフォルダの中身をそのままGitHub Pagesなどに置けば動きます。

## フォルダ構成

```
index.html              画面のHTML（骨組み）。下のCSS/JSを読み込む
favicon.png             タブのアイコン
css/
  style.css             すべてのスタイル（音エディター部分 → 本体部分の順）
js/
  scratch-compat.js     Scratch/TurboWarp互換（Canvas版レンダラー ＋ sb3/sprite3のプログラム変換）
  sound-core.js         音の処理の核（WAV/ADPCM読込・再生・音ブロック）
  sound-effects.js      音の加工（フェード・エコー・リバーブ・フィルターなど14種。PaintAudio.fx）
  costume-editor.js     コスチュームエディター本体（描画・図形・保存/読込・ブール演算・オフセット など）
  animation.js          アニメーション機能（シーン・ブロックエディタ・実行エンジン・拡張機能）
  sound-editor.js       音エディターの画面
  sound-dsp-worker.js   音の速度・音程変更（Web Worker。index.htmlからは読み込まず、sound-core.jsが起動する）
  vendor/soundtouch/    外部ライブラリ SoundTouchJS（LGPL。LICENSE・NOTICE付き。消さないでください）
docs/                   機能ごとの仕様メモ（音エディター／Scratch取り込み／TurboWarp互換／実行エンジン）
tests/                  動作確認テスト（Playwright。公開には不要）
```

## どこを直せばいい？

| やりたいこと | 触るファイル |
|---|---|
| 見た目・色・レイアウト | `css/style.css` |
| 描画ツール・図形・保存/読込・メニュー | `js/costume-editor.js` |
| アニメーション・ブロック・拡張機能 | `js/animation.js` |
| スクリプトの実行速度・フレームの進め方・当たり判定 | `js/animation.js` 第2部（`docs/engine.md`） |
| 音エディター | `js/sound-core.js`（処理）／`js/sound-editor.js`（画面） |
| 音の加工（エコーなど）を足す・直す | `js/sound-effects.js`（加工の計算）＋`js/sound-editor.js`（ボタン・入力欄） |
| Scratchファイルの取り込み | `js/scratch-compat.js` |
| ボタンなどのHTML | `index.html` |

## 画像効果（渦巻き・魚眼など）の仕組み

`js/animation.js` の「画像効果」部分は、TurboWarp/Scratchと同じく **GPU（WebGLのシェーダー）** で計算します。

- 色・魚眼・渦巻き・ピクセル化・モザイク・明るさを、1ピクセルずつ並列にGPUで計算（計算式はScratchと同じ）
- 効果をかける前の絵はオブジェクトごとに使い回し、コスチューム・大きさ・解像度が変わった時だけ作り直す（実行中のみ）
- GPUに送るテクスチャも、絵が変わった時だけ送り直す
- 同じ効果の2回目以降（スタンプの連打・動かない効果）は計算結果も使い回す
- 大きいスプライト（大きさ400など）は、1回に計算するピクセル数に上限を設け、解像度を少し下げて軽くする
- WebGLが使えない／途中で失敗した時は、従来のCPU計算へ自動で切り替わる（見た目は同じ）
- 確認: `tests/image-effects.mjs`（GPUとCPUの出力が一致するか・大きさ/コスチューム変更で絵が更新されるか）
- 確認: `tests/screen-effects.mjs`（巨大拡大でも滲まないか・8000%・回転/画面端/画面外・GPUとCPUの一致）

## 実行エンジン（速さの仕組み）

`js/animation.js` の実行エンジンは、TurboWarp/Scratchと同じ考え方で動きます（詳しくは `docs/engine.md`）。

- **フレームの進め方**: 画面を動かさないループ（計算・リスト・変数など）は、1フレームの中で何千回でも回る。
  見えているオブジェクトを動かす・ペン・「待つ」などは、1周ごとに画面を更新する（Scratchと同じ）
- **コンパイル**: スクリプトをJavaScriptに変換して実行。変換できないもの（拡張機能のブロックを含むもの）は自動で従来の方式に戻る
- **当たり判定**: 実行中はコスチュームの透明度を配列にして使い回す（「触れた」「端に触れた」「クリック」）
- 不具合の切り分け: ブラウザのコンソールで `SCN.H.engine.compile = false` とすると、コンパイルを使わずに動く

## 読み込み順（変更時の注意）

`index.html` は次の順に読み込みます。**順番を入れ替えると動かなくなります。**

1. `scratch-compat.js` ・ `sound-core.js` ・ `sound-effects.js` … 部品を先に用意する（`sound-effects.js` は `sound-core.js` の後）
2. `paper.js`（CDN）
3. `costume-editor.js` … 本体
4. `animation.js` … 読み込んだ瞬間に `createPaintRenderer`（1）と `PaintAudio`（1）を使う
5. `sound-editor.js` … 本体の `SCN` `SPS` などに接続するので最後

`sound-core.js` と `sound-editor.js` を1ファイルにしないのはこのためです（4を挟んで前後に分かれるため）。

## 動かし方

**手元で確認する**（`index.html` をダブルクリックで開くのは不可。音の加工に使うWorkerがブロックされます）

```sh
python3 -m http.server 8000
# → ブラウザで http://localhost:8000/ を開く
```

**GitHub Pagesで公開する**
1. このフォルダの中身をリポジトリのルートに置いてpush
2. リポジトリの Settings → Pages → Branch を `main` / `(root)` にして Save
3. `https://<ユーザー名>.github.io/<リポジトリ名>/` で開く

パスはすべて相対パスなので、`/<リポジトリ名>/` のようなサブパスでも動きます。

## 外部サービスへの依存

| 何 | どこから | 使う機能 | 取得できないとき |
|---|---|---|---|
| Paper.js 0.12.17 | cdnjs（`index.html` の `<script>`） | 結合・マスク・減算・フィルター・切り取り・ベクター消しゴム | 該当機能を使うと「Paper.jsを読み込めませんでした」と表示（他の機能は動く） |
| Google Fonts | fonts.googleapis.com | Webフォントの選択・プレビュー | そのフォントだけ使えない |
| TurboWarp拡張 | 利用者が指定したURL | 「カスタム拡張機能」の読込（任意） | 読み込み失敗の表示 |

GitHub Pages（https）ならどれも問題なく使えます。
Paper.jsを**オフラインでも使えるようにしたい**場合：`paper-core.min.js`（0.12.17）をダウンロードして
`js/vendor/paper/` に置き、`index.html` の `<script src="https://cdnjs.cloudflare.com/...">` をそのパスに書き換えてください。

## 知っておくこと

- **保存データはブラウザごと・URLごと**（localStorage）。公開URLが変わると以前の自動保存は引き継がれないので、
  必要なら先に「プロジェクト保存」で書き出してください。
- 検索エンジンに載せない設定（`noindex`）が `index.html` に入っています。載せたい場合は
  `<meta name="robots" ...>` の行を削除してください。
- Git LFS は使いません（GitHub PagesはLFSのファイルを正しく配信できないため）。

## テスト

実ブラウザ（Chromium）で動かす回帰テストです。公開には不要です。詳しくは `docs/` を参照。

```sh
python3 -m http.server 3000        # 別ターミナルで配信しておく
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node tests/sound-editor.mjs
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node tests/scratch-program-import.mjs
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node tests/engine-scheduler.mjs   # 実行エンジン（フレームの進め方・コンパイル・拡張機能）
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node tests/engine-fuzz.mjs        # ランダムなスクリプトで、コンパイル版とインタプリタ版が一致するか
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node tests/engine-collision.mjs   # 当たり判定が従来とほぼ一致し、速くなっているか
FX_UNIT_ONLY=1 node tests/sound-effects.mjs   # 音の加工の数値検証だけ（ブラウザ不要）
PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node tests/sound-effects.mjs   # 画面操作も含む
```

`sound-editor.mjs` には `ffmpeg`、`animated-text.mjs` にはネットワーク（または `TEXT_SOURCE`）が必要です。


## 重いプロジェクト
数百枚のコスチューム・エフェクト多用のプロジェクトを軽く動かす仕組みは [docs/performance.md](docs/performance.md) を参照。

---
## フラット構成について(GitHubにアップしやすい版)
フォルダを使わず、すべてのファイルを1か所に並べた版です。`index.html` と同じ階層に全ファイルを置けば動きます。
- `css/style.css` → `style.css` / `js/*.js` → 直下 / `js/vendor/soundtouch/` → `soundtouch.js`・`LICENSE-soundtouch`・`NOTICE-soundtouch.md`(ライセンス類は消さないでください)
- `docs/*.md` → `docs-*.md`(上の表の `docs/` はこの名前に読み替えてください)
- `tests/` は含めていません(フォルダ構成版にあります)。


## ビットマップレイヤー(bitmap-layers.js)

ビットマップのコスチュームで、必要なときだけ複数レイヤーを使えます(PE独自機能。Scratch/TurboWarpにレイヤーは持ち込みません)。

- 使い方: 「パネル」を開き、ビットマップのコスチュームで「レイヤーを使う」(または＋)。今の絵が1枚目のレイヤーになります。
- 操作: 追加 / 複製 / 削除 / 名前変更(行のダブルクリックも可) / 上下移動(行のドラッグも可) / 表示・非表示 / ロック / 不透明度 / 結合(下と結合・表示中を結合・通常の画像に戻す) / 選択範囲を新規レイヤーへ分離
- 既存の描画ツールはそのまま選択中レイヤーに効きます(`c.bc` を選択中レイヤーのcanvasに向ける方式)。
- 保存(.costume): コスチュームに `ly:{ver,a,L:[{id,n,v,lk,o,u}]}` を追加(下→上の順)。従来の `bm`(統合PNG)も残すので、古い版でも統合画像として開けます。
- PNG / SB3 / SVG(画像埋め込み) / サムネイル: 表示中のレイヤーを不透明度つきで1枚に統合して出力します。
- 上限: 1コスチューム最大30枚、全レイヤー合計8000万画素(960×720なら30枚、2400×1800なら18枚)。


## 追加したScratchブロック(拡張機能を除く、Scratch 3の標準ブロックをすべて揃えました)

- 動き: 回転方法を[自由に回転/左右のみ/回転しない]にする(描画・当たり判定・保存・Scratch取り込みに反映)
- 見た目: 背景を[ ]にする / 背景を[ ]にして待つ / 次の背景にする / 背景の[番号/名前]
- イベント: 背景が[ ]に切り替わったとき(ステージのコスチューム変更でも起動)
- 音: [音程/左右にパン]の効果を変える・にする / 音の効果をなくす(音程±360・左右±100、再生中の音にも反映)
- 調べる: 音量(マイク) ※マイクが使えないときは -1。「音量(マイク)が[ ]より大きいとき」も使えます

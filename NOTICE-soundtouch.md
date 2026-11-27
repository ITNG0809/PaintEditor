# SoundTouchJS

- Version: 0.2.1 (unmodified ES module distribution)
- Source: https://github.com/cutterbl/SoundTouchJS
- Distribution: https://unpkg.com/soundtouchjs@0.2.1/dist/soundtouch.js
- License: GNU LGPL 2.1 or later; see `LICENSE` and the source header.
- Copyright: Olli Parviainen, Ryan Berdeen, Jakub Fiala, Steve “Cutter” Blades.

The library is loaded as a separate, replaceable module by `sound-dsp-worker.js`.
PaintEditor does not modify or bundle it into application code. Its original
source distribution and license are shipped alongside the application.


## 追記
音程・速度変更の処理は `sound-dsp-engines.js`（独自のWSOLA/位相ボコーダー/リサンプラー）が担当し、SoundTouch（LGPL）は「従来」「SoundTouch調整版」の選択時に引き続き使います。詳細は SOUND-QUALITY.md。

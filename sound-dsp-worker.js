import { renderWithInfo } from "./sound-dsp-engines.js";

// スピード/音程を実際のPCMとして書き出す（再生速度の変更ではない）。
// 処理本体は sound-dsp-engines.js。新エンジンが失敗したときは従来のSoundTouchへ自動で戻る。
self.onmessage = ({ data }) => {
  try {
    const { channels, sampleRate, tempo = 1, semitones = 0, engine = "auto", quality = "standard", material = "auto" } = data;
    const length = channels[0]?.length || 0;
    const outputLength = Math.max(1, Math.round(length / tempo));
    if (
      !length ||
      channels.length > 2 ||
      !Number.isFinite(tempo) ||
      tempo < 0.25 ||
      tempo > 4 ||
      !Number.isFinite(semitones) ||
      Math.abs(semitones) > 24 ||
      !Number.isFinite(sampleRate) ||
      sampleRate < 8000 ||
      sampleRate > 96000 ||
      outputLength / sampleRate > 600
    )
      throw Error("音声処理の範囲外です");
    let reported = -1;
    const progress = (f) => {
      const percent = Math.min(99, Math.floor(f * 100));
      if (percent !== reported) {
        self.postMessage({ progress: percent });
        reported = percent;
      }
    };
    const { channels: output, info } = renderWithInfo(channels, sampleRate, { tempo, semitones, engine, quality, material }, progress);
    self.postMessage(
      { channels: output, sampleRate, info },
      output.map((c) => c.buffer),
    );
  } catch (error) {
    self.postMessage({ error: error.message || String(error) });
  }
};

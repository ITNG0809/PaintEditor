import { SoundTouch } from "./soundtouch.js";

// Render real time-stretch/pitch-shifted PCM, not a playbackRate preview.
self.onmessage = ({ data }) => {
  try {
    const { channels, sampleRate, tempo = 1, semitones = 0 } = data;
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
    const output = channels.map(() => new Float32Array(outputLength));
    const engine = new SoundTouch();
    engine.stretch.setParameters(sampleRate, 0, 0, 8);
    engine.tempo = tempo;
    engine.pitchSemitones = semitones;
    const block = new Float32Array(8192 * 2);
    const extracted = new Float32Array(8192 * 2);
    let position = 0,
      written = 0,
      reported = -1;
    while (written < outputLength) {
      block.fill(0);
      const available = Math.min(8192, Math.max(0, length - position));
      for (let i = 0; i < available; i++) {
        block[i * 2] = channels[0][position + i];
        block[i * 2 + 1] = (channels[1] || channels[0])[position + i];
      }
      engine.inputBuffer.putSamples(block, 0, 8192);
      engine.process();
      position += 8192;
      while (engine.outputBuffer.frameCount && written < outputLength) {
        const n = Math.min(8192, engine.outputBuffer.frameCount, outputLength - written);
        engine.outputBuffer.receiveSamples(extracted, n);
        for (let i = 0; i < n; i++) {
          output[0][written + i] = extracted[i * 2];
          if (output[1]) output[1][written + i] = extracted[i * 2 + 1];
        }
        written += n;
      }
      const percent = Math.floor((written / outputLength) * 100);
      if (percent !== reported) {
        self.postMessage({ progress: percent });
        reported = percent;
      }
      // SoundTouch needs a real flush tail even for selections shorter than its window.
      if (position > length + sampleRate * 4 && written < outputLength)
        throw Error("音声の処理を完了できませんでした");
    }
    self.postMessage(
      { channels: output, sampleRate },
      output.map((c) => c.buffer),
    );
  } catch (error) {
    self.postMessage({ error: error.message || String(error) });
  }
};

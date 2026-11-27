/* MP4 / MOV の音声トラックだけを、必要な範囲だけ読み出す軽量デマルチプレクサ（動画音声抽出用）
 * 動画全体を読み込まず、moov（目次）と必要な音声サンプルだけを File.slice で読みます。
 * AAC は ADTS、MP3 は生フレーム列にして、ブラウザの decodeAudioData に渡せる形で返します。
 * 対応外の構成（断片化MP4・HE-AAC・AC-3 など）は unsupported エラーを投げ、呼び出し側が別の方式に切り替えます。 */
(function (global) {
  "use strict";
  const MAX_MOOV = 96 * 1024 * 1024;
  const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const unsupported = (m) => Object.assign(Error(m), { unsupported: true });
  const abortError = () => new DOMException("処理を中止しました", "AbortError");
  const ascii = (u8, p) => String.fromCharCode(u8[p], u8[p + 1], u8[p + 2], u8[p + 3]);
  async function readAt(file, pos, len) {
    return new Uint8Array(await file.slice(pos, Math.min(file.size, pos + len)).arrayBuffer());
  }
  function* children(u8, start = 0, end = u8.length) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let p = start;
    while (p + 8 <= end) {
      let size = dv.getUint32(p),
        hdr = 8;
      if (size === 1) {
        if (p + 16 > end) return;
        size = Number(dv.getBigUint64(p + 8));
        hdr = 16;
      } else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) return;
      yield { type: ascii(u8, p + 4), start: p + hdr, end: p + size };
      p += size;
    }
  }
  const child = (u8, box, type) => {
    for (const c of children(u8, box.start, box.end)) if (c.type === type) return c;
    return null;
  };
  async function findMoov(file) {
    const head = await readAt(file, 0, 12);
    if (head.length < 8) return null;
    if (!["ftyp", "moov", "mdat", "free", "skip", "wide", "pnot"].includes(ascii(head, 4))) return null;
    let pos = 0,
      fragmented = false;
    while (pos + 8 <= file.size) {
      const h = await readAt(file, pos, 16),
        dv = new DataView(h.buffer);
      let size = dv.getUint32(0),
        hdr = 8;
      const type = ascii(h, 4);
      if (size === 1) {
        if (h.length < 16) break;
        size = Number(dv.getBigUint64(8));
        hdr = 16;
      } else if (size === 0) size = file.size - pos;
      if (size < hdr) break;
      if (type === "moof") fragmented = true;
      if (type === "moov") {
        if (size > MAX_MOOV) throw unsupported("動画の管理情報が大きすぎます");
        return { moov: await readAt(file, pos + hdr, size - hdr), fragmented };
      }
      pos += size;
    }
    return null;
  }
  const descLen = (u8, p) => {
    let n = 0,
      i = 0;
    for (; i < 4; i++) {
      const b = u8[p + i];
      n = (n << 7) | (b & 127);
      if (!(b & 128)) break;
    }
    return [n, i + 1];
  };
  function parseEsds(u8, box) {
    let p = box.start + 4;
    if (u8[p] !== 3) throw unsupported("音声設定を読み取れません");
    let [, l] = descLen(u8, p + 1);
    p += 1 + l;
    const flags = u8[p + 2];
    p += 3;
    if (flags & 0x80) p += 2;
    if (flags & 0x40) p += 1 + u8[p];
    if (flags & 0x20) p += 2;
    if (u8[p] !== 4) throw unsupported("音声設定を読み取れません");
    [, l] = descLen(u8, p + 1);
    p += 1 + l;
    const oti = u8[p];
    p += 13;
    let asc = null;
    if (u8[p] === 5) {
      const [n, k] = descLen(u8, p + 1);
      asc = u8.subarray(p + 1 + k, p + 1 + k + n);
    }
    return { oti, asc };
  }
  function parseAsc(asc) {
    let bit = 0;
    const read = (n) => {
      let v = 0;
      for (let i = 0; i < n; i++, bit++) v = (v << 1) | ((asc[bit >> 3] >> (7 - (bit & 7))) & 1);
      return v;
    };
    if (!asc || asc.length < 2) throw unsupported("AACの設定がありません");
    let aot = read(5);
    if (aot === 31) aot = 32 + read(6);
    const idx = read(4);
    if (idx === 15) throw unsupported("特殊なサンプルレートのAACです");
    const channels = read(4);
    if (aot < 1 || aot > 4) throw unsupported("HE-AACなど、この方式で扱えないAACです");
    if (!channels || channels > 7) throw unsupported("このAACのチャンネル構成には対応していません");
    return { aot, idx, channels };
  }
  function findEsds(u8, start, end) {
    for (const c of children(u8, start, end)) {
      if (c.type === "esds") return c;
      if (c.type === "wave") {
        const r = findEsds(u8, c.start, c.end);
        if (r) return r;
      }
    }
    return null;
  }
  /** 音声トラックを解析する。MP4でなければ null。音声トラックが無ければ { noAudio:true } */
  async function open(file) {
    const found = await findMoov(file);
    if (!found) return null;
    if (found.fragmented) throw unsupported("断片化MP4には、この方式では対応していません");
    const u8 = found.moov,
      dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const full = { start: 0, end: u8.length };
    let movieScale = 1000;
    const mvhd = child(u8, full, "mvhd");
    if (mvhd) movieScale = dv.getUint32(mvhd.start + (u8[mvhd.start] === 1 ? 20 : 12)) || 1000;
    let hasTrack = false;
    for (const trak of children(u8, 0, u8.length)) {
      if (trak.type !== "trak") continue;
      const mdia = child(u8, trak, "mdia"),
        hdlr = mdia && child(u8, mdia, "hdlr");
      if (!hdlr || ascii(u8, hdlr.start + 8) !== "soun") continue;
      hasTrack = true;
      const mdhd = child(u8, mdia, "mdhd"),
        v1 = u8[mdhd.start] === 1,
        timescale = dv.getUint32(mdhd.start + (v1 ? 20 : 12)) || 1;
      const stbl = child(u8, child(u8, mdia, "minf"), "stbl");
      const stsd = child(u8, stbl, "stsd"),
        entry = stsd.start + 8,
        format = ascii(u8, entry + 4),
        entrySize = dv.getUint32(entry);
      if (format !== "mp4a") throw unsupported(`音声形式 ${format} には、この方式では対応していません`);
      const sver = dv.getUint16(entry + 16),
        extra = sver === 1 ? 16 : sver === 2 ? 36 : 0;
      const esds = findEsds(u8, entry + 36 + extra, entry + entrySize);
      if (!esds) throw unsupported("音声設定が見つかりません");
      const { oti, asc } = parseEsds(u8, esds);
      let kind, aac;
      if ([0x40, 0x66, 0x67, 0x68].includes(oti)) {
        kind = "aac";
        aac = parseAsc(asc);
      } else if ([0x69, 0x6b].includes(oti)) kind = "mp3";
      else throw unsupported("この音声コーデックには、この方式では対応していません");
      // サンプル表
      const stts = child(u8, stbl, "stts"),
        stsc = child(u8, stbl, "stsc"),
        stsz = child(u8, stbl, "stsz"),
        stco = child(u8, stbl, "stco") || child(u8, stbl, "co64");
      if (!stts || !stsc || !stsz || !stco) throw unsupported("サンプル表が見つかりません");
      const n = dv.getUint32(stsz.start + 8),
        constant = dv.getUint32(stsz.start + 4),
        sizes = new Uint32Array(n);
      for (let i = 0; i < n; i++) sizes[i] = constant || dv.getUint32(stsz.start + 12 + i * 4);
      const dts = new Float64Array(n + 1);
      let s = 0,
        t = 0;
      for (let e = 0, c = dv.getUint32(stts.start + 4); e < c && s < n; e++) {
        const count = dv.getUint32(stts.start + 8 + e * 8),
          delta = dv.getUint32(stts.start + 12 + e * 8);
        for (let k = 0; k < count && s < n; k++, s++) {
          dts[s] = t;
          t += delta;
        }
      }
      for (; s <= n; s++) dts[s] = t;
      const is64 = stco.type === "co64",
        chunks = dv.getUint32(stco.start + 4),
        offsets = new Float64Array(n),
        chunkOf = new Uint32Array(n),
        runs = dv.getUint32(stsc.start + 4);
      let sample = 0;
      for (let r = 0; r < runs; r++) {
        const first = dv.getUint32(stsc.start + 8 + r * 12),
          per = dv.getUint32(stsc.start + 12 + r * 12),
          last = r + 1 < runs ? dv.getUint32(stsc.start + 8 + (r + 1) * 12) - 1 : chunks;
        for (let c = first; c <= last && sample < n; c++) {
          let off = is64
            ? Number(dv.getBigUint64(stco.start + 8 + (c - 1) * 8))
            : dv.getUint32(stco.start + 8 + (c - 1) * 4);
          for (let k = 0; k < per && sample < n; k++, sample++) {
            offsets[sample] = off;
            chunkOf[sample] = c;
            off += sizes[sample];
          }
        }
      }
      if (sample < n || !n) throw unsupported("サンプル表が壊れています");
      // 編集リスト（先頭の無音・AACの先頭ずれ補正）
      let mediaTime = 0,
        delay = 0;
      const edts = child(u8, trak, "edts"),
        elst = edts && child(u8, edts, "elst");
      if (elst) {
        const ev = u8[elst.start] === 1,
          count = dv.getUint32(elst.start + 4);
        for (let e = 0; e < count; e++) {
          const p = elst.start + 8 + e * (ev ? 20 : 12);
          const dur = ev ? Number(dv.getBigUint64(p)) : dv.getUint32(p),
            mt = ev ? Number(dv.getBigInt64(p + 8)) : dv.getInt32(p + 4);
          if (mt === -1) delay += dur / movieScale;
          else {
            mediaTime = mt;
            break;
          }
        }
      }
      const pts = (i) => (dts[i] - mediaTime) / timescale + delay;
      const duration = pts(n);
      const rate = kind === "aac" ? RATES[aac.idx] : 0;
      return {
        kind,
        duration,
        channels: kind === "aac" ? aac.channels : 0,
        sampleRate: rate,
        samples: n,
        /** 秒 [start,end) に相当する音声を、デコード用のバイト列として取り出す */
        async extract(start, end, { onProgress = () => {}, signal } = {}) {
          // start 以前で最後のサンプル（二分探索）。AACは助走のため2フレーム前から読む
          let lo = 0,
            hi = n - 1;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (pts(mid) <= start) lo = mid;
            else hi = mid - 1;
          }
          const first = Math.max(0, lo - (kind === "aac" ? 2 : 1));
          let last = first;
          while (last < n - 1 && pts(last + 1) < end) last++;
          last = Math.min(n - 1, last + 1);
          const header = kind === "aac" ? 7 : 0;
          let total = 0;
          for (let i = first; i <= last; i++) total += sizes[i] + header;
          const out = new Uint8Array(total);
          let w = 0,
            i = first;
          while (i <= last) {
            if (signal?.aborted) throw abortError();
            // 同じチャンク内で連続する範囲をまとめて1回で読む
            let j = i;
            while (j < last && chunkOf[j + 1] === chunkOf[i]) j++;
            const bytes = await readAt(file, offsets[i], offsets[j] + sizes[j] - offsets[i]);
            let q = 0;
            for (let k = i; k <= j; k++) {
              if (q + sizes[k] > bytes.length) throw unsupported("動画ファイルが途中で切れています");
              if (kind === "aac") {
                const len = sizes[k] + 7;
                out[w++] = 0xff;
                out[w++] = 0xf1;
                out[w++] = ((aac.aot - 1) << 6) | (aac.idx << 2) | (aac.channels >> 2);
                out[w++] = ((aac.channels & 3) << 6) | (len >> 11);
                out[w++] = (len >> 3) & 255;
                out[w++] = ((len & 7) << 5) | 0x1f;
                out[w++] = 0xfc;
              }
              out.set(bytes.subarray(q, q + sizes[k]), w);
              w += sizes[k];
              q += sizes[k];
            }
            i = j + 1;
            onProgress((i - first) / (last - first + 1));
          }
          return { bytes: out, firstTime: pts(first) };
        },
      };
    }
    return hasTrack ? null : { noAudio: true, duration: 0 };
  }
  global.PaintMp4Audio = { open };
})(window);

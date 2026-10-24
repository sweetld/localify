// Chromaprint (AcoustID) fingerprint — algorithm 2 (TEST2), validated
// byte-for-byte against the `fpcalc` reference binary: both the raw
// subfingerprint array and the compressed base64 string match exactly.
// Regression test: .build/test.js (needs fpcalc on PATH).
// Pure JS, runs in the browser.
//
// Ported from Chromaprint (https://github.com/acoustid/chromaprint): the
// classifier tables, chroma pipeline and compressor format follow its
// MIT-licensed sources (fingerprinter_configuration.cpp, chroma*.cpp,
// image_builder.cpp, fingerprint_calculator.cpp, fingerprint_compressor.cpp).
// Nothing here derives from Chromaprint's LGPL parts (the bundled FFmpeg
// resampler / FFT); the resampler and FFT below are independent code.
//
//   Copyright (C) 2010-2016  Lukas Lalinsky
//
//   Permission is hereby granted, free of charge, to any person obtaining a
//   copy of this software and associated documentation files (the
//   "Software"), to deal in the Software without restriction, including
//   without limitation the rights to use, copy, modify, merge, publish,
//   distribute, sublicense, and/or sell copies of the Software, and to permit
//   persons to whom the Software is furnished to do so, subject to the
//   following conditions:
//
//   The above copyright notice and this permission notice shall be included
//   in all copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
//   OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
//   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
//   NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
//   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
//   USE OR OTHER DEALINGS IN THE SOFTWARE.
//
// Usage:
//   const fp = Chromaprint.fingerprint(float32mono, sampleRate);  // -> base64 string
//   // float32mono: Float32Array of mono PCM at any sample rate (auto-resampled to 11025)
//
// To fingerprint a decoded <audio> buffer:
//   const ch = audioBuffer.getChannelData(0);            // mono-ish (caller mixes)
//   const fp = Chromaprint.fingerprint(ch, audioBuffer.sampleRate);

(function (global) {
  "use strict";

  const MIN_FREQ = 28, MAX_FREQ = 3520;
  const FRAME_SIZE = 4096;
  const FRAME_OVERLAP = FRAME_SIZE - Math.floor(FRAME_SIZE / 3); // 2731 -> hop 1365
  const HOP = FRAME_SIZE - FRAME_OVERLAP;
  const TARGET_RATE = 11025;
  const NUM_BANDS = 12;

  const GRAYCODE = [0, 1, 3, 2];

  // Chroma filter (5-tap moving average), buffer length 8.
  const CHROMA_FILTER_COEFF = [0.25, 0.75, 1.0, 0.75, 0.25];
  const CHROMA_FILTER_LEN = 5;

  // Algorithm 2 classifiers: Filter(type, y, height, width), Quantizer(t0,t1,t2)
  const CLASSIFIERS = [
    [[0, 4, 3, 15], [1.98215, 2.35817, 2.63523]],
    [[4, 4, 6, 15], [-1.03809, -0.651211, -0.282167]],
    [[1, 0, 4, 16], [-0.298702, 0.119262, 0.558497]],
    [[3, 8, 2, 12], [-0.105439, 0.0153946, 0.135898]],
    [[3, 4, 4, 8], [-0.142891, 0.0258736, 0.200632]],
    [[4, 0, 3, 5], [-0.826319, -0.590612, -0.368214]],
    [[1, 2, 2, 9], [-0.557409, -0.233035, 0.0534525]],
    [[2, 7, 3, 4], [-0.0646826, 0.00620476, 0.0784847]],
    [[2, 6, 2, 16], [-0.192387, -0.029699, 0.215855]],
    [[2, 1, 3, 2], [-0.0397818, -0.00568076, 0.0292026]],
    [[5, 10, 1, 15], [-0.53823, -0.369934, -0.190235]],
    [[3, 6, 2, 10], [-0.124877, 0.0296483, 0.139239]],
    [[2, 1, 1, 14], [-0.101475, 0.0225617, 0.231971]],
    [[3, 5, 6, 4], [-0.0799915, -0.00729616, 0.063262]],
    [[1, 9, 2, 12], [-0.272556, 0.019424, 0.302559]],
    [[3, 4, 2, 14], [-0.164292, -0.0321188, 0.0846339]]
  ];

  function log2(x) { return Math.log(x) / Math.LN2; }

  // --- simple linear resampler to TARGET_RATE (good enough; fpcalc uses avresample) ---
  function resample(input, inRate) {
    if (inRate === TARGET_RATE) return input;
    const ratio = TARGET_RATE / inRate;
    const outLen = Math.max(1, Math.floor(input.length * ratio));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const src = i / ratio;
      const i0 = Math.floor(src);
      const i1 = Math.min(input.length - 1, i0 + 1);
      const frac = src - i0;
      out[i] = input[i0] * (1 - frac) + input[i1] * frac;
    }
    return out;
  }

  // --- Hamming window ---
  function hamming(n) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.54 - 0.46 * Math.cos((i * 2 * Math.PI) / (n - 1));
    return w;
  }

  // --- FFT (iterative radix-2) ---
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let curR = 1, curI = 0;
        for (let k = 0; k < len / 2; k++) {
          const aR = re[i + k], aI = im[i + k];
          const bR = re[i + k + len / 2], bI = im[i + k + len / 2];
          const tR = bR * curR - bI * curI;
          const tI = bR * curI + bI * curR;
          re[i + k] = aR + tR; im[i + k] = aI + tI;
          re[i + k + len / 2] = aR - tR; im[i + k + len / 2] = aI - tI;
          const nR = curR * wr - curI * wi;
          curI = curR * wi + curI * wr;
          curR = nR;
        }
      }
    }
  }

  function freqToOctave(freq, base) { return Math.log(freq / base) / Math.LN2; }

  // Precompute chroma note mapping for a given sample rate / frame size.
  function buildNotes(sampleRate) {
    const base = 440 / 16.0;
    const notes = new Int8Array(FRAME_SIZE / 2);
    const minIndex = Math.max(1, Math.round(FRAME_SIZE * MIN_FREQ / sampleRate));
    const maxIndex = Math.min(FRAME_SIZE / 2, Math.round(FRAME_SIZE * MAX_FREQ / sampleRate));
    for (let i = minIndex; i < maxIndex; i++) {
      const freq = (i * sampleRate) / FRAME_SIZE;
      const octave = freqToOctave(freq, base);
      let note = NUM_BANDS * (octave - Math.floor(octave));
      notes[i] = ((note | 0) % NUM_BANDS + NUM_BANDS) % NUM_BANDS; // truncate toward zero, like (char)
    }
    return { notes, minIndex, maxIndex };
  }

  function euclidNorm(v) {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    return s > 0 ? Math.sqrt(s) : 0;
  }

  // Integral-image area given a flat row-major (rows+1) x (12) image with +1 padding.
  function area(img, rows, r1, c1, r2, c2) {
    if (r1 === r2 || c1 === c2) return 0;
    const W = NUM_BANDS + 1;
    const at = (r, c) => img[r * W + c];
    if (r1 === 0) {
      if (c1 === 0) return at(r2, c2);
      return at(r2, c2) - at(r2, c1);
    } else {
      if (c1 === 0) return at(r2, c2) - at(r1, c2);
      return at(r2, c2) - at(r1, c2) - at(r2, c1) + at(r1, c1);
    }
  }

  function subfingerprint(img, rows, offset) {
    let bits = 0;
    for (const [f, q] of CLASSIFIERS) {
      const type = f[0], y = f[1], h = f[2], w = f[3];
      let a, b;
      switch (type) {
        case 0: a = area(img, rows, offset, y, offset + w, y + h); b = 0; break;
        case 1: a = area(img, rows, offset, y + (h >> 1), offset + w, y + h);
                b = area(img, rows, offset, y, offset + w, y + (h >> 1)); break;
        case 2: a = area(img, rows, offset + (w >> 1), y, offset + w, y + h);
                b = area(img, rows, offset, y, offset + (w >> 1), y + h); break;
        case 3: a = area(img, rows, offset, y + (h >> 1), offset + (w >> 1), y + h) +
                      area(img, rows, offset + (w >> 1), y, offset + w, y + (h >> 1));
                b = area(img, rows, offset, y, offset + (w >> 1), y + (h >> 1)) +
                    area(img, rows, offset + (w >> 1), y + (h >> 1), offset + w, y + h); break;
        case 4: a = area(img, rows, offset, y + Math.floor(h / 3), offset + w, y + 2 * Math.floor(h / 3));
                b = area(img, rows, offset, y, offset + w, y + Math.floor(h / 3)) +
                    area(img, rows, offset, y + 2 * Math.floor(h / 3), offset + w, y + h); break;
        case 5: a = area(img, rows, offset + Math.floor(w / 3), y, offset + 2 * Math.floor(w / 3), y + h);
                b = area(img, rows, offset, y, offset + Math.floor(w / 3), y + h) +
                    area(img, rows, offset + 2 * Math.floor(w / 3), y, offset + w, y + h); break;
        default: a = 0; b = 0;
      }
      const val = Math.log((1 + a) / (1 + b));
      let qv;
      if (val < q[1]) qv = (val < q[0]) ? 0 : 1;
      else qv = (val < q[2]) ? 2 : 3;
      bits = (bits << 2) | GRAYCODE[qv];
    }
    return bits >>> 0;
  }

  function computeFingerprint(samples, sampleRate) {
    const sig = resample(samples, sampleRate);
    const win = hamming(FRAME_SIZE);
    const { notes, minIndex, maxIndex } = buildNotes(TARGET_RATE);
    const W = NUM_BANDS + 1;

    // Build chroma rows
    const chromaRows = [];
    for (let pos = 0; pos + FRAME_SIZE <= sig.length; pos += HOP) {
      const re = new Float32Array(FRAME_SIZE);
      const im = new Float32Array(FRAME_SIZE);
      for (let i = 0; i < FRAME_SIZE; i++) re[i] = sig[pos + i] * win[i];
      fft(re, im);
      const mag = new Float32Array(FRAME_SIZE / 2);
      for (let i = 0; i < FRAME_SIZE / 2; i++) mag[i] = re[i] * re[i] + im[i] * im[i];
      // chroma (no interpolation for algo 2)
      const feat = new Float64Array(NUM_BANDS);
      for (let i = minIndex; i < maxIndex; i++) feat[notes[i]] += mag[i];
      chromaRows.push(feat);
    }
    if (!chromaRows.length) return new Int32Array(0);

    // 5-tap moving-average chroma filter over a ring buffer of 8, THEN
    // Euclidean normalization. Order matters: chromaprint's pipeline is
    // Chroma -> ChromaFilter -> ChromaNormalizer -> ImageBuilder, so the filter
    // runs on raw band energies and only the filtered row gets normalized.
    const outRows = [];
    const ring = [];
    for (let r = 0; r < chromaRows.length; r++) {
      ring.push(chromaRows[r]);
      if (ring.length > 8) ring.shift();
      if (ring.length >= CHROMA_FILTER_LEN) {
        const off = (ring.length - CHROMA_FILTER_LEN) % 8;
        const res = new Float64Array(NUM_BANDS);
        for (let i = 0; i < NUM_BANDS; i++) {
          let s = 0;
          for (let j = 0; j < CHROMA_FILTER_LEN; j++) s += ring[(off + j) % 8][i] * CHROMA_FILTER_COEFF[j];
          res[i] = s;
        }
        // normalize (Euclidean, floor 0.01)
        const norm = euclidNorm(res);
        if (norm < 0.01) res.fill(0); else for (let i = 0; i < NUM_BANDS; i++) res[i] /= norm;
        outRows.push(res);
      }
    }
    if (!outRows.length) return new Int32Array(0);

    // Integral image: (rows+1) x (12+1)
    const H = outRows.length;
    const img = new Float64Array((H + 1) * W);
    for (let x = 0; x < H; x++) {
      for (let y = 0; y < NUM_BANDS; y++) {
        const v = outRows[x][y];
        img[(x + 1) * W + (y + 1)] = v + img[x * W + (y + 1)] + img[(x + 1) * W + y] - img[x * W + y];
      }
    }

    const maxFilterWidth = Math.max(...CLASSIFIERS.map(c => c[0][3]));
    const length = H - maxFilterWidth + 1;
    const raw = new Int32Array(Math.max(0, length));
    for (let offset = 0; offset < length; offset++) raw[offset] = subfingerprint(img, H, offset);
    return raw;
  }

  // Chromaprint's wire format (fingerprint_compressor.cpp), which is what the
  // AcoustID web service parses. A raw uint32 dump is NOT accepted.
  //
  //   byte 0      : algorithm id (TEST2 == 1, what fpcalc emits by default)
  //   bytes 1..3  : subfingerprint count, big-endian
  //   then        : "normal" bits, 3 each, LSB-first packed, byte-flushed
  //   then        : "exception" bits, 5 each, same packing
  //
  // Each subfingerprint is XOR'd against its predecessor, then encoded as the
  // gaps between its set bits (0 terminates a value). A gap >= 7 writes 7 into
  // the normal stream and the remainder into the exception stream.
  const MAX_NORMAL_VALUE = 7;
  const ALGORITHM_TEST2 = 1;

  function bitPacker(bitsPerValue) {
    const bytes = [];
    let acc = 0, used = 0;
    return {
      bytes,
      write(x) {
        acc |= (x << used) >>> 0;
        used += bitsPerValue;
        while (used >= 8) { bytes.push(acc & 255); acc >>>= 8; used -= 8; }
      },
      flush() {
        while (used > 0) { bytes.push(acc & 255); acc >>>= 8; used -= 8; }
        acc = 0; used = 0;
      }
    };
  }

  function compressRaw(raw, algorithm) {
    const normal = [], exceptional = [];
    const encode = (x) => {
      x = x >>> 0;
      let bit = 1, lastBit = 0;
      while (x !== 0) {
        if (x & 1) {
          const value = bit - lastBit;
          if (value >= MAX_NORMAL_VALUE) {
            normal.push(MAX_NORMAL_VALUE);
            exceptional.push(value - MAX_NORMAL_VALUE);
          } else {
            normal.push(value);
          }
          lastBit = bit;
        }
        x >>>= 1;
        bit++;
      }
      normal.push(0);
    };
    if (raw.length) {
      encode(raw[0]);
      for (let i = 1; i < raw.length; i++) encode((raw[i] ^ raw[i - 1]) >>> 0);
    }

    const n = raw.length;
    const out = [
      (algorithm === undefined ? ALGORITHM_TEST2 : algorithm) & 255,
      (n >> 16) & 255, (n >> 8) & 255, n & 255
    ];
    const p3 = bitPacker(3);
    for (let i = 0; i < normal.length; i++) p3.write(normal[i]);
    p3.flush();
    const p5 = bitPacker(5);
    for (let i = 0; i < exceptional.length; i++) p5.write(exceptional[i]);
    p5.flush();
    return Uint8Array.from(out.concat(p3.bytes, p5.bytes));
  }

  // AcoustID expects URL-safe base64 with the padding stripped.
  function base64FromBytes(bytes) {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function compressBase64(raw) { return base64FromBytes(compressRaw(raw)); }

  function fingerprint(samples, sampleRate) {
    const raw = computeFingerprint(samples, sampleRate);
    if (!raw.length) return "";
    return compressBase64(raw);
  }

  global.Chromaprint = {
    computeFingerprint,
    compressRaw,
    compressBase64,
    fingerprint
  };
})(typeof window !== "undefined" ? window : globalThis);

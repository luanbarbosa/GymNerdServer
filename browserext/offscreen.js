chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "gif-to-webp") return;

  gifToAnimatedWebp(message.dataUrl, message.quality).then(
    (dataUrl) => sendResponse({ dataUrl }),
    (err) => sendResponse({ error: String(err) })
  );
  return true;
});

async function gifToAnimatedWebp(gifDataUrl, quality) {
  const data = await (await fetch(gifDataUrl)).arrayBuffer();
  const decoder = new ImageDecoder({ data, type: "image/gif" });
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack;

  let width = 0;
  let height = 0;
  let hasAlpha = false;
  const frames = [];

  // ImageDecoder yields fully composited canvas-sized frames, so each ANMF frame
  // sits at 0,0 and replaces the previous one without blending.
  for (let i = 0; i < track.frameCount; i++) {
    const { image } = await decoder.decode({ frameIndex: i });
    width = image.displayWidth;
    height = image.displayHeight;
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d").drawImage(image, 0, 0);
    const durationMs = Math.round((image.duration ?? 0) / 1000);
    image.close();

    const webp = await canvas.convertToBlob({ type: "image/webp", quality });
    const chunks = bitstreamChunks(new Uint8Array(await webp.arrayBuffer()));
    hasAlpha ||= chunks.some((c) => c.fourcc !== "VP8 ");
    // Browsers play GIF delays of <=10ms at 100ms; keep that timing.
    frames.push({ chunks, durationMs: durationMs <= 10 ? 100 : durationMs });
  }
  decoder.close();

  // WebP loop count 0 = forever; otherwise total plays.
  const loopCount = track.repetitionCount === Infinity ? 0 : Math.min(track.repetitionCount + 1, 0xffff);
  return toDataUrl(muxAnimatedWebp({ width, height, hasAlpha, loopCount, frames }));
}

// Keeps the ALPH/VP8/VP8L chunks (header + padding included) of a still webp.
function bitstreamChunks(webp) {
  const view = new DataView(webp.buffer, webp.byteOffset, webp.byteLength);
  const chunks = [];
  for (let offset = 12; offset + 8 <= webp.length; ) {
    const fourcc = String.fromCharCode(...webp.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size + (size & 1);
    if (fourcc === "ALPH" || fourcc === "VP8 " || fourcc === "VP8L") {
      chunks.push({ fourcc, bytes: webp.subarray(offset, end) });
    }
    offset = end;
  }
  return chunks;
}

function muxAnimatedWebp({ width, height, hasAlpha, loopCount, frames }) {
  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x02 | (hasAlpha ? 0x10 : 0); // animation + alpha flags
  writeUint24(vp8x, 4, width - 1);
  writeUint24(vp8x, 7, height - 1);

  const anim = new Uint8Array(6); // background color 0 (transparent)
  new DataView(anim.buffer).setUint16(4, loopCount, true);

  const anmfs = frames.map(({ chunks, durationMs }) => {
    const header = new Uint8Array(16); // frame x/y offsets stay 0
    writeUint24(header, 6, width - 1);
    writeUint24(header, 9, height - 1);
    writeUint24(header, 12, durationMs);
    header[15] = 0x02; // do not blend, do not dispose
    return chunk("ANMF", concat([header, ...chunks.map((c) => c.bytes)]));
  });

  const body = concat([chunk("VP8X", vp8x), chunk("ANIM", anim), ...anmfs]);
  const riff = new Uint8Array(12);
  riff.set(asciiBytes("RIFF"), 0);
  new DataView(riff.buffer).setUint32(4, 4 + body.length, true);
  riff.set(asciiBytes("WEBP"), 8);
  return concat([riff, body]);
}

function chunk(fourcc, payload) {
  const out = new Uint8Array(8 + payload.length + (payload.length & 1));
  out.set(asciiBytes(fourcc), 0);
  new DataView(out.buffer).setUint32(4, payload.length, true);
  out.set(payload, 8);
  return out;
}

function writeUint24(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
}

function asciiBytes(text) {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function toDataUrl(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:image/webp;base64,${btoa(binary)}`;
}

function mask(source: Buffer, mask: Buffer, output: Buffer, offset: number, length: number): void {
  for (let i = 0; i < length; i++) output[offset + i] = source[i] ^ mask[i & 3];
}

function unmask(buffer: Buffer, mask: Buffer): void {
  for (let i = 0; i < buffer.length; i++) buffer[i] ^= mask[i & 3];
}

function concat(buffers: Buffer[], totalLength: number): Buffer {
  if (buffers.length === 0) return Buffer.alloc(0);
  if (buffers.length === 1) return buffers[0];
  const result = Buffer.allocUnsafe(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    buf.copy(result, offset);
    offset += buf.length;
  }
  return result;
}

export default { mask, unmask, concat };

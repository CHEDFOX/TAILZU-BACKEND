/**
 * THE TWO SMALL READERS APP ATTEST NEEDS, AND NOTHING MORE (docs/trust.md §App Attest).
 *
 * Apple's attestation object is CBOR, and the nonce it must agree with sits in an X.509 extension, which is DER. Rather than
 * take on a CBOR library and an ASN.1 library for one object and one extension, this file reads just enough of each:
 *
 *   decodeCbor(buf)             unsigned numbers, byte strings, text, arrays, maps, true/false/null. No tags, no floats,
 *                               no indefinite lengths — Apple sends none of them, and anything else is refused outright.
 *   derExtension(cert, oid)     one extension's bytes out of a certificate, by its object identifier
 *   oidToDer("1.2.840…")        an identifier as the bytes a certificate holds (so no hand-typed constant can be wrong)
 *
 * Both readers refuse anything they do not understand instead of guessing: this is parsing input from outside, so every
 * length is checked against what is really there and nothing is read past the end of the buffer.
 */

// ------------------------------------------------------------------ CBOR

export type CborValue = number | string | Buffer | boolean | null | CborValue[] | Map<string | number, CborValue>;

interface Read { value: CborValue; next: number }

const need = (buf: Buffer, at: number, n: number): void => {
  if (at + n > buf.length) throw new Error("cbor: ran off the end");
};

function readLength(buf: Buffer, at: number, extra: number): { length: number; next: number } {
  if (extra < 24) return { length: extra, next: at };
  if (extra === 24) { need(buf, at, 1); return { length: buf[at]!, next: at + 1 }; }
  if (extra === 25) { need(buf, at, 2); return { length: buf.readUInt16BE(at), next: at + 2 }; }
  if (extra === 26) { need(buf, at, 4); return { length: buf.readUInt32BE(at), next: at + 4 }; }
  throw new Error("cbor: a length this file does not read");
}

function readItem(buf: Buffer, at: number): Read {
  need(buf, at, 1);
  const head = buf[at]!;
  const major = head >> 5;
  const extra = head & 0x1f;
  let p = at + 1;
  if (major === 0) {
    const { length, next } = readLength(buf, p, extra);
    return { value: length, next };
  }
  if (major === 2 || major === 3) {
    const { length, next } = readLength(buf, p, extra);
    need(buf, next, length);
    const bytes = buf.subarray(next, next + length);
    return { value: major === 2 ? Buffer.from(bytes) : bytes.toString("utf8"), next: next + length };
  }
  if (major === 4) {
    const { length, next } = readLength(buf, p, extra);
    const out: CborValue[] = [];
    p = next;
    for (let i = 0; i < length; i++) {
      const got = readItem(buf, p);
      out.push(got.value);
      p = got.next;
    }
    return { value: out, next: p };
  }
  if (major === 5) {
    const { length, next } = readLength(buf, p, extra);
    const out = new Map<string | number, CborValue>();
    p = next;
    for (let i = 0; i < length; i++) {
      const key = readItem(buf, p);
      const val = readItem(buf, key.next);
      if (typeof key.value !== "string" && typeof key.value !== "number") throw new Error("cbor: a key this file does not read");
      out.set(key.value, val.value);
      p = val.next;
    }
    return { value: out, next: p };
  }
  if (major === 7) {
    if (extra === 20) return { value: false, next: p };
    if (extra === 21) return { value: true, next: p };
    if (extra === 22) return { value: null, next: p };
    throw new Error("cbor: a simple value this file does not read");
  }
  throw new Error(`cbor: major type ${major} is not read here`);
}

/** The whole buffer as one CBOR value. Trailing bytes are refused: an attestation object is exactly one object. */
export function decodeCbor(buf: Buffer): CborValue {
  const got = readItem(buf, 0);
  if (got.next !== buf.length) throw new Error("cbor: bytes left over");
  return got.value;
}

/** A map's entry, typed. */
export function mapGet(v: CborValue, key: string): CborValue | undefined {
  return v instanceof Map ? v.get(key) : undefined;
}

// ------------------------------------------------------------------ DER

export interface Tlv { tag: number; start: number; end: number; next: number }

/** One tag-length-value at `at`: where its contents start and end, and where the next one begins. */
export function tlv(buf: Buffer, at: number): Tlv {
  need(buf, at, 2);
  const tag = buf[at]!;
  let p = at + 1;
  let len = buf[p]!;
  p += 1;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error("der: a length this file does not read");
    need(buf, p, n);
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[p + i]!;
    p += n;
  }
  need(buf, p, len);
  return { tag, start: p, end: p + len, next: p + len };
}

/** Every tag-length-value inside a constructed one. */
export function children(buf: Buffer, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  let p = parent.start;
  while (p < parent.end) {
    const got = tlv(buf, p);
    out.push(got);
    p = got.next;
  }
  return out;
}

/** An object identifier ("1.2.840.113635.100.8.2") as the bytes a certificate holds, without the tag or length. */
export function oidToDer(oid: string): Buffer {
  const parts = oid.split(".").map(Number);
  if (parts.length < 2 || parts.some((n) => !Number.isInteger(n) || n < 0)) throw new Error("der: not an object identifier");
  const out: number[] = [parts[0]! * 40 + parts[1]!];
  for (const n of parts.slice(2)) {
    const groups: number[] = [];
    let v = n;
    do { groups.unshift(v & 0x7f); v = Math.floor(v / 128); } while (v > 0);
    for (let i = 0; i < groups.length - 1; i++) groups[i]! |= 0x80;
    out.push(...groups);
  }
  return Buffer.from(out);
}

/**
 * One extension's value out of a certificate, by its identifier. Certificate → TBSCertificate → the [3] extensions →
 * SEQUENCE of { OID, critical?, OCTET STRING value }. Returns the octet string's contents, or null when it is not there.
 */
export function derExtension(cert: Buffer, oid: string): Buffer | null {
  const want = oidToDer(oid);
  const certificate = tlv(cert, 0);
  const tbs = children(cert, certificate)[0];
  if (!tbs) return null;
  const extensionsWrapper = children(cert, tbs).find((c) => c.tag === 0xa3);
  if (!extensionsWrapper) return null;
  const list = children(cert, extensionsWrapper)[0];
  if (!list) return null;
  for (const ext of children(cert, list)) {
    const parts = children(cert, ext);
    const id = parts[0];
    if (!id || id.tag !== 0x06) continue;
    if (!cert.subarray(id.start, id.end).equals(want)) continue;
    const value = parts.find((p) => p.tag === 0x04);
    if (!value) return null;
    return Buffer.from(cert.subarray(value.start, value.end));
  }
  return null;
}

/**
 * The 32-byte nonce inside Apple's extension: SEQUENCE { [1] { OCTET STRING nonce } }. Read by walking to the first octet
 * string of exactly 32 bytes rather than by assuming the nesting, so a change in Apple's wrapping does not break it quietly.
 */
export function nonceFromExtension(value: Buffer): Buffer | null {
  const found: Buffer[] = [];
  const walk = (buf: Buffer, from: number, to: number, depth: number): void => {
    if (depth > 6) return;
    let p = from;
    while (p < to) {
      let got: Tlv;
      try { got = tlv(buf, p); } catch { return; }
      if (got.tag === 0x04 && got.end - got.start === 32) found.push(Buffer.from(buf.subarray(got.start, got.end)));
      // 0x30 SEQUENCE, 0x31 SET, and the context tags Apple uses are all constructed.
      if ((got.tag & 0x20) !== 0 || got.tag === 0x30 || got.tag === 0x31) walk(buf, got.start, got.end, depth + 1);
      p = got.next;
    }
  };
  walk(value, 0, value.length, 0);
  return found[0] ?? null;
}

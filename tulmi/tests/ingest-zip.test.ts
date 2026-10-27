/**
 * THE ZIP READER AND ITS GUARDS AGAINST A BOMB (src/media/zip.ts).
 *
 *   - entry count, declared total size, per-entry and whole-archive expansion ratio, zip64 sizes: all refused from the directory, before one byte is inflated
 *   - an entry that turns out bigger than it said is a lie about its size, and refused while inflating (the output is cut off, never built)
 *   - an encrypted entry is a password-protected archive; a name that would leave the folder is marked and never read; nested archives are listed, not opened
 *   - damaged archives say so; a good one reads back exactly, and its checksums are checked
 */
import { describe, expect, it } from "vitest";
import { peekEntry, readEntry, readZip, unsafeName } from "../src/media/zip.js";
import { ZIP } from "../src/media/types.js";
import { zip } from "./ingest-rig.js";

const code = (fn: () => unknown): string => { try { fn(); return "none"; } catch (e) { return (e as { code?: string }).code ?? "other"; } };
const MB = 1024 * 1024;

describe("a good archive", () => {
  it("lists its entries and reads them back, stored or deflated", () => {
    const z = zip([{ name: "a.txt", data: "hello world" }, { name: "dir/", dir: true }, { name: "dir/b.md", data: "# b", method: 0 }]);
    const { entries } = readZip(z);
    expect(entries.map((e) => [e.path, e.dir, e.method])).toEqual([["a.txt", false, 8], ["dir/", true, 0], ["dir/b.md", false, 0]]);
    expect(readEntry(z, entries[0]!, 1000).toString()).toBe("hello world");
    expect(readEntry(z, entries[2]!, 1000).toString()).toBe("# b");
    expect(peekEntry(z, entries[0]!, 5).toString()).toBe("hello");
  });

  it("checks the checksum of what it inflates", () => {
    const z = zip([{ name: "a.txt", data: "hello world", method: 0 }]);
    const { entries } = readZip(z);
    const at = z.indexOf("hello world");
    z[at] = 0x48; // 'H': the bytes are no longer what the checksum was made of
    expect(code(() => readEntry(z, entries[0]!, 100))).toBe("corrupt");
  });

  it("peeks at a large entry without inflating all of it", () => {
    const z = zip([{ name: "big.txt", data: Buffer.alloc(200_000, 0x61) }]);
    const { entries } = readZip(z);
    expect(peekEntry(z, entries[0]!, 16).toString()).toBe("aaaaaaaaaaaaaaaa");
  });
});

describe("a bomb", () => {
  it("an entry that would grow more than 100 times is refused from the directory", () => {
    const z = zip([{ name: "zeros.bin", data: Buffer.alloc(3 * MB) }]);
    expect(code(() => readZip(z))).toBe("bomb");
    try { readZip(z); } catch (e) { expect((e as Error).message).toMatch(/zip bomb/); expect((e as Error).message).toMatch(/zeros\.bin/); }
  });

  it("a small file that grows a lot is allowed (a megabyte or less), a big one is not", () => {
    expect(code(() => readZip(zip([{ name: "z.txt", data: Buffer.alloc(900_000) }])))).toBe("none");
    expect(code(() => readZip(zip([{ name: "z.txt", data: Buffer.alloc(1_500_000) }])))).toBe("bomb");
  });

  it("more entries than the limit is refused, by the count it claims and by the entries it has", () => {
    const many = zip(Array.from({ length: ZIP.entriesMax + 1 }, (_, i) => ({ name: `f${i}.txt`, data: "x" })));
    expect(code(() => readZip(many))).toBe("bomb");
    // The end record claims 65,000 files; the directory is not walked that far.
    expect(code(() => readZip(zip([{ name: "a", data: "x" }], { claimCount: 65_000 })))).toBe("bomb");
  });

  it("sizes that add up to more than the limit once opened are refused, whatever is really in the file", () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}`, data: "x", claimSize: 50 * MB, claimCompressed: 40 * MB }));
    expect(code(() => readZip(zip(entries)))).toBe("bomb");
  });

  it("a size of 4 GB or more (the zip64 marker) is refused as it stands", () => {
    const z = zip([{ name: "huge", data: "x", claimSize: 5 * 1024 * MB }], { zip64: true });
    expect(code(() => readZip(z))).toBe("bomb");
  });

  it("an entry that is bigger than it says is a lie, caught while inflating", () => {
    // The directory says 10 bytes; the data inflates to 200,000.
    const z = zip([{ name: "liar.txt", data: Buffer.alloc(200_000, 0x41), claimSize: 10 }]);
    const { entries } = readZip(z);
    expect(code(() => readEntry(z, entries[0]!, 1 * MB))).toBe("bomb");
  });

  it("an entry bigger than the most asked for is refused without being inflated", () => {
    const z = zip([{ name: "a.txt", data: Buffer.alloc(5000, 0x41) }]);
    const { entries } = readZip(z);
    expect(code(() => readEntry(z, entries[0]!, 1000))).toBe("bomb");
  });

  it("the whole archive growing more than 100 times is refused, even when no one entry is over the line", () => {
    // 30 files of 400 KB of zeros: each is 400 KB (under the per-entry line) but together 12 MB from about 10 KB.
    const z = zip(Array.from({ length: 30 }, (_, i) => ({ name: `z${i}.bin`, data: Buffer.alloc(400_000) })));
    expect(code(() => readZip(z))).toBe("bomb");
  });
});

describe("other things that are wrong with an archive", () => {
  it("an encrypted entry is a password-protected archive", () => {
    const z = zip([{ name: "secret.txt", data: "x", flags: 1 }]);
    try { readZip(z); expect.unreachable(); } catch (e) {
      expect((e as { code: string }).code).toBe("password");
      expect((e as Error).message).toMatch(/password-protected/);
    }
  });

  it("marks a name that would leave the folder, and will not read it", () => {
    const z = zip([{ name: "../../etc/passwd", data: "x" }, { name: "/abs.txt", data: "x" }, { name: "a\\b.txt", data: "x" }, { name: "C:evil", data: "x" }, { name: "fine/ok.txt", data: "x" }]);
    const { entries } = readZip(z);
    expect(entries.map((e) => e.unsafe)).toEqual([true, true, true, true, false]);
    expect(code(() => readEntry(z, entries[0]!, 100))).toBe("bad_request");
    expect(peekEntry(z, entries[0]!).length).toBe(0);
    expect(unsafeName("a/../b")).toBe(true);
    expect(unsafeName("a/..b/c")).toBe(false);
  });

  it("lists a nested archive without opening it", () => {
    const inner = zip([{ name: "x.txt", data: "inner" }]);
    const outer = zip([{ name: "inner.zip", data: inner }]);
    const { entries } = readZip(outer);
    expect(entries).toHaveLength(1);
    expect(readEntry(outer, entries[0]!, MB).subarray(0, 2).toString()).toBe("PK");
  });

  it("says a damaged archive is damaged", () => {
    expect(code(() => readZip(Buffer.from("PK\x03\x04 not really a zip at all, just text"))))
      .toBe("corrupt");
    const z = zip([{ name: "a.txt", data: "hello" }]);
    expect(code(() => readZip(z.subarray(0, z.length - 10)))).toBe("corrupt");
    expect(code(() => readZip(Buffer.alloc(5)))).toBe("corrupt");
  });

  it("a split archive is not supported", () => {
    const z = zip([{ name: "a.txt", data: "hello" }]);
    z.writeUInt16LE(1, z.length - 22 + 4); // this disk number
    expect(code(() => readZip(z))).toBe("unsupported");
  });
});

/**
 * LICENCES: WHAT A PACKAGE SAYS IT IS, AS AN SPDX ID, AND WHETHER A PROJECT CAN USE IT.
 *
 * A registry says a licence in whatever way its author typed it: "MIT", "Apache
 * 2.0", "(MIT OR Apache-2.0)", "BSD", "GPLv3", "SEE LICENSE IN LICENSE.md", a
 * classifier ("License :: OSI Approved :: MIT License"), or nothing. normalise()
 * turns that into an SPDX expression where it can, and judge() scores it against
 * an allowlist:
 *
 *   ok           MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense and
 *                MPL-2.0 (and a few as plainly permissive: CC0-1.0, Zlib, BSL-1.0,
 *                BlueOak-1.0.0, PSF-2.0, Python-2.0)
 *   warn         LGPL (fine to link, not to modify and keep), EPL, CDDL and the other
 *                weak copyleft, and anything unknown
 *   strong_warn  GPL and AGPL, for a project that is not itself open source: they
 *                would make the project's own code subject to the same terms. (For a
 *                project that is open source under a compatible licence they are a
 *                plain warn.)
 *   unknown      no licence stated, or one that cannot be read. An unlicensed package
 *                is all rights reserved by default, so it is a warn and not an ok
 *
 * "A OR B" is as good as the better of the two (the user may pick); "A AND B" is as
 * bad as the worse. This is a screen, not legal advice, and the reason strings say
 * so by saying "check" and not "you may not".
 *
 * Pure.
 */

export type LicenceLevel = "ok" | "warn" | "strong_warn" | "unknown";

export interface LicenceVerdict {
  /** The SPDX expression, or null when none could be read. */
  spdx: string | null;
  level: LicenceLevel;
  /** One short clause a person can read. */
  note: string;
}

const OK = new Set([
  "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Unlicense", "MPL-2.0", "CC0-1.0", "Zlib", "BSL-1.0", "BlueOak-1.0.0", "PSF-2.0", "Python-2.0",
]);

const ALIASES: Array<[RegExp, string]> = [
  [/^(?:the )?mit(?: license| licence)?$/i, "MIT"],
  [/^expat$/i, "MIT"],
  [/^apache(?:[- ]?(?:license|licence))?[- ]?(?:v|version )?2(?:\.0)?(?: license| licence)?$/i, "Apache-2.0"],
  [/^apache[- ]?2$/i, "Apache-2.0"],
  [/^bsd[- ]?2[- ]?(?:clause)?(?: license| licence)?$/i, "BSD-2-Clause"],
  [/^(?:new |modified |revised |simplified )?bsd[- ]?3[- ]?(?:clause)?(?: license| licence)?$/i, "BSD-3-Clause"],
  [/^bsd(?: license| licence)?$/i, "BSD-3-Clause"],
  [/^isc(?: license| licence)?$/i, "ISC"],
  [/^0bsd$/i, "0BSD"],
  [/^(?:the )?unlicense(?:d)?$/i, "Unlicense"],
  [/^mpl[- ]?2(?:\.0)?(?: license| licence)?$/i, "MPL-2.0"],
  [/^mozilla public license,? (?:v|version )?2(?:\.0)?$/i, "MPL-2.0"],
  [/^cc0(?:[- ]1\.0)?$/i, "CC0-1.0"],
  [/^zlib(?:\/libpng)?$/i, "Zlib"],
  [/^psf(?:[- ]2\.0)?$|^python software foundation license$/i, "PSF-2.0"],
  [/^lgpl[- ]?(?:v|version )?2\.1(?:[- ]?(?:only|or[- ]later|\+))?$/i, "LGPL-2.1-only"],
  [/^lgpl[- ]?(?:v|version )?3(?:\.0)?(?:[- ]?(?:only|or[- ]later|\+))?$/i, "LGPL-3.0-only"],
  [/^lgpl$/i, "LGPL-3.0-only"],
  [/^agpl[- ]?(?:v|version )?3(?:\.0)?(?:[- ]?(?:only|or[- ]later|\+))?$/i, "AGPL-3.0-only"],
  [/^agpl$/i, "AGPL-3.0-only"],
  [/^gpl[- ]?(?:v|version )?3(?:\.0)?(?:[- ]?(?:only|or[- ]later|\+))?$/i, "GPL-3.0-only"],
  [/^gpl[- ]?(?:v|version )?2(?:\.0)?(?:[- ]?(?:only|or[- ]later|\+))?$/i, "GPL-2.0-only"],
  [/^gpl$/i, "GPL-3.0-only"],
  [/^epl[- ]?(?:v|version )?(1\.0|2\.0)$/i, "EPL-2.0"],
  [/^cddl(?:[- ]1\.[01])?$/i, "CDDL-1.0"],
];

/** PyPI's trove classifiers, by the part after the last "::". */
const CLASSIFIERS: Array<[RegExp, string]> = [
  [/^MIT(?: License)?$/i, "MIT"], [/^Apache Software License$/i, "Apache-2.0"], [/^BSD License$/i, "BSD-3-Clause"], [/^ISC License/i, "ISC"],
  [/^Mozilla Public License 2\.0/i, "MPL-2.0"], [/^The Unlicense/i, "Unlicense"], [/^Python Software Foundation License$/i, "PSF-2.0"],
  [/^GNU Lesser General Public License v3/i, "LGPL-3.0-only"], [/^GNU Lesser General Public License v2/i, "LGPL-2.1-only"],
  [/^GNU Affero General Public License v3/i, "AGPL-3.0-only"], [/^GNU General Public License v3/i, "GPL-3.0-only"], [/^GNU General Public License v2/i, "GPL-2.0-only"],
  [/^GNU Library or Lesser General Public License/i, "LGPL-3.0-only"], [/^GNU General Public License \(GPL\)$/i, "GPL-3.0-only"], [/^Public Domain$/i, "Unlicense"],
];

/** A bare licence name as an SPDX id, or null when it is not one we know. */
function one(raw: string): string | null {
  const s = raw.trim().replace(/^\(|\)$/g, "").replace(/\s+/g, " ");
  if (!s) return null;
  for (const id of OK) if (id.toLowerCase() === s.toLowerCase()) return id;
  // "LGPL-2.1+" and "GPL-3.0 or later" are the "or later" forms of the ids.
  const later = /(?:[- ]or[- ]later|\+)$/i.test(s);
  for (const [re, id] of ALIASES) if (re.test(s)) return later && id.endsWith("-only") ? id.replace(/-only$/, "-or-later") : id;
  // An SPDX id we do not list (GPL-3.0-or-later, LGPL-2.1+, AGPL-3.0-only, EPL-1.0...) is kept as written, so it can still be judged by its family.
  if (/^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(s) && /\d|^(?:unlicense|isc|mit)$/i.test(s)) return s.replace(/\+$/, "-or-later");
  return null;
}

/**
 * What a registry's licence field says as an SPDX expression, or null. Takes the
 * npm shape (a string, or `{ type }`, or an array of those), the PyPI `license`
 * text, and a list of trove classifiers.
 */
export function normalise(raw: unknown, classifiers: readonly string[] = []): string | null {
  const text = Array.isArray(raw) ? raw.map((x) => normalise(x)).filter(Boolean).join(" OR ")
    : typeof raw === "string" ? raw : typeof (raw as { type?: unknown } | null)?.type === "string" ? (raw as { type: string }).type : "";
  const t = text.trim();
  if (t && !/^(?:unlicensed|none|proprietary|see licen[sc]e|custom|other|unknown|n\/?a)\b/i.test(t) && t.length <= 200 && !t.includes("\n")) {
    const parts = t.split(/\s+(AND|OR)\s+/i);
    if (parts.length > 1) {
      const ids = parts.filter((_, i) => i % 2 === 0).map(one);
      if (ids.every(Boolean)) return parts.map((p, i) => (i % 2 === 0 ? ids[i / 2]! : p.toUpperCase())).join(" ");
    } else {
      const id = one(t);
      if (id) return id;
    }
  }
  for (const c of classifiers) {
    if (!/^License\s*::/i.test(c)) continue;
    const last = c.split("::").pop()!.trim();
    for (const [re, id] of CLASSIFIERS) if (re.test(last)) return id;
  }
  return null;
}

const family = (id: string): "ok" | "weak" | "gpl" | "agpl" | "unknown" => {
  if (OK.has(id)) return "ok";
  if (/^AGPL/i.test(id)) return "agpl";
  if (/^LGPL/i.test(id) || /^(?:EPL|CDDL|EUPL|CPL|MS-RL|OSL|Artistic|CC-BY-SA)/i.test(id)) return "weak";
  if (/^GPL/i.test(id) || /^SSPL|^BUSL|^Commons-Clause|^CC-BY-NC/i.test(id)) return "gpl";
  return "unknown";
};

const RANK: Record<LicenceLevel, number> = { ok: 0, warn: 1, unknown: 2, strong_warn: 3 };

function judgeOne(id: string, closedSource: boolean): LicenceVerdict {
  switch (family(id)) {
    case "ok": return { spdx: id, level: "ok", note: `${id}, which is permissive` };
    case "weak": return { spdx: id, level: "warn", note: `${id}: fine to use as a library, but changes to it have to be shared. Check before you modify it` };
    case "agpl": return closedSource
      ? { spdx: id, level: "strong_warn", note: `${id}: it can require you to publish your own source, even for a web service. Check before using it in a closed-source project` }
      : { spdx: id, level: "warn", note: `${id}: your project would need a compatible open licence` };
    case "gpl": return closedSource
      ? { spdx: id, level: "strong_warn", note: `${id}: using it can require your own code to be released under the same licence. Check before using it in a closed-source project` }
      : { spdx: id, level: "warn", note: `${id}: your project would need a compatible open licence` };
    default: return { spdx: id, level: "warn", note: `${id} is not one Tailzu knows. Check what it allows` };
  }
}

/**
 * The verdict on an SPDX expression for a project. "A OR B" takes the better
 * option, "A AND B" the worse. `closedSource` is the project that does not
 * publish its source (a private repo): the copyleft licences matter most there.
 */
export function judge(spdx: string | null, closedSource = true): LicenceVerdict {
  if (!spdx) return { spdx: null, level: "unknown", note: "no licence is stated, so by default all rights are reserved. Check with the author before relying on it" };
  const ors = spdx.split(/\s+OR\s+/i);
  const options = ors.map((o) => {
    const ands = o.split(/\s+AND\s+/i).map((a) => judgeOne(a.trim(), closedSource));
    return ands.reduce((worst, v) => (RANK[v.level] > RANK[worst.level] ? v : worst));
  });
  const best = options.reduce((b, v) => (RANK[v.level] < RANK[b.level] ? v : b));
  return ors.length > 1 || spdx.includes(" AND ") ? { ...best, spdx, note: `${spdx}: ${best.note}` } : best;
}

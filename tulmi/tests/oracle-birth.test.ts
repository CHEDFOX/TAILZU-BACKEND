/**
 * WHEN AND WHERE SOMEONE WAS BORN, FROM THEIR OWN WORDS (src/oracle/birth.ts): the formats people use, Hinglish times, day before month, and nothing
 * made up when the words do not hold a whole date.
 */
import { describe, expect, it } from "vitest";
import { readBirth, skyLine, skyOf } from "../src/oracle/birth.js";

describe("reading birth details", () => {
  it("reads the ways people write a date, a time and a place", () => {
    expect(readBirth("13 July 1994, 9:30 am, Mumbai")).toMatchObject({ year: 1994, month: 7, day: 13, hour: 9, minute: 30, timeKnown: true, placeWords: "Mumbai" });
    expect(readBirth("I was born 1994-07-13 at 21:15 in Pune")).toMatchObject({ year: 1994, month: 7, day: 13, hour: 21, minute: 15, placeWords: "Pune" });
    expect(readBirth("July 13, 1994 at 6 pm in Kolkata")).toMatchObject({ month: 7, day: 13, hour: 18, minute: 0, placeWords: "Kolkata" });
    expect(readBirth("born on the 2nd of March 1990, 11.45 pm, New Delhi")).toMatchObject({ month: 3, day: 2, hour: 23, minute: 45, placeWords: "New Delhi" });
  });

  it("reads a Hinglish time, and a day before its month", () => {
    expect(readBirth("13/07/1994 subah 9 baje Delhi")).toMatchObject({ hour: 9, minute: 0, timeKnown: true, placeWords: "Delhi" });
    expect(readBirth("05/07/1994 raat 11 baje Jaipur")).toMatchObject({ month: 7, day: 5, hour: 23 });
    expect(readBirth("07/25/1994 in Austin")).toMatchObject({ month: 7, day: 25 });   // 25 cannot be a month: the American order
  });

  it("says when the time is not known, and keeps noon for it", () => {
    expect(readBirth("12 Jan 2001 in Chennai")).toMatchObject({ hour: 12, minute: 0, timeKnown: false, placeWords: "Chennai" });
  });

  it("makes nothing up from words without a whole, real, past date", () => {
    expect(readBirth("when will I get married?")).toBeNull();
    expect(readBirth("31/02/1994 in Mumbai")).toBeNull();
    expect(readBirth("13 July 2099 in Mumbai", 2026)).toBeNull();
  });

  it("says it back plainly", () => {
    const sky = skyOf(readBirth("13 July 1994, 9:30 am, Mumbai")!, { lat: 19.07, lon: 72.87, label: "Mumbai, Maharashtra, India" });
    expect(sky).toMatchObject({ lat: 19.07, lng: 72.87, place: "Mumbai, Maharashtra, India" });
    expect(skyLine(sky)).toBe("13 July 1994, 9:30 am, Mumbai");
    expect(skyLine({ ...sky, timeKnown: false })).toBe("13 July 1994, time not known, Mumbai");
  });
});

/**
 * OUR OWN SIGNATURE VERSION 4 SIGNER (src/media/sigv4.ts) AGAINST THE SIGNATURES AWS PUBLISHES.
 *
 * The expected values below are not ours: they are the ones in AWS's documentation ("Signature Calculations for the Authorization Header",
 * "Authenticating Requests: Using Query Parameters", the IAM signing-key example) and in its SigV4 test suite. If the signer computes them,
 * R2, which checks the same algorithm, accepts what we send.
 */
import { describe, expect, it } from "vitest";
import { presign, sign, signingKey, uriEncode, amzDate } from "../src/media/sigv4.js";

const S3 = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
const DATE = new Date(Date.UTC(2013, 4, 24, 0, 0, 0));
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("the S3 examples in AWS's documentation", () => {
  it("GET Object with a Range header", () => {
    const r = sign({
      method: "GET", url: "https://examplebucket.s3.amazonaws.com/test.txt", region: "us-east-1", service: "s3", credentials: S3, date: DATE,
      headers: { Range: "bytes=0-9" }, payloadHash: EMPTY,
    });
    expect(r.canonicalRequest).toBe([
      "GET", "/test.txt", "", "host:examplebucket.s3.amazonaws.com", "range:bytes=0-9", `x-amz-content-sha256:${EMPTY}`, "x-amz-date:20130524T000000Z", "",
      "host;range;x-amz-content-sha256;x-amz-date", EMPTY,
    ].join("\n"));
    expect(r.signedHeaders).toBe("host;range;x-amz-content-sha256;x-amz-date");
    expect(r.signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    expect(r.authorization).toBe("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });

  it("PUT Object (a key with a $ in it, a body, a storage class, and a Date header)", () => {
    const body = "Welcome to Amazon S3.";
    const r = sign({
      method: "PUT", url: "https://examplebucket.s3.amazonaws.com/test$file.text", region: "us-east-1", service: "s3", credentials: S3, date: DATE, body,
      headers: { Date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
    });
    expect(r.headers["x-amz-content-sha256"]).toBe("44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072");
    expect(r.canonicalRequest.split("\n")[1]).toBe("/test%24file.text");
    expect(r.signedHeaders).toBe("date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class");
    expect(r.signature).toBe("98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
  });

  it("GET Bucket Lifecycle (a query parameter with no value)", () => {
    const r = sign({ method: "GET", url: "https://examplebucket.s3.amazonaws.com/?lifecycle", region: "us-east-1", service: "s3", credentials: S3, date: DATE, payloadHash: EMPTY });
    expect(r.canonicalRequest.split("\n").slice(0, 3)).toEqual(["GET", "/", "lifecycle="]);
    expect(r.signature).toBe("fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543");
  });

  it("GET Bucket (List Objects), whose query parameters have to be sorted", () => {
    const r = sign({ method: "GET", url: "https://examplebucket.s3.amazonaws.com/?prefix=J&max-keys=2", region: "us-east-1", service: "s3", credentials: S3, date: DATE, payloadHash: EMPTY });
    expect(r.canonicalRequest.split("\n")[2]).toBe("max-keys=2&prefix=J");
    expect(r.signature).toBe("34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });

  it("a presigned GET (the signature in the query string)", () => {
    const url = presign({ method: "GET", url: "https://examplebucket.s3.amazonaws.com/test.txt", region: "us-east-1", service: "s3", credentials: S3, date: DATE, expiresIn: 86400 });
    const q = new URL(url).searchParams;
    expect(q.get("X-Amz-Signature")).toBe("aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
    expect(q.get("X-Amz-Credential")).toBe("AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request");
    expect(q.get("X-Amz-Expires")).toBe("86400");
    expect(q.get("X-Amz-SignedHeaders")).toBe("host");
  });

  it("a presigned link that would last more than a week, or less than a second, is refused", () => {
    const o = { method: "GET", url: "https://b.s3.amazonaws.com/k", region: "auto", service: "s3", credentials: S3 };
    expect(() => presign({ ...o, expiresIn: 604_801 })).toThrow(RangeError);
    expect(() => presign({ ...o, expiresIn: 0 })).toThrow(RangeError);
  });
});

describe("the signing key and the SigV4 test suite", () => {
  it("derives the signing key AWS shows in the IAM documentation", () => {
    expect(signingKey("wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "20150830", "us-east-1", "iam").toString("hex"))
      .toBe("c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9");
  });

  const suite = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };
  const date = new Date(Date.UTC(2015, 7, 30, 12, 36, 0));

  it("get-vanilla", () => {
    const r = sign({ method: "GET", url: "https://example.amazonaws.com/", region: "us-east-1", service: "service", credentials: suite, date });
    expect(r.canonicalRequest).toBe(`GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY}`);
    expect(r.stringToSign).toBe("AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\nbb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63");
    expect(r.signature).toBe("5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
  });

  it("get-vanilla-query", () => {
    const r = sign({ method: "GET", url: "https://example.amazonaws.com/?Param1=value1", region: "us-east-1", service: "service", credentials: suite, date });
    expect(r.signature).toBe("a67d582fa61cc504c4bae71f336f98b97f1ea3c7a6bfe1b6e45aec72011b9aeb");
  });

  it("post-vanilla", () => {
    const r = sign({ method: "POST", url: "https://example.amazonaws.com/", region: "us-east-1", service: "service", credentials: suite, date });
    expect(r.signature).toBe("5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b");
  });

  it("the IAM ListUsers request with a content-type header", () => {
    const r = sign({
      method: "GET", url: "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08", region: "us-east-1", service: "iam", credentials: suite, date,
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    });
    expect(r.signature).toBe("5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7");
  });
});

describe("the details", () => {
  it("encodes the way AWS does: only A-Z a-z 0-9 - _ . ~ stay as they are", () => {
    expect(uriEncode("a b/c~d-e_f.g")).toBe("a%20b%2Fc~d-e_f.g");
    expect(uriEncode("!'()*")).toBe("%21%27%28%29%2A");
    expect(uriEncode("é")).toBe("%C3%A9");
  });

  it("writes the date as AWS wants it", () => {
    expect(amzDate(new Date(Date.UTC(2026, 9, 27, 8, 5, 3, 999)))).toBe("20261027T080503Z");
  });

  it("signs a security token, and a header's value with its spaces squeezed", () => {
    const r = sign({
      method: "GET", url: "https://b.example.com/", region: "auto", service: "s3", date: DATE, payloadHash: EMPTY,
      credentials: { ...S3, sessionToken: "TOKEN" }, headers: { "X-Thing": "  a   b  " },
    });
    expect(r.signedHeaders).toBe("host;x-amz-content-sha256;x-amz-date;x-amz-security-token;x-thing");
    expect(r.canonicalRequest).toContain("x-thing:a b\n");
  });

  it("does not sign an Authorization header it was handed, and replaces it", () => {
    const r = sign({ method: "GET", url: "https://b.example.com/k", region: "auto", service: "s3", date: DATE, credentials: S3, headers: { Authorization: "old" } });
    expect(r.signedHeaders).not.toContain("authorization");
    expect(r.headers.Authorization).toBe(r.authorization);
  });

  it("keeps a key with a double slash in it as it is for S3, and tidies the path for any other service", () => {
    const s3 = sign({ method: "GET", url: "https://b.example.com/a//b/c", region: "auto", service: "s3", date: DATE, credentials: S3, payloadHash: EMPTY });
    expect(s3.canonicalRequest.split("\n")[1]).toBe("/a//b/c");
    const other = sign({ method: "GET", url: "https://b.example.com/a//b/c", region: "auto", service: "service", date: DATE, credentials: S3, payloadHash: EMPTY });
    expect(other.canonicalRequest.split("\n")[1]).toBe("/a/b/c");
  });
});

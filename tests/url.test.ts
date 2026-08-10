import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { domainFromUrl, normalizePublicHttpUrl, parseCompanyInput } from "../src/lib/url";

describe("normalizePublicHttpUrl", () => {
  it("adds https to bare domains", () => {
    assert.equal(normalizePublicHttpUrl("acme.com"), "https://acme.com");
  });

  it("strips path and keeps host", () => {
    assert.equal(
      normalizePublicHttpUrl("https://www.acme.com/pricing"),
      "https://www.acme.com",
    );
  });

  it("rejects localhost", () => {
    assert.throws(() => normalizePublicHttpUrl("http://localhost"), /Localhost/);
  });

  it("rejects private IPv4", () => {
    assert.throws(() => normalizePublicHttpUrl("http://192.168.1.10"), /Private/);
  });

  it("rejects non-http schemes", () => {
    assert.throws(() => normalizePublicHttpUrl("ftp://files.example.com"), /HTTP/);
  });
});

describe("parseCompanyInput", () => {
  it("returns domain without www", () => {
    const parsed = parseCompanyInput("https://www.example.com/about");
    assert.equal(parsed.domain, "example.com");
    assert.equal(parsed.normalizedUrl, "https://www.example.com");
  });

  it("domainFromUrl lowercases", () => {
    assert.equal(domainFromUrl("https://WWW.Acme.COM"), "acme.com");
  });
});

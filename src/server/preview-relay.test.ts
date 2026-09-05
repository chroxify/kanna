import { describe, expect, test } from "bun:test"
import { buildUpstreamUrl, preferredRelayPort, rewriteForwardedHeaders, rewriteResponseHeaders } from "./preview-relay"

describe("rewriteForwardedHeaders", () => {
  test("presents the request as local while keeping where it really came from", () => {
    const headers = rewriteForwardedHeaders(new Headers({
      host: "mac.tail.ts.net:5180",
      origin: "https://mac.tail.ts.net:5180",
      "accept-encoding": "gzip, br",
      cookie: "a=1",
    }), 5180)
    // What Vite's allowedHosts and WebSocket-origin checks look at.
    expect(headers.get("host")).toBe("localhost:5180")
    expect(headers.get("origin")).toBe("http://localhost:5180")
    // What an app that builds absolute URLs looks at.
    expect(headers.get("x-forwarded-host")).toBe("mac.tail.ts.net:5180")
    expect(headers.get("x-forwarded-proto")).toBe("https")
    expect(headers.get("accept-encoding")).toBeNull()
    expect(headers.get("cookie")).toBe("a=1")
  })

  test("adds no origin where the browser sent none", () => {
    expect(rewriteForwardedHeaders(new Headers({ host: "mac.tail.ts.net:3000" }), 3000).has("origin")).toBe(false)
  })
})

describe("rewriteResponseHeaders", () => {
  test("drops the framing of a body fetch already decoded", () => {
    const headers = rewriteResponseHeaders(new Headers({
      "content-encoding": "gzip",
      "content-length": "123",
      "content-type": "text/html",
      location: "/login",
    }))
    expect(headers.get("content-encoding")).toBeNull()
    expect(headers.get("content-length")).toBeNull()
    expect(headers.get("content-type")).toBe("text/html")
    expect(headers.get("location")).toBe("/login")
  })
})

test("buildUpstreamUrl keeps path and query, swaps only the origin", () => {
  expect(buildUpstreamUrl("https://mac.tail.ts.net:5180/docs?x=1", 5180)).toBe("http://localhost:5180/docs?x=1")
  expect(buildUpstreamUrl("https://mac.tail.ts.net:5180/hmr", 5180, "ws")).toBe("ws://localhost:5180/hmr")
})

test("preferredRelayPort is stable and never collides with the target", () => {
  expect(preferredRelayPort(5180)).toBe(48180)
  expect(preferredRelayPort(3000)).toBe(46000)
  expect(preferredRelayPort(48180)).not.toBe(48180)
})

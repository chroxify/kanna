import { describe, expect, test } from "bun:test"
import { buildRemotePreviewUrl, parseLoopbackAddress, parseServeStatusPorts } from "./remote-preview"

describe("parseLoopbackAddress", () => {
  test("recognises the ways a dev server gets written down", () => {
    expect(parseLoopbackAddress("http://localhost:3000")).toEqual({ port: 3000, pathAndQuery: "/" })
    expect(parseLoopbackAddress("localhost:5173/docs?x=1#top")).toEqual({ port: 5173, pathAndQuery: "/docs?x=1#top" })
    expect(parseLoopbackAddress("http://127.0.0.1:8080/")).toEqual({ port: 8080, pathAndQuery: "/" })
    expect(parseLoopbackAddress("http://[::1]:4000")).toEqual({ port: 4000, pathAndQuery: "/" })
  })

  test("leaves everything that already means something remotely alone", () => {
    expect(parseLoopbackAddress("https://example.com")).toBeNull()
    expect(parseLoopbackAddress("https://christos-mac-mini.tail1bcad8.ts.net:3000")).toBeNull()
    // No port: that's 80/443, not a dev server we'd publish.
    expect(parseLoopbackAddress("http://localhost")).toBeNull()
    expect(parseLoopbackAddress("not a url at all ::")).toBeNull()
  })
})

describe("buildRemotePreviewUrl", () => {
  test("puts the port on the tailnet name over https", () => {
    expect(buildRemotePreviewUrl("mac.tail.ts.net", 3000)).toBe("https://mac.tail.ts.net:3000/")
    expect(buildRemotePreviewUrl("mac.tail.ts.net", 3000, "/docs?x=1")).toBe("https://mac.tail.ts.net:3000/docs?x=1")
  })
})

describe("parseServeStatusPorts", () => {
  test("reads the HTTPS ports out of tailscale serve status", () => {
    expect(parseServeStatusPorts({
      TCP: { "3998": { HTTPS: true }, "8080": { HTTPS: false } },
      Web: { "mac.tail.ts.net:3998": { Handlers: { "/": { Proxy: "http://127.0.0.1:3998" } } } },
    })).toEqual([3998])
    // An empty serve config prints "{}".
    expect(parseServeStatusPorts({})).toEqual([])
    expect(parseServeStatusPorts(null)).toEqual([])
  })
})

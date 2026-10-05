import { describe, expect, test } from "bun:test"
import { PEEK_SETTLE_SPEED, pointerSpeed } from "./useEdgePeek"

describe("pointerSpeed", () => {
  test("is zero for the first sample", () => {
    expect(pointerSpeed(null, { x: 0, y: 0, t: 0 })).toBe(0)
  })

  test("reads a sweep past the edge as travelling", () => {
    // 40px in 16ms: a mouse heading for the corner, not stopping at the edge.
    const speed = pointerSpeed({ x: 30, y: 600, t: 0 }, { x: 2, y: 628, t: 16 })
    expect(speed).toBeGreaterThan(PEEK_SETTLE_SPEED)
  })

  test("reads a mouse slowing at the edge as settled", () => {
    const speed = pointerSpeed({ x: 4, y: 300, t: 0 }, { x: 2, y: 301, t: 16 })
    expect(speed).toBeLessThan(PEEK_SETTLE_SPEED)
  })

  test("reads a long gap between moves as rest", () => {
    expect(pointerSpeed({ x: 0, y: 0, t: 0 }, { x: 200, y: 0, t: 500 })).toBe(0)
  })
})

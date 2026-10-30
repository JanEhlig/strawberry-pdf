const MULTI_CLICK_MS = 500
const MULTI_CLICK_SLOP = 5

let last = { time: -Infinity, x: 0, y: 0, button: -1, count: 0 }

window.addEventListener(
  'pointerdown',
  (e) => {
    const near =
      e.button === last.button && e.timeStamp - last.time < MULTI_CLICK_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) <= MULTI_CLICK_SLOP
    last = { time: e.timeStamp, x: e.clientX, y: e.clientY, button: e.button, count: near ? last.count + 1 : 1 }
  },
  true
)

window.addEventListener(
  'keydown',
  () => {
    last = { ...last, time: -Infinity, count: 0 }
  },
  true
)

export function clickCount(): number {
  return last.count
}

/** 主题色工具：按 Element Plus 规则派生 primary 各级色阶并写入 CSS 变量。 */

function clamp(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)))
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

function toHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => clamp(v).toString(16).padStart(2, '0')).join('')
}

/** 将 color 与 target 按 weight（0~1，target 占比）线性混合。 */
export function mix(color: string, target: string, weight: number): string {
  const [r1, g1, b1] = parseHex(color)
  const [r2, g2, b2] = parseHex(target)
  return toHex([
    r1 * (1 - weight) + r2 * weight,
    g1 * (1 - weight) + g2 * weight,
    b1 * (1 - weight) + b2 * weight,
  ])
}

/**
 * 应用主题色：设置 --el-color-primary 及 light-3/5/7/8/9 与 dark-2。
 * 暗色模式下与深色背景混合，浅色模式下与白色混合。
 */
export function applyPrimary(primary: string, dark: boolean): void {
  const style = document.documentElement.style
  style.setProperty('--el-color-primary', primary)
  const lightTarget = dark ? '#141414' : '#ffffff'
  ;[3, 5, 7, 8, 9].forEach((level) => {
    style.setProperty(`--el-color-primary-light-${level}`, mix(primary, lightTarget, level / 10))
  })
  style.setProperty('--el-color-primary-dark-2', mix(primary, dark ? '#ffffff' : '#000000', 0.2))
}

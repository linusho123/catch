import { CreateStartUpPageContainer, TextContainerProperty, waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'

// The glyph check (BUILD-PLAN.md, P1a): every glyph Catch's lens may draw, one
// per row, beside its name, at full brightness and at the dim level Catch uses,
// so a missing glyph (Even drops them silently) shows as an empty cell. Open
// http://localhost:5173/glyphs.html (npm run lens:dev) in the Even Hub
// simulator, or on the glasses through the Even app. Not part of the plugin.

export const GLYPHS: [name: string, glyph: string][] = [
  ['dot', '•'],
  ['middle dot', '·'],
  ['down arrow', '↓'],
  ['ellipsis', '…'],
  ['en dash', '–'],
  ['em dash', '—'],
  ['ASCII hyphen', '-'],
]

const bridge = await waitForEvenAppBridge()
const rows = GLYPHS.map(([name, glyph]) => `[${glyph}] [${glyph}${glyph}${glyph}] ${name}`).join('\n')
const box = (containerID: number, containerName: string, x: number, content: string, textColor: number) =>
  new TextContainerProperty({ containerID, containerName, xPosition: x, yPosition: 0, width: 288, height: 288, borderWidth: 0, paddingLength: 4, content, textColor, isEventCapture: containerID === 1 ? 1 : 0 })
await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({ containerTotalNum: 2, textObject: [box(1, 'bright', 0, rows, 4), box(2, 'dim', 288, rows, 1)] }),
)

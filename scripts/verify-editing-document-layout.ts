import { chromium } from "playwright"

const url = process.env.EDITING_DOCUMENT_URL
if (!url) {
  throw new Error("EDITING_DOCUMENT_URL is required")
}

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(url, { waitUntil: "networkidle" })

  const heading = page.getByRole("heading", { name: "Editing document" })
  await heading.waitFor()
  const card = heading.locator("xpath=ancestor::section")
  const scriptArea = card.locator('[data-slot="scroll-area"]')
  const viewport = scriptArea.locator('[data-slot="scroll-area-viewport"]')
  const rootBox = await scriptArea.boundingBox()
  const viewportBox = await viewport.boundingBox()

  if (!rootBox || !viewportBox) {
    throw new Error("Editing document script area is not measurable")
  }
  const rootBottom = rootBox.y + rootBox.height
  const viewportBottom = viewportBox.y + viewportBox.height
  if (viewportBottom > rootBottom + 1) {
    throw new Error(
      `Editing document script viewport overflows its root (${viewportBottom} > ${rootBottom})`
    )
  }

  const rows = card.locator("li").filter({ hasText: /scene_/ })
  const boxes = await rows.evaluateAll((elements) =>
    elements.map((element) => element.getBoundingClientRect().toJSON())
  )
  for (let index = 0; index < boxes.length - 1; index += 1) {
    if (boxes[index].bottom > boxes[index + 1].top + 1) {
      throw new Error(
        `Editing document rows overlap at index ${index} (${boxes[index].bottom} > ${boxes[index + 1].top})`
      )
    }
  }

  console.log(
    `Editing document layout OK: ${boxes.length} rows, script viewport contained`
  )
} finally {
  await browser.close()
}

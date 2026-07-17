// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import puppeteer, { type Browser } from "puppeteer"

vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}))
vi.stubGlobal("React", React)

import CustomerList from "./CustomerList"
import type { ListItem } from "./types"

const base: ListItem = {
  id: 60001,
  kind: "user",
  name: "Better way To survive with a deliberately long customer name",
  email: "jeffhsieh0909@gmail.com",
  phone: "",
  initials: "BS",
  color: "#E0E7FF",
  textColor: "#3730A3",
  lastContact: "7/13",
  tag: "inquiry",
  tagLabel: "詢問中",
  notifs: 1,
  unread: false,
  blocked: false,
  needsFollowup: false,
}

function markup(customer: ListItem) {
  return renderToStaticMarkup(
    React.createElement(CustomerList, {
      customers: [customer],
      selected: { id: customer.id, kind: customer.kind },
      onSelect: () => {},
      showHidden: false,
      onToggleHidden: () => {},
      onMarkNotCustomer: () => {},
      onRestoreCustomer: () => {},
      onDeleteGuest: () => {},
    }),
  )
}

const utilityCss = String.raw`
  * { box-sizing: border-box; }
  .w-\[300px\] { width: 300px; }
  .flex { display: flex; }
  .flex-col { flex-direction: column; }
  .flex-1 { flex: 1 1 0%; }
  .flex-shrink-0, .shrink-0 { flex-shrink: 0; }
  .items-center { align-items: center; }
  .self-stretch { align-self: stretch; }
  .min-w-0 { min-width: 0; }
  .overflow-hidden { overflow: hidden; }
  .relative { position: relative; }
  .absolute { position: absolute; }
  .gap-2\.5 { gap: 10px; }
  .gap-1\.5 { gap: 6px; }
  .px-3 { padding-left: 12px; padding-right: 12px; }
  .py-2\.5 { padding-top: 10px; padding-bottom: 10px; }
  .p-1\.5 { padding: 6px; }
  .w-9 { width: 36px; }
  .h-9 { height: 36px; }
  .w-12 { width: 48px; }
  .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .right-0 { right: 0; }
  .top-1\/2 { top: 50%; }
  .-translate-y-1\/2 { transform: translateY(-50%); }
  button svg { width: 14px; height: 14px; }
`

describe("CustomerList row layout in a real browser", () => {
  let browser: Browser

  beforeAll(async () => {
    browser = await puppeteer.launch({ headless: true })
  }, 30_000)

  afterAll(async () => {
    await browser?.close()
  })

  for (const kind of ["user", "guest"] as const) {
    it(`${kind} actions do not consume normal-flow width and the name truly ellipsizes`, async () => {
      const page = await browser.newPage()
      await page.setContent(`<style>${utilityCss}</style>${markup({ ...base, kind })}`)

      const result = await page.evaluate(() => {
        const info = document.querySelector<HTMLElement>("[data-customer-row-info]")!
        const name = document.querySelector<HTMLElement>("[data-customer-row-name]")!
        const actions = document.querySelector<HTMLElement>("[data-customer-row-actions]")!
        const before = info.getBoundingClientRect().width
        actions.style.display = "none"
        const after = info.getBoundingClientRect().width
        const style = getComputedStyle(name)
        return {
          infoWidth: before,
          widthDelta: Math.abs(after - before),
          isOverflowing: name.scrollWidth > name.clientWidth,
          overflow: style.overflow,
          whiteSpace: style.whiteSpace,
          textOverflow: style.textOverflow,
        }
      })

      expect(result.widthDelta).toBeLessThanOrEqual(1)
      expect(result.infoWidth).toBeGreaterThanOrEqual(165)
      expect(result.isOverflowing).toBe(true)
      expect(result).toMatchObject({
        overflow: "hidden",
        whiteSpace: "nowrap",
        textOverflow: "ellipsis",
      })
      await page.close()
    }, 30_000)
  }
})

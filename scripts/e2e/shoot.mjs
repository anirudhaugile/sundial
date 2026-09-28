// Dev helper: sign in via local Mailpit magic link, then screenshot routes.
// usage: node scripts/e2e/shoot.mjs <email> <outDir> /today /week ...  [--mobile] [--dark]
import { chromium } from "playwright";

const [email, outDir, ...rest] = process.argv.slice(2);
const routes = rest.filter((r) => r.startsWith("/"));
const mobile = rest.includes("--mobile");
const dark = rest.includes("--dark");
const base = process.env.BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: mobile ? { width: 390, height: 844 } : { width: 1360, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: dark ? "dark" : "light",
  isMobile: mobile,
  hasTouch: mobile,
});
const page = await context.newPage();

async function magicLink() {
  const since = Date.now();
  await page.goto(`${base}/login`);
  await page.fill("#email", email);
  await page.click("form button");
  await page.getByText("Check your inbox").waitFor({ timeout: 10000 });
  for (let i = 0; i < 30; i++) {
    const list = await (await fetch("http://127.0.0.1:54324/api/v1/search?query=" + encodeURIComponent("to:" + email))).json();
    const msg = list.messages?.find((m) => Date.parse(m.Created) >= since - 2000);
    if (msg) {
      const full = await (await fetch(`http://127.0.0.1:54324/api/v1/message/${msg.ID}`)).json();
      return full.Text.match(/https?:\/\/\S+/)[0];
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("no email");
}

await page.goto(await magicLink());
await page.waitForURL("**/today");
for (const r of routes) {
  await page.goto(base + r);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  const name = r.replace(/\//g, "_").replace(/[?&=]/g, "-") || "_root";
  await page.screenshot({ path: `${outDir}/${name}${mobile ? "-m" : ""}${dark ? "-d" : ""}.png`, fullPage: true });
}
await browser.close();
console.log("shots done");

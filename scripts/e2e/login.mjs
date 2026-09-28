import { chromium } from "playwright";
const email = `me+${Date.now()}@sundial.test`;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://localhost:3000/login");
await page.fill("#email", email);
await page.click("button");
await page.getByText("Check your inbox").waitFor({ timeout: 10000 });
let link;
for (let i = 0; i < 20 && !link; i++) {
  const list = await (await fetch("http://127.0.0.1:54324/api/v1/search?query=" + encodeURIComponent("to:" + email))).json();
  if (list.messages?.length) {
    const msg = await (await fetch(`http://127.0.0.1:54324/api/v1/message/${list.messages[0].ID}`)).json();
    link = msg.Text.match(/https?:\/\/\S+/)?.[0];
  } else await new Promise((r) => setTimeout(r, 500));
}
console.log("link", link?.slice(0, 80));
await page.goto(link);
await page.waitForURL("**/today", { timeout: 15000 });
console.log("landed", page.url());
await page.screenshot({ path: process.argv[2] ?? "shot.png", fullPage: true });
await browser.close();

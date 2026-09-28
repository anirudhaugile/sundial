// End-to-end sign-in check against local Supabase + Mailpit.
// usage: node scripts/e2e/login.mjs [email]   (email must be in ALLOWED_EMAILS)
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const email = process.argv[2] ?? "ugile@wisc.edu";
const mailpit = "http://127.0.0.1:54324/api/v1";

async function latestMail(since) {
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`${mailpit}/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    const msg = list.messages?.find((m) => Date.parse(m.Created) >= since - 1000);
    if (msg) {
      const full = await (await fetch(`${mailpit}/message/${msg.ID}`)).json();
      const text = full.Text || full.HTML.replace(/<[^>]+>/g, " ");
      const link = (full.HTML.match(/href="([^"]*\/auth\/confirm[^"]*)"/)?.[1] ?? "").replace(/&amp;/g, "&");
      return { subject: full.Subject, code: text.match(/\b(\d{6})\b/)?.[1], link };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("no email arrived");
}

async function requestCode(page, address = email) {
  const since = Date.now();
  await page.goto(`${base}/login`);
  await page.fill("#email", address);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  return since;
}

const browser = await chromium.launch();
const results = [];
const step = async (name, fn) => {
  await fn();
  results.push(`ok  ${name}`);
};

try {
  await step("6-digit code signs in", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const since = await requestCode(page);
    await page.getByText("Check your inbox").waitFor();
    const mail = await latestMail(since);
    assert.equal(mail.subject, "Your Sundial sign-in code");
    assert.match(mail.code ?? "", /^\d{6}$/);
    assert.match(mail.link, /\/auth\/confirm\?token_hash=.+&type=email$/);
    await page.fill("#token", "000000".replace(/0/g, () => "1")); // wrong code first
    await page.getByText(/wrong or has expired/).waitFor();
    await page.fill("#token", mail.code); // auto-submits at 6 digits
    await page.waitForURL("**/today", { timeout: 15000 });
    await ctx.close();
  });

  await step("link survives a scanner GET and works on another device", async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // wait out the resend cooldown between emails to the same address
    await new Promise((r) => setTimeout(r, 1500));
    const since = await requestCode(page);
    await page.getByText("Check your inbox").waitFor();
    const mail = await latestMail(since);

    // what Safe Links does: fetch the URL (and follow redirects) without running JS or submitting forms
    const scan = await fetch(mail.link, { redirect: "follow" });
    assert.equal(scan.status, 200);
    const scanned = await scan.text();
    assert.match(scanned, /Continue to Sundial/);

    // a different browser (fresh context: no cookies, no PKCE verifier) opens the link later
    const other = await browser.newContext();
    const p2 = await other.newPage();
    await p2.goto(mail.link);
    await p2.getByRole("button", { name: "Continue to Sundial" }).click();
    await p2.waitForURL("**/today", { timeout: 15000 });

    // the same link again: already used → friendly message, not a crash
    const third = await (await browser.newContext()).newPage();
    await third.goto(mail.link);
    await third.getByRole("button", { name: "Continue to Sundial" }).click();
    await third.waitForURL("**/login?error=*");
    await third.getByText(/already been used or expired/).waitFor();
    await ctx.close();
    await other.close();
  });

  await step("addresses outside ALLOWED_EMAILS are refused", async () => {
    const page = await (await browser.newContext()).newPage();
    await requestCode(page, "stranger@example.com");
    await page.getByText("This Sundial is private").waitFor();
  });

  await step("confirm page without a token explains what to do", async () => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${base}/auth/confirm`);
    await page.getByText("This link is incomplete").waitFor();
  });
} finally {
  await browser.close();
  console.log(results.join("\n"));
}

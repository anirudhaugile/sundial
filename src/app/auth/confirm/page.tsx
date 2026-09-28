import type { Metadata } from "next";
import { Wordmark } from "@/components/logo";
import { Button } from "@/components/ui";
import { confirmLink } from "@/app/login/actions";

// Scanner-safe landing for the email link. Opening it (GET) spends nothing; only the
// button's POST verifies the token, and link scanners never submit forms.
export const metadata: Metadata = {
  title: "Continue",
  referrer: "no-referrer", // the token is in the URL
  robots: { index: false, follow: false },
};

export default async function ConfirmPage({ searchParams }: PageProps<"/auth/confirm">) {
  const { token_hash, type } = await searchParams;
  const hash = typeof token_hash === "string" ? token_hash : "";
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-16">
      <div className="w-full max-w-[360px]">
        <div className="mb-10"><Wordmark /></div>
        {hash ? (
          <form action={confirmLink} className="animate-rise">
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">One more step</h1>
            <p className="mt-2 mb-8 text-sm leading-relaxed text-muted">Press continue to finish signing in on this device.</p>
            <input type="hidden" name="token_hash" value={hash} />
            <input type="hidden" name="type" value={typeof type === "string" ? type : "email"} />
            <Button variant="primary" className="h-10 w-full">Continue to Sundial</Button>
          </form>
        ) : (
          <div>
            <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">This link is incomplete</h1>
            <p className="mt-2 text-sm text-muted">
              Enter the 6-digit code from the email on the <a href="/login" className="text-fg underline underline-offset-4">sign-in page</a> instead.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

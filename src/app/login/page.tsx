import type { Metadata } from "next";
import { Wordmark } from "@/components/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-16">
      <div className="w-full max-w-[360px]">
        <div className="mb-10"><Wordmark /></div>
        <h1 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.025em]">
          Your week,
          <br />
          <span className="text-muted">already thought through.</span>
        </h1>
        <p className="mt-4 mb-8 text-sm leading-relaxed text-muted">
          Sundial pulls in your assignments and calendar, estimates how long each thing takes, and
          quietly finds the time — around the gym, not instead of it.
        </p>
        <LoginForm error={typeof error === "string" ? error : undefined} />
      </div>
    </main>
  );
}

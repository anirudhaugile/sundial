"use client";

import { useActionState } from "react";
import { ArrowRight, MailCheck } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm({ error }: { error?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, {
    status: error ? "error" : "idle",
    message: error,
  });

  if (state.status === "sent") {
    return (
      <div className="animate-rise rounded-xl border border-line bg-surface p-5">
        <MailCheck className="mb-3 text-accent" size={20} />
        <p className="text-sm font-medium">Check your inbox</p>
        <p className="mt-1 text-sm text-muted">
          We sent a sign-in link to <span className="text-fg">{state.email}</span>. It expires in an hour.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor="email" className="sr-only">Email</label>
      <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@school.edu" autoFocus className="h-10" />
      <Button variant="primary" className="h-10" disabled={pending}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </Button>
      {state.status === "error" ? <p className="text-sm text-danger">{state.message}</p> : null}
      <a href="/demo" className="mt-3 inline-flex items-center justify-center gap-1 text-sm text-muted transition-colors hover:text-fg">
        Just looking? Try the demo <ArrowRight size={14} />
      </a>
    </form>
  );
}

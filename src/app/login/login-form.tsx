"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { ArrowRight, MailCheck } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { sendCode, verifyCode, type LoginState, type VerifyState } from "./actions";

const RESEND_AFTER = 60;

export function LoginForm({ error }: { error?: string }) {
  const [sent, send, sending] = useActionState<LoginState, FormData>(sendCode, {
    status: error ? "error" : "idle",
    message: error,
  });
  const [reset, setReset] = useState(0); // "use a different email"

  if (sent.status === "sent" && sent.email && reset === 0) {
    return <CodeStep email={sent.email} notice={sent.message} onBack={() => setReset(1)} resend={send} resending={sending} />;
  }

  return (
    <form action={(f) => (setReset(0), send(f))} className="flex flex-col gap-3">
      <label htmlFor="email" className="sr-only">Email</label>
      <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@school.edu" autoFocus defaultValue={sent.email} className="h-10" />
      <Button variant="primary" className="h-10" disabled={sending}>
        {sending ? "Sending…" : "Email me a sign-in code"}
      </Button>
      {sent.status === "error" ? <p className="text-sm text-danger">{sent.message}</p> : null}
      <a href="/demo" className="mt-3 inline-flex items-center justify-center gap-1 text-sm text-muted transition-colors hover:text-fg">
        Just looking? Try the demo <ArrowRight size={14} />
      </a>
    </form>
  );
}

function CodeStep({ email, notice, onBack, resend, resending }: { email: string; notice?: string; onBack: () => void; resend: (f: FormData) => void; resending: boolean }) {
  const [state, verify, verifying] = useActionState<VerifyState, FormData>(verifyCode, {});
  const [code, setCode] = useState("");
  const [wait, setWait] = useState(RESEND_AFTER);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  // paste or autofill of all six digits submits right away
  useEffect(() => {
    if (code.length === 6) formRef.current?.requestSubmit();
  }, [code]);

  return (
    <div className="animate-rise">
      <div className="mb-5 rounded-xl border border-line bg-surface p-5">
        <MailCheck className="mb-3 text-accent" size={20} />
        <p className="text-sm font-medium">Check your inbox</p>
        <p className="mt-1 text-sm text-muted">
          We sent a 6-digit code to <span className="text-fg">{email}</span>. Enter it below, or open the link in the email.
        </p>
        {notice ? <p className="mt-2 text-xs text-muted">{notice}</p> : null}
      </div>

      <form ref={formRef} action={verify} className="flex flex-col gap-3">
        <input type="hidden" name="email" value={email} />
        <label htmlFor="token" className="sr-only">6-digit code</label>
        <Input
          id="token"
          name="token"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          autoFocus
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          className="h-12 text-center font-mono text-2xl tracking-[0.5em] placeholder:tracking-[0.5em]"
        />
        <Button variant="primary" className="h-10" disabled={verifying || code.length !== 6}>
          {verifying ? "Signing in…" : "Sign in"}
        </Button>
        {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      </form>

      <div className="mt-4 flex items-center justify-between text-sm">
        <button onClick={onBack} className="text-muted hover:text-fg">Use a different email</button>
        <form
          action={(f) => {
            setWait(RESEND_AFTER);
            setCode("");
            resend(f);
          }}
        >
          <input type="hidden" name="email" value={email} />
          <button disabled={wait > 0 || resending} className="text-muted hover:text-fg disabled:text-subtle">
            {resending ? "Sending…" : wait > 0 ? `Resend in ${wait}s` : "Send a new code"}
          </button>
        </form>
      </div>
    </div>
  );
}

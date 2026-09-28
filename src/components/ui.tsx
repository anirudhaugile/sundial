import { clsx } from "clsx";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export { clsx as cx };

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap select-none " +
  "transition-[background-color,border-color,color,opacity,transform] duration-150 ease-out " +
  "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "border border-line-strong bg-surface text-fg hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-fg",
  danger: "text-danger hover:bg-danger-soft",
};

const buttonSizes = { sm: "h-8 px-2.5 text-[13px]", md: "h-9 px-3.5 text-sm", icon: "h-8 w-8" };

export function buttonClass(variant: ButtonVariant = "secondary", size: keyof typeof buttonSizes = "md") {
  return clsx(buttonBase, buttonVariants[variant], buttonSizes[size]);
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: keyof typeof buttonSizes }) {
  return <button className={clsx(buttonClass(variant, size), className)} {...props} />;
}

const fieldBase =
  "w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-fg placeholder:text-subtle " +
  "transition-colors duration-150 focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(fieldBase, "h-9", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(fieldBase, "min-h-20 py-2", className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={clsx(fieldBase, "h-9 pr-8", className)} {...props} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("flex flex-col gap-1.5", className)}>
      <span className="text-[13px] font-medium text-fg">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx("rounded-xl border border-line bg-surface", className)}>{children}</div>;
}

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between px-1">
      <h2 className="text-xs font-medium uppercase tracking-[0.08em] text-subtle">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-fg">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong px-6 py-12 text-center">
      {icon ? <div className="mb-3 text-subtle">{icon}</div> : null}
      <p className="text-sm font-medium text-fg">{title}</p>
      {children ? <div className="mt-1 max-w-sm text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface-2 px-1 font-mono text-[11px] text-muted">
      {children}
    </kbd>
  );
}

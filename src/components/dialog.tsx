"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/** Native <dialog> with calm styling. Escape and backdrop click close it. */
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      data-modal-open={open ? "" : undefined}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto w-[calc(100%-2rem)] ${wide ? "max-w-lg" : "max-w-md"} rounded-2xl border border-line bg-surface p-0 text-fg backdrop:bg-black/25 backdrop:backdrop-blur-[2px] open:animate-rise`}
    >
      {open ? (
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
            <button onClick={onClose} className="rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-fg" aria-label="Close">
              <X size={16} />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToastStore, type ToastData } from "@/hooks/use-toast";

const TOAST_LIMIT = 5;

const toastVariants = cva(
  "pointer-events-auto group relative flex w-full items-start gap-3 overflow-hidden rounded-lg border bg-card p-4 pr-10 transition-all data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-bottom-full data-[state=open]:slide-in-from-bottom-full data-[state=open]:duration-300 data-[state=closed]:duration-300",
  {
    variants: {
      variant: {
        default: "border-border text-card-foreground",
        destructive:
          "border-destructive/50 bg-destructive text-destructive-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface ToastProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof toastVariants> {
  toast: ToastData & { open: boolean };
  onDismiss: (id: string) => void;
}

const Toast = React.forwardRef<HTMLDivElement, ToastProps>(
  ({ className, toast, onDismiss, ...props }, ref) => {
    const { id, title, description, action, open } = toast;
    const isDestructive = toast.variant === "destructive";

    return (
      <div
        ref={ref}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-state={open ? "open" : "closed"}
        className={cn(
          toastVariants({ variant: isDestructive ? "destructive" : "default" }),
          className
        )}
        {...props}
      >
        <div className="flex-1 space-y-1">
          {title && (
            <div className="text-sm font-semibold leading-none">{title}</div>
          )}
          {description && (
            <div className="text-sm opacity-90">{description}</div>
          )}
          {action && <div className="mt-2 flex">{action}</div>}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(id)}
          className={cn(
            "absolute right-2 top-2 rounded-md p-1 transition-colors focus:outline-none focus:ring-1 focus:ring-ring",
            isDestructive
              ? "text-destructive-foreground/80 hover:text-destructive-foreground hover:bg-destructive-foreground/10"
              : "text-muted-foreground hover:text-foreground hover:bg-accent"
          )}
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }
);
Toast.displayName = "Toast";

const Toaster = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  const toasts = useToastStore((state) => state.toasts);
  const dismissToast = useToastStore((state) => state.dismissToast);

  const visibleToasts = toasts.slice(0, TOAST_LIMIT);

  return (
    <div
      ref={ref}
      className={cn(
        "pointer-events-none fixed bottom-0 left-1/2 z-[100] flex w-full max-w-[420px] -translate-x-1/2 flex-col-reverse gap-2 p-4",
        className
      )}
      {...props}
    >
      {visibleToasts.map((toast) => (
        <Toast
          key={toast.id}
          toast={toast}
          onDismiss={dismissToast}
        />
      ))}
    </div>
  );
});
Toaster.displayName = "Toaster";

export { Toast, Toaster };

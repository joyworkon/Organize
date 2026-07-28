"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type ContextMenuContextType = {
  open: boolean;
  position: { x: number; y: number };
  openMenu: (pos: { x: number; y: number }) => void;
  closeMenu: () => void;
};

const ContextMenuContext = React.createContext<ContextMenuContextType | null>(null);

function useContextMenu() {
  const context = React.useContext(ContextMenuContext);
  if (!context) {
    throw new Error("ContextMenu components must be used within a ContextMenu");
  }
  return context;
}

interface ContextMenuProps {
  children: React.ReactNode;
}

function ContextMenu({ children }: ContextMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState({ x: 0, y: 0 });

  const openMenu = React.useCallback((pos: { x: number; y: number }) => {
    setPosition(pos);
    setOpen(true);
  }, []);

  const closeMenu = React.useCallback(() => {
    setOpen(false);
  }, []);

  React.useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-context-menu-content]")) return;
      closeMenu();
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeMenu();
      }
    };

    const handleScroll = () => {
      closeMenu();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", closeMenu);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [open, closeMenu]);

  const contextValue = React.useMemo(
    () => ({ open, position, openMenu, closeMenu }),
    [open, position, openMenu, closeMenu]
  );

  return (
    <ContextMenuContext.Provider value={contextValue}>
      {children}
    </ContextMenuContext.Provider>
  );
}

interface ContextMenuTriggerProps {
  children: React.ReactNode;
  className?: string;
  asChild?: boolean;
}

function ContextMenuTrigger({ children, className, asChild = false }: ContextMenuTriggerProps) {
  const { openMenu } = useContextMenu();

  const handleContextMenu = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openMenu({ x: e.clientX, y: e.clientY });
  }, [openMenu]);

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement, {
      className: cn((children as React.ReactElement).props.className, className),
      onContextMenu: (e: React.MouseEvent) => {
        (children as React.ReactElement).props.onContextMenu?.(e);
        if (!e.defaultPrevented) {
          handleContextMenu(e);
        }
      },
    });
  }

  return (
    <div className={className} onContextMenu={handleContextMenu}>
      {children}
    </div>
  );
}

interface ContextMenuContentProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

function ContextMenuContent({
  children,
  className,
  ...props
}: ContextMenuContentProps) {
  const { open, position } = useContextMenu();
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [adjustedPosition, setAdjustedPosition] = React.useState(position);

  React.useEffect(() => {
    if (!open || !contentRef.current) return;

    const rect = contentRef.current.getBoundingClientRect();
    const padding = 8;

    let x = position.x;
    let y = position.y;

    if (x + rect.width > window.innerWidth - padding) {
      x = window.innerWidth - rect.width - padding;
    }
    if (y + rect.height > window.innerHeight - padding) {
      y = window.innerHeight - rect.height - padding;
    }

    if (x < padding) x = padding;
    if (y < padding) y = padding;

    setAdjustedPosition({ x, y });
  }, [open, position]);

  if (!open) return null;

  return createPortal(
    <div
      ref={contentRef}
      data-context-menu-content
      className={cn(
        "z-50 min-w-48 rounded-md border bg-card py-1 shadow-md outline-none",
        className
      )}
      style={{
        position: "fixed",
        left: adjustedPosition.x,
        top: adjustedPosition.y,
      }}
      {...props}
    >
      {children}
    </div>,
    document.body
  );
}

interface ContextMenuItemProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  disabled?: boolean;
  inset?: boolean;
  onSelect?: () => void;
}

function ContextMenuItem({
  children,
  className,
  disabled,
  inset,
  onSelect,
  onClick,
  ...props
}: ContextMenuItemProps) {
  const { closeMenu } = useContextMenu();

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    onClick?.(e);
    if (disabled) return;
    onSelect?.();
    closeMenu();
  };

  return (
    <div
      role="menuitem"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      data-disabled={disabled ? "" : undefined}
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors",
        "hover:bg-accent focus:bg-accent",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        inset && "pl-8",
        className
      )}
      onClick={handleClick}
      {...props}
    >
      {children}
    </div>
  );
}

function ContextMenuSeparator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function ContextMenuIcon({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("h-4 w-4 text-muted-foreground flex items-center justify-center shrink-0", className)}
      {...props}
    >
      {children}
    </span>
  );
}

function ContextMenuShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuIcon,
  ContextMenuShortcut,
};

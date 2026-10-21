"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

type ContextMenuContextType = {
  open: boolean;
  position: { x: number; y: number };
  openMenu: (pos: { x: number; y: number }) => void;
  closeMenu: (reason?: ContextMenuCloseReason) => void;
};

/**
 * 关闭原因：escape/select 会把焦点还给菜单打开前的元素（键盘可达性）；
 * dismiss（点外面/滚动/resize）不抢焦点，交给浏览器默认行为。
 */
export type ContextMenuCloseReason = "escape" | "select" | "dismiss";

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
  /** 打开/关闭回调（状态变化沿时触发一次）。 */
  onOpenChange?: (open: boolean) => void;
}

function ContextMenu({ children, onOpenChange }: ContextMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const openRef = React.useRef(false);
  const activeElementRef = React.useRef<HTMLElement | null>(null);
  const onOpenChangeRef = React.useRef(onOpenChange);
  React.useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  const openMenu = React.useCallback((pos: { x: number; y: number }) => {
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      activeElementRef.current = document.activeElement;
    }
    setPosition(pos);
    if (!openRef.current) {
      openRef.current = true;
      setOpen(true);
      onOpenChangeRef.current?.(true);
    }
  }, []);

  const closeMenu = React.useCallback((reason: ContextMenuCloseReason = "select") => {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    onOpenChangeRef.current?.(false);
    if (reason === "escape" || reason === "select") {
      const element = activeElementRef.current;
      activeElementRef.current = null;
      // 焦点已离开（元素卸载/被浏览器接管）时不强行拉回
      if (element instanceof HTMLElement && element.isConnected) {
        element.focus({ preventScroll: true });
      }
    } else {
      activeElementRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-context-menu-content]")) return;
      closeMenu("dismiss");
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeMenu("escape");
      }
    };

    const handleScroll = () => {
      closeMenu("dismiss");
    };

    const handleResize = () => {
      closeMenu("dismiss");
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleResize);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleResize);
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
  role = "menu",
  onKeyDown,
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

  /** ↑/↓/Home/End 在菜单项间移动焦点（与画布「显示」菜单一致的方向键语义）。 */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const key = event.key;
    if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;
    const items = Array.from(
      contentRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-disabled])') ?? []
    );
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next =
      key === "Home" ? items[0]
      : key === "End" ? items[items.length - 1]
      : items[(current + (key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
    next?.focus();
  };

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
      role={role}
      onKeyDown={handleKeyDown}
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
  onKeyDown,
  ...props
}: ContextMenuItemProps) {
  const { closeMenu } = useContextMenu();

  const activate = () => {
    if (disabled) return;
    onSelect?.();
    closeMenu("select");
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    onClick?.(e);
    activate();
  };

  /** div role=menuitem 不会原生响应 Enter/Space，这里补齐键盘激活。 */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      activate();
    }
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
      onKeyDown={handleKeyDown}
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
  useContextMenu,
};

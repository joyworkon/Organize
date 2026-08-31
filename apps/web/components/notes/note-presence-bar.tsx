"use client";

import { CollabPeer } from "@/hooks/use-note-collab";
import { cn } from "@/lib/utils";

/**
 * 实时协作出席栏（P5-03）：显示房间内其他协作者的头像栈。
 * 颜色即远端光标颜色（CollaborationCursor 与本栏同源，按 userId 哈希取色）。
 */
export function NotePresenceBar({
  peers,
  className,
}: {
  peers: CollabPeer[];
  className?: string;
}) {
  if (peers.length === 0) return null;
  return (
    <div
      className={cn("hidden items-center -space-x-1.5 md:flex", className)}
      title={peers.map((peer) => peer.user.name).join("、") + " 正在协作"}
    >
      {peers.slice(0, 5).map((peer) => (
        <span
          key={peer.clientId}
          className="grid h-6 w-6 place-items-center rounded-full border-2 border-background text-[11px] font-medium text-white"
          style={{ backgroundColor: peer.user.color }}
          title={peer.user.name}
        >
          {(peer.user.name || "?").slice(0, 1).toUpperCase()}
        </span>
      ))}
      {peers.length > 5 && (
        <span className="grid h-6 w-6 place-items-center rounded-full border-2 border-background bg-muted text-[10px] text-muted-foreground">
          +{peers.length - 5}
        </span>
      )}
    </div>
  );
}

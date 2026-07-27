"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { FavoriteTargetType } from "@organize/shared";

interface FavoriteButtonProps {
  targetType: FavoriteTargetType;
  targetId: string;
  initialFavorited?: boolean;
  className?: string;
  iconClassName?: string;
}

export function FavoriteButton({
  targetType,
  targetId,
  initialFavorited,
  className,
  iconClassName,
}: FavoriteButtonProps) {
  const supabase = createClient();
  const [isFavorited, setIsFavorited] = useState(initialFavorited ?? false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(initialFavorited !== undefined);

  useEffect(() => {
    if (initialFavorited !== undefined) {
      setIsFavorited(initialFavorited);
      setHasInitialized(true);
      return;
    }

    let mounted = true;
    async function checkFavorite() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("favorites")
        .select("id")
        .eq("user_id", user.id)
        .eq("target_type", targetType)
        .eq("target_id", targetId)
        .maybeSingle();
      if (mounted) {
        setIsFavorited(!!data);
        setHasInitialized(true);
      }
    }
    checkFavorite();
    return () => { mounted = false; };
  }, [supabase, targetType, targetId, initialFavorited]);

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isLoading) return;
    setIsLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({ title: "请先登录", variant: "destructive" });
        return;
      }

      if (isFavorited) {
        const { error } = await supabase
          .from("favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("target_type", targetType)
          .eq("target_id", targetId);
        if (error) throw error;
        setIsFavorited(false);
        toast({ title: "已取消收藏" });
      } else {
        const { error } = await supabase
          .from("favorites")
          .insert({
            user_id: user.id,
            target_type: targetType,
            target_id: targetId,
          });
        if (error) throw error;
        setIsFavorited(true);
        toast({ title: "已收藏" });
      }
    } catch (err) {
      toast({ title: "操作失败", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={isLoading || !hasInitialized}
      className={cn(
        "inline-flex items-center justify-center rounded-md transition-colors",
        "hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
        "h-10 w-10",
        isFavorited ? "text-yellow-500 hover:text-yellow-600" : "text-muted-foreground hover:text-yellow-500",
        className
      )}
      title={isFavorited ? "取消收藏" : "收藏"}
    >
      <Star
        className={cn("h-4 w-4", isFavorited && "fill-current", iconClassName)}
      />
    </button>
  );
}

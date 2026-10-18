"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Star } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  FAVORITE_CHECK_ERROR_TITLE,
  resolveFavoriteCheck,
} from "@/lib/favorites/favorite-check";
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
  const supabase = useMemo(() => createClient(), []);
  const [isFavorited, setIsFavorited] = useState(initialFavorited ?? false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(initialFavorited !== undefined);
  const [checkFailed, setCheckFailed] = useState(false);
  const mountedRef = useRef(true);

  // 读取收藏状态；返回查询是否成功（未登录保持原行为：不置 hasInitialized）。
  // 读取失败时不改 isFavorited，只进 checkFailed（点击 = 重试读取，不写库）。
  const loadFavorite = useCallback(async (): Promise<boolean> => {
    setIsLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return true;
      const { data, error } = await supabase
        .from("favorites")
        .select("id")
        .eq("user_id", user.id)
        .eq("target_type", targetType)
        .eq("target_id", targetId)
        .maybeSingle();
      if (!mountedRef.current) return true;
      const result = resolveFavoriteCheck({ data, error });
      if (result.ok) {
        setIsFavorited(result.favorited);
        setCheckFailed(false);
      } else {
        setCheckFailed(true);
      }
      setHasInitialized(true);
      return result.ok;
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [supabase, targetType, targetId]);

  useEffect(() => {
    mountedRef.current = true;
    if (initialFavorited !== undefined) {
      setIsFavorited(initialFavorited);
      setHasInitialized(true);
      return;
    }
    loadFavorite();
    return () => {
      mountedRef.current = false;
    };
  }, [loadFavorite, initialFavorited]);

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isLoading) return;

    if (checkFailed) {
      const ok = await loadFavorite();
      if (!ok) {
        toast({ title: FAVORITE_CHECK_ERROR_TITLE, variant: "destructive" });
      }
      return;
    }

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

  const label = checkFailed
    ? FAVORITE_CHECK_ERROR_TITLE
    : isFavorited
      ? "取消收藏"
      : "收藏";

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
      title={label}
      aria-label={label}
    >
      <Star
        className={cn("h-4 w-4", isFavorited && "fill-current", iconClassName)}
      />
    </button>
  );
}

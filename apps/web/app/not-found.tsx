import Link from "next/link";

/** 全局 404 页面（P2-01） */
export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <p className="text-5xl font-bold text-muted-foreground">404</p>
        <h2 className="text-lg font-semibold">页面不存在</h2>
        <p className="text-sm text-muted-foreground">
          你访问的页面可能已被移动或删除。
        </p>
        <Link
          href="/"
          className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          回到首页
        </Link>
      </div>
    </div>
  );
}

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-3">
          <span className="font-semibold">Organize</span>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">分享不存在</h1>
          <p className="text-muted-foreground">
            链接可能已失效，或分享者已撤销
          </p>
          <Link href="/" className="inline-block mt-4 text-sm text-primary hover:underline">
            了解 Organize →
          </Link>
        </div>
      </main>
    </div>
  );
}

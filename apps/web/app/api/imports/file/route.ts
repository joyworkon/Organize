import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/imports/file?id=<importFileId> — 下载导入原件（阶段 D）。
 *
 * import-files 是私有桶，无公共读；此路由先校验记录归属（RLS 双保险），
 * 再经服务端存储权限取回字节流式返回。嵌入图片走同一记录行（原件同目录），
 * 由 importFiles 行的 storage_path 派生路径不可行——图片下载用 ?path= 直接寻址
 * 仅当该 path 属于当前用户目录时才放行。
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  const directPath = request.nextUrl.searchParams.get("path");

  let storagePath: string;
  let downloadName: string;
  let mime = "application/octet-stream";

  if (id) {
    const { data: row } = await supabase
      .from("import_files")
      .select("storage_path, file_name, mime, user_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!row?.storage_path) return NextResponse.json({ error: "文件不存在或未上传原件" }, { status: 404 });
    storagePath = row.storage_path;
    downloadName = row.file_name;
    mime = row.mime || mime;
  } else if (directPath) {
    // 嵌入图片等派生原件：路径必须在当前用户目录下（桶策略同款校验）
    if (!directPath.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: "无权访问" }, { status: 403 });
    }
    storagePath = directPath;
    downloadName = directPath.split("/").pop() ?? "file";
  } else {
    return NextResponse.json({ error: "缺少 id 或 path" }, { status: 400 });
  }

  const { data, error } = await supabase.storage.from("import-files").download(storagePath);
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "原件读取失败" }, { status: 404 });
  }

  const bytes = await data.arrayBuffer();
  // 汉字文件名按 RFC 5987 编码
  const encoded = encodeURIComponent(downloadName);
  return new Response(bytes, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
      "Content-Length": String(bytes.byteLength),
    },
  });
}

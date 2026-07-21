import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/upload - 上传图片到 Supabase Storage
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "未提供文件" }, { status: 400 });
  }

  // 验证文件类型
  const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json(
      { error: "仅支持 JPEG、PNG、GIF、WebP、SVG 格式" },
      { status: 400 }
    );
  }

  // 验证文件大小 (最大 5MB)
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "文件大小不能超过 5MB" }, { status: 400 });
  }

  const ext = file.name.split(".").pop() || "png";
  const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("images")
    .upload(fileName, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("images").getPublicUrl(fileName);

  return NextResponse.json({ url: publicUrl });
}

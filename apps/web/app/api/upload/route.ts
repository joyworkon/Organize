import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// 图片走 images bucket（保持原有白名单与 5MB 限制）
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
// 其余类型（视频 / 音频 / 文档等附件）走 attachments bucket，上限 50MB
const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;

// POST /api/upload - 上传文件到 Supabase Storage（图片 → images，其他 → attachments）
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

  const mime = file.type || "application/octet-stream";
  const isImage = IMAGE_TYPES.includes(mime);

  // 图片沿用严格白名单；非图片按通用附件放行（大小受限、按用户目录隔离）
  if (mime.startsWith("image/") && !isImage) {
    return NextResponse.json(
      { error: "仅支持 JPEG、PNG、GIF、WebP、SVG 图片格式" },
      { status: 400 }
    );
  }

  const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_ATTACHMENT_SIZE;
  if (file.size > maxSize) {
    return NextResponse.json(
      { error: isImage ? "图片大小不能超过 5MB" : "附件大小不能超过 50MB" },
      { status: 400 }
    );
  }

  const bucket = isImage ? "images" : "attachments";
  // 附件名可能含中文等字符，扩展名提取后统一用 ASCII 随机名存储
  const ext = (file.name.split(".").pop() || "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "bin";
  const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(fileName, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: mime,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(bucket).getPublicUrl(fileName);

  return NextResponse.json({
    url: publicUrl,
    name: file.name,
    size: file.size,
    mime,
  });
}

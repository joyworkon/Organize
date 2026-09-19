import { NextRequest, NextResponse } from "next/server";
import type { MaterialRequest } from "@organize/plugin-sdk";
import { createClient } from "@/lib/supabase/server";
import { getAIConfig, redactSecret } from "@/lib/ai/server";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { isMockBackend } from "@/lib/env";
import { organizeMaterials } from "@/lib/materials/server";
import { MAX_MATERIAL_BYTES, validateMaterialRequest } from "@/lib/materials/schema";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (isMockBackend()) return NextResponse.json({ error: "演示模式不调用真实 AI，请连接后端并配置 AI 服务" }, { status: 501 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未授权" }, { status: 401 });
  if (!await checkRateLimit(`ai:materials:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: "整理请求过于频繁，请一分钟后再试" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  // 在 multipart 解析前限制真实读取量，不信任客户端的 Content-Length。
  const maxBodyBytes = MAX_MATERIAL_BYTES + 512 * 1024;
  if (Number(request.headers.get("content-length")) > maxBodyBytes) {
    return NextResponse.json({ error: "物料请求过大，每批文件上限 20MB" }, { status: 413 });
  }
  let input: MaterialRequest;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("请添加物料");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBodyBytes) {
        await reader.cancel();
        return NextResponse.json({ error: "物料请求过大，每批文件上限 20MB" }, { status: 413 });
      }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
    const entries = form.getAll("files");
    if (!entries.every((file) => file instanceof File)) throw new Error("文件格式无效");
    const mode = form.get("mode");
    if (mode !== "extract" && mode !== "organize") throw new Error("不支持的整理模式");
    const rawText = form.get("text");
    if (rawText !== null && typeof rawText !== "string") throw new Error("文字格式无效");
    input = { files: entries as File[], text: rawText ?? "", mode };
    validateMaterialRequest(input);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "物料格式无效" }, { status: 400 });
  }
  let secret = "";
  try {
    const config = await getAIConfig(supabase, user.id);
    secret = config.apiKey;
    return NextResponse.json(await organizeMaterials(config, input));
  } catch (error) {
    return NextResponse.json({ error: redactSecret(error instanceof Error ? error.message : "物料整理失败", secret) }, { status: 502 });
  }
}

import { NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

// 后端 agent (deep-agents-harness) 的交付物输出目录。
// 可用环境变量 AGENT_OUTPUTS_DIR 覆盖;默认取与本项目同级的 deep-agents-harness/outputs。
const OUTPUTS_DIR = path.resolve(
  process.env.AGENT_OUTPUTS_DIR ??
    path.resolve(process.cwd(), "..", "deep-agents-harness", "outputs")
);

// 只允许下载这几类交付物,防止把接口当成任意文件读取器
const ALLOWED_EXTENSIONS = new Set([".md", ".xlsx", ".xmind", ".html"]);

const MIME_TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xmind": "application/octet-stream",
  ".html": "text/html; charset=utf-8",
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get("file") ?? "";

  // 安全校验:只取 basename,拒绝路径穿越与不允许的扩展名
  const base = path.basename(file);
  const ext = path.extname(base).toLowerCase();
  if (!base || base !== file || !ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: "非法的文件名" }, { status: 400 });
  }

  const filePath = path.join(OUTPUTS_DIR, base);
  try {
    await stat(filePath);
  } catch {
    return NextResponse.json(
      { error: `文件不存在:${base}。请确认测试用例已生成完毕。` },
      { status: 404 }
    );
  }

  try {
    const buf = await readFile(filePath);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base)}`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "读取文件失败" },
      { status: 500 }
    );
  }
}

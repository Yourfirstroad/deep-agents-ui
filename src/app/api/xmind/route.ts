import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 30;

// md → xmind 转换脚本（deep agents 项目里的 scripts/md_to_xmind.py）
const SCRIPT =
  process.env.XMIND_CONVERTER_SCRIPT ??
  path.resolve(process.cwd(), "..", "deep agents", "scripts", "md_to_xmind.py");

function runConverter(mdPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [SCRIPT, mdPath, outPath]);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", () => reject(new Error("无法启动 python3")));
    proc.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(stderr.trim() || `转换脚本退出码 ${code}`))
    );
  });
}

export async function POST(request: Request) {
  let body: { markdown?: unknown; filename?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误，需要 JSON" }, { status: 400 });
  }
  const { markdown, filename } = body;
  if (typeof markdown !== "string" || !markdown.trim()) {
    return NextResponse.json({ error: "缺少 markdown 内容" }, { status: 400 });
  }

  const dir = await mkdtemp(path.join(tmpdir(), "xmind-"));
  try {
    const mdPath = path.join(dir, "mindmap.md");
    const outPath = path.join(dir, "out.xmind");
    await writeFile(mdPath, markdown, "utf-8");
    await runConverter(mdPath, outPath);
    const buf = await readFile(outPath);

    const base =
      typeof filename === "string" && filename.trim()
        ? filename.replace(/\.md$/i, "").split("/").pop()!
        : "mindmap";
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base + ".xmind")}`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "转换失败" },
      { status: 500 }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 30;

// Markdown 表格 → xlsx 转换脚本（deep agents 项目里的 scripts/md_table_to_xlsx.py）
const SCRIPT =
  process.env.EXCEL_CONVERTER_SCRIPT ??
  path.resolve(
    process.cwd(),
    "..",
    "deep agents",
    "scripts",
    "md_table_to_xlsx.py"
  );

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

  const dir = await mkdtemp(path.join(tmpdir(), "xlsx-"));
  try {
    const mdPath = path.join(dir, "testcases.md");
    const outPath = path.join(dir, "out.xlsx");
    await writeFile(mdPath, markdown, "utf-8");
    await runConverter(mdPath, outPath);
    const buf = await readFile(outPath);

    const base =
      typeof filename === "string" && filename.trim()
        ? filename.replace(/\.md$/i, "").split("/").pop()!
        : "testcases";
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(base + ".xlsx")}`,
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

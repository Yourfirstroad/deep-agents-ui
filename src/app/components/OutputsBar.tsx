"use client";

import React, { useCallback, useMemo, useState } from "react";
import {
  FileText,
  FileSpreadsheet,
  Network,
  Eye,
  Loader2,
  X,
  Map,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { MarkdownContent } from "@/app/components/MarkdownContent";
import type { FilesMap, FileData } from "@/app/types/types";
import type { Message } from "@langchain/langgraph-sdk";

const getFileContent = (v: string | FileData | undefined): string => {
  if (!v) return "";
  if (typeof v === "string") return v;
  return typeof v.content === "string" ? v.content : "";
};

/** 与后端 MARKMAP_HTML_TEMPLATE 相同结构的兜底模板（只有 md 没有 html 时用） */
const buildMarkmapHtml = (md: string) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>测试点思维导图</title>
<style>
  html, body { height: 100%; margin: 0; }
  .markmap { height: 100vh; width: 100vw; }
  .markmap > svg { height: 100%; width: 100%; }
</style>
</head>
<body>
<div class="markmap">
<script type="text/template">
${md}
</script>
</div>
<script src="https://cdn.jsdelivr.net/npm/markmap-autoloader@0.18"></script>
</body>
</html>
`;

interface CaseStats {
  total: number;
  high: number;
  medium: number;
  low: number;
}

function parseCaseStats(md: string): CaseStats | null {
  const lines = md.split("\n").filter((l) => l.trim().startsWith("|"));
  if (!lines.some((l) => l.includes("用例编号"))) return null;
  const stats: CaseStats = { total: 0, high: 0, medium: 0, low: 0 };
  for (const line of lines) {
    if (line.includes("用例编号") || /^\s*\|[\s:|-]+\|\s*$/.test(line)) continue;
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    stats.total += 1;
    const priority = cells[cells.length - 1];
    if (priority.includes("高")) stats.high += 1;
    else if (priority.includes("中")) stats.medium += 1;
    else if (priority.includes("低")) stats.low += 1;
  }
  return stats.total > 0 ? stats : null;
}

type Preview =
  | { kind: "md"; title: string; content: string }
  | { kind: "html"; title: string; html: string };

export function OutputsBar({
  files,
  messages,
}: {
  files: FilesMap;
  messages: Message[];
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [exporting, setExporting] = useState<"excel" | "xmind" | null>(null);

  // ---- 从虚拟文件系统和消息记录中收集产出物 ----
  const docs = useMemo(
    () => Object.keys(files).filter((k) => k.startsWith("/uploads/")),
    [files]
  );

  const mindmapHtml = useMemo(() => {
    const key = Object.keys(files).find((k) => /-mindmap\.html$/i.test(k));
    return key ? getFileContent(files[key]) : null;
  }, [files]);

  // 思维导图 Markdown 来源：优先 /outputs/*-mindmap.md；
  // 旧会话只有 HTML 时，从 markmap 模板的 <script type="text/template"> 里提取
  const mindmap = useMemo(() => {
    const key = Object.keys(files).find((k) => /-mindmap\.md$/i.test(k));
    if (key) return { name: key, content: getFileContent(files[key]) };
    if (mindmapHtml) {
      const m = mindmapHtml.match(
        /<script type="text\/template">([\s\S]*?)<\/script>/
      );
      if (m?.[1]?.trim()) {
        return { name: "测试点-mindmap.md", content: m[1].trim() };
      }
    }
    return null;
  }, [files, mindmapHtml]);

  // 用例表来源：优先虚拟文件系统里的 -testcases.md（旧流程），
  // 否则取最近一次 generate_testcase_excel 工具调用的入参（新流程，文件直接落盘）
  const cases = useMemo(() => {
    const key = Object.keys(files).find((k) => /-testcases\.md$/i.test(k));
    if (key) {
      return { md: getFileContent(files[key]), savedPath: undefined as string | undefined };
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as any;
      const call = msg?.tool_calls?.find(
        (tc: any) => tc?.name === "generate_testcase_excel"
      );
      if (call?.args?.markdown_table) {
        // 找到对应的工具返回（保存路径）
        let savedPath: string | undefined;
        for (let j = i + 1; j < messages.length; j++) {
          const m = messages[j] as any;
          if (m?.type === "tool" && m?.tool_call_id === call.id) {
            savedPath = typeof m.content === "string" ? m.content : undefined;
            break;
          }
        }
        return { md: String(call.args.markdown_table), savedPath };
      }
    }
    return null;
  }, [files, messages]);

  const caseStats = useMemo(
    () => (cases ? parseCaseStats(cases.md) : null),
    [cases]
  );

  // ---- 导出 ----
  const exportFile = useCallback(
    async (api: string, ext: string, label: string, md: string, name: string) => {
      setExporting(ext === "xlsx" ? "excel" : "xmind");
      try {
        const resp = await fetch(api, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ markdown: md, filename: name }),
        });
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          toast.error(`${label}导出失败：${data.error ?? `HTTP ${resp.status}`}`);
          return;
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${name.replace(/\.md$/i, "")}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success(`已导出 ${label} 文件`);
      } catch {
        toast.error(`${label}导出失败：网络错误`);
      } finally {
        setExporting(null);
      }
    },
    []
  );

  if (docs.length === 0 && !cases && !mindmap) return null;

  const baseName = (p: string) => p.split("/").pop() ?? p;

  return (
    <div className="animate-msg-in mb-2 space-y-2 rounded-2xl border border-border/60 bg-muted/40 p-3 shadow-sm">
      <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground">
        <span className="font-semibold tracking-wide">产出文件</span>
        {docs.length > 0 && <span>文档 {docs.length}</span>}
        {cases && <span>用例 {caseStats?.total ?? "?"} 条</span>}
        {mindmap && <span>思维导图 1</span>}
      </div>

      {/* 需求文档 */}
      {docs.map((d) => (
        <div
          key={d}
          className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background px-3 py-2 shadow-sm transition-shadow hover:shadow"
        >
          <div className="flex min-w-0 items-center gap-2">
            <FileText size={16} className="shrink-0 text-primary/60" />
            <span className="truncate text-sm">{baseName(d)}</span>
            <span className="shrink-0 text-xs text-muted-foreground">需求文档</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() =>
              setPreview({ kind: "md", title: baseName(d), content: getFileContent(files[d]) })
            }
          >
            <Eye size={13} className="mr-1" />
            预览
          </Button>
        </div>
      ))}

      {/* 测试用例 */}
      {cases && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-background px-3 py-2 shadow-sm transition-shadow hover:shadow">
          <div className="flex min-w-0 items-center gap-2">
            <FileSpreadsheet size={16} className="shrink-0 text-primary/60" />
            <span className="truncate text-sm font-medium">测试用例</span>
            {caseStats && (
              <span className="flex shrink-0 items-center gap-1.5 text-xs">
                <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700 dark:bg-red-950 dark:text-red-300">
                  高 {caseStats.high}
                </span>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  中 {caseStats.medium}
                </span>
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  低 {caseStats.low}
                </span>
              </span>
            )}
            {cases.savedPath && (
              <span className="hidden max-w-[280px] truncate text-xs text-muted-foreground xl:inline">
                {cases.savedPath}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setPreview({ kind: "md", title: "测试用例表", content: cases.md })}
            >
              <Eye size={13} className="mr-1" />
              预览用例表
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={exporting !== null}
              onClick={() =>
                exportFile("/api/excel", "xlsx", "Excel", cases.md, "测试用例")
              }
            >
              {exporting === "excel" ? (
                <Loader2 size={13} className="mr-1 animate-spin" />
              ) : (
                <FileSpreadsheet size={13} className="mr-1" />
              )}
              导出 Excel
            </Button>
          </div>
        </div>
      )}

      {/* 思维导图 */}
      {mindmap && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-background px-3 py-2 shadow-sm transition-shadow hover:shadow">
          <div className="flex min-w-0 items-center gap-2">
            <Network size={16} className="shrink-0 text-primary/60" />
            <span className="truncate text-sm font-medium">测试点思维导图</span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() =>
                setPreview({
                  kind: "html",
                  title: "测试点思维导图",
                  html: mindmapHtml ?? buildMarkmapHtml(mindmap.content),
                })
              }
            >
              <Map size={13} className="mr-1" />
              用例思维导图
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={exporting !== null}
              onClick={() =>
                exportFile("/api/xmind", "xmind", "XMind", mindmap.content, mindmap.name)
              }
            >
              {exporting === "xmind" ? (
                <Loader2 size={13} className="mr-1 animate-spin" />
              ) : (
                <Network size={13} className="mr-1" />
              )}
              下载 XMind
            </Button>
          </div>
        </div>
      )}

      {/* 预览弹窗 */}
      <Dialog open={preview !== null} onOpenChange={() => setPreview(null)}>
        <DialogContent className="flex h-[85vh] max-h-[85vh] min-w-[70vw] flex-col p-4">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <DialogTitle className="text-sm font-medium">
              {preview?.title}
            </DialogTitle>
            <Button variant="ghost" size="icon" onClick={() => setPreview(null)}>
              <X size={16} />
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            {preview?.kind === "md" && (
              <ScrollArea className="h-full rounded-md bg-surface">
                <div className="p-6">
                  <MarkdownContent content={preview.content} />
                </div>
              </ScrollArea>
            )}
            {preview?.kind === "html" && (
              <iframe
                srcDoc={preview.html}
                title={preview.title}
                className="h-full w-full rounded-md border border-border bg-white"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

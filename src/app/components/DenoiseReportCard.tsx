"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, FileDiff } from "lucide-react";
import type { ParseReport } from "@/app/types/types";
import { Button } from "@/components/ui/button";
import { DiffDialog } from "@/app/components/DiffDialog";

const RULE_LABELS: Record<string, string> = {
  R1: "页眉页脚",
  R2: "跨页重复",
  R3: "孤立页码",
  R4: "空图片占位",
  R5: "空行压缩",
};

/**
 * 降噪结果统计卡:规则分布 + 刹车警示 + 明细抽查 + 原文对比入口。
 * 展示在上传完成后的消息区上方(输入框附近)。
 */
export function DenoiseReportCard({ report }: { report: ParseReport }) {
  const [showRemovals, setShowRemovals] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const { denoise } = report;

  if (!denoise) {
    return (
      <div className="mb-2 rounded-lg border border-dashed border-muted-foreground/30 px-3 py-2 text-xs text-muted-foreground">
        「{report.fileName}」
        {report.denoiseError
          ? `降噪失败(已使用原文):${report.denoiseError}`
          : "降噪未启用,已使用原始解析结果"}
      </div>
    );
  }

  const total = denoise.removals.length;

  return (
    <div className="mb-2 rounded-lg border bg-card px-3 py-2 text-xs shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">降噪完成:「{report.fileName}」</span>
        {denoise.aborted ? (
          <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-red-700 dark:bg-red-950 dark:text-red-300">
            <AlertTriangle size={12} />
            删除量超安全阈值,已保留原文
          </span>
        ) : total === 0 ? (
          <span className="text-muted-foreground">未发现噪音内容</span>
        ) : (
          <span className="text-muted-foreground">共删除 {total} 处噪音</span>
        )}
        {Object.entries(denoise.stats)
          .filter(([k, v]) => k.startsWith("R") && v > 0)
          .map(([k, v]) => (
            <span
              key={k}
              className="rounded bg-muted px-1.5 py-0.5"
              title={k}
            >
              {RULE_LABELS[k] ?? k} {v}
            </span>
          ))}
        <span className="flex-1" />
        {report.artifacts?.report_md && (
          <a
            className="inline-flex h-6 items-center rounded px-2 text-xs text-primary hover:bg-accent"
            href={`/api/download?file=${encodeURIComponent(report.artifacts.report_md)}`}
            title="下载人读降噪报告"
          >
            报告
          </a>
        )}
        {report.artifacts?.audit_json && (
          <a
            className="inline-flex h-6 items-center rounded px-2 text-xs text-primary hover:bg-accent"
            href={`/api/download?file=${encodeURIComponent(report.artifacts.audit_json)}`}
            title="下载机器可读审计 JSON"
          >
            审计
          </a>
        )}
        {report.artifacts?.raw_md && (
          <a
            className="inline-flex h-6 items-center rounded px-2 text-xs text-primary hover:bg-accent"
            href={`/api/download?file=${encodeURIComponent(report.artifacts.raw_md)}`}
            title="下载降噪前原始版"
          >
            原始版
          </a>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={() => setDiffOpen(true)}
        >
          <FileDiff size={13} className="mr-1" />
          对比原文
        </Button>
        {total > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setShowRemovals((v) => !v)}
          >
            {showRemovals ? (
              <ChevronUp size={13} className="mr-1" />
            ) : (
              <ChevronDown size={13} className="mr-1" />
            )}
            删除明细
          </Button>
        )}
      </div>

      {showRemovals && total > 0 && (
        <div className="mt-2 max-h-48 overflow-y-auto rounded border bg-muted/40 p-2 font-mono">
          {denoise.removals.map((r, i) => (
            <div key={i} className="truncate" title={r.text}>
              <span className="text-muted-foreground">
                [{r.rule_id}
                {r.page_no ? ` p${r.page_no}` : ""}
                {r.line_no ? ` L${r.line_no}` : ""}]
              </span>{" "}
              {r.text}
            </div>
          ))}
        </div>
      )}

      <DiffDialog
        open={diffOpen}
        onOpenChange={setDiffOpen}
        fileName={report.fileName}
        rawMarkdown={report.rawMarkdown}
        cleanedMarkdown={report.markdown}
      />
    </div>
  );
}

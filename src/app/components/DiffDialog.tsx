"use client";

import { useMemo } from "react";
import { diffLines } from "diff";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DiffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  rawMarkdown: string;
  cleanedMarkdown: string;
}

/**
 * 降噪前后行级对比:红色 = 被删(降噪移除),绿色 = 新增,灰色 = 未变。
 * 连续未变超过 6 行的段落折叠为「··· N 行未变 ···」,聚焦差异。
 */
export function DiffDialog({
  open,
  onOpenChange,
  fileName,
  rawMarkdown,
  cleanedMarkdown,
}: DiffDialogProps) {
  const rows = useMemo(() => {
    const parts = diffLines(rawMarkdown, cleanedMarkdown);
    const out: Array<{ type: "same" | "removed" | "added" | "fold"; text: string }> = [];
    let sameBuffer: string[] = [];
    const flushSame = () => {
      if (sameBuffer.length <= 6) {
        sameBuffer.forEach((l) => out.push({ type: "same", text: l }));
      } else {
        sameBuffer.slice(0, 3).forEach((l) => out.push({ type: "same", text: l }));
        out.push({ type: "fold", text: `··· ${sameBuffer.length - 6} 行未变 ···` });
        sameBuffer.slice(-3).forEach((l) => out.push({ type: "same", text: l }));
      }
      sameBuffer = [];
    };
    for (const part of parts) {
      const lines = part.value.replace(/\n$/, "").split("\n");
      if (part.added) {
        flushSame();
        lines.forEach((l) => out.push({ type: "added", text: l }));
      } else if (part.removed) {
        flushSame();
        lines.forEach((l) => out.push({ type: "removed", text: l }));
      } else {
        sameBuffer.push(...lines);
      }
    }
    flushSame();
    return out;
  }, [rawMarkdown, cleanedMarkdown]);

  const removedCount = rows.filter((r) => r.type === "removed").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>降噪对比:{fileName}</DialogTitle>
          <DialogDescription>
            红色为降噪删除的内容(共 {removedCount} 行),逐行核对确认没有误删正文。
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1 rounded-md border bg-muted/30">
          <pre className="p-3 font-mono text-xs leading-5">
            {rows.map((r, i) => (
              <div
                key={i}
                className={
                  r.type === "removed"
                    ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                    : r.type === "added"
                      ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                      : r.type === "fold"
                        ? "text-center text-muted-foreground"
                        : "text-muted-foreground"
                }
              >
                {r.type === "removed" ? "- " : r.type === "added" ? "+ " : "  "}
                {r.text || " "}
              </div>
            ))}
          </pre>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

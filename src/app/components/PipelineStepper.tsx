"use client";

import { useMemo } from "react";
import { Check, Loader2 } from "lucide-react";
import type { Message } from "@langchain/langgraph-sdk";
import { cn } from "@/lib/utils";

interface Stage {
  key: string;
  label: string;
  match: (name: string, args: Record<string, unknown>) => boolean;
}

const STAGES: Stage[] = [
  {
    key: "analyze",
    label: "需求分析",
    match: (n, a) => n === "task" && a?.subagent_type === "requirement-analyzer",
  },
  {
    key: "design",
    label: "用例设计",
    match: (n, a) => n === "task" && a?.subagent_type === "testcase-designer",
  },
  { key: "lint", label: "质量检查", match: (n) => n === "lint_testcases" },
  {
    key: "review",
    label: "用例评审",
    match: (n, a) => n === "task" && a?.subagent_type === "testcase-reviewer",
  },
  {
    key: "export",
    label: "导出交付",
    match: (n) => n === "generate_testcase_excel" || n === "generate_xmind",
  },
];

type StageStatus = "done" | "active" | "upcoming";

/**
 * 用例生成流水线步骤条:根据消息里的工具调用推断当前阶段。
 * 只在检测到流水线活动(任一阶段的工具调用)时渲染。
 */
export function PipelineStepper({ messages }: { messages: Message[] }) {
  const statuses = useMemo<StageStatus[] | null>(() => {
    // 有结果的工具调用 id 集合(tool 消息与 ai 消息的 tool_calls 对应)
    const answered = new Set<string>();
    for (const m of messages) {
      if (m.type === "tool" && (m as any).tool_call_id) {
        answered.add((m as any).tool_call_id as string);
      }
    }

    const result: StageStatus[] = STAGES.map(() => "upcoming");
    let anyCall = false;
    for (const m of messages) {
      if (m.type !== "ai") continue;
      for (const tc of (m as any).tool_calls ?? []) {
        const idx = STAGES.findIndex((s) =>
          s.match(tc.name as string, (tc.args ?? {}) as Record<string, unknown>)
        );
        if (idx === -1) continue;
        anyCall = true;
        // 同一阶段可能被多次调用(修订),以最后一次的状态为准
        result[idx] = answered.has(tc.id as string) ? "done" : "active";
      }
    }
    return anyCall ? result : null;
  }, [messages]);

  if (!statuses) return null;

  const allDone = statuses.every((s) => s === "done");

  return (
    <div className="mb-2 flex items-center gap-1 rounded-lg border bg-card px-3 py-2">
      {STAGES.map((stage, i) => {
        const st = statuses[i];
        return (
          <div key={stage.key} className="flex min-w-0 flex-1 items-center">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px]",
                  st === "done" && "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
                  st === "active" && "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
                  st === "upcoming" && "bg-muted text-muted-foreground"
                )}
              >
                {st === "done" ? (
                  <Check size={12} />
                ) : st === "active" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={cn(
                  "truncate text-xs",
                  st === "active" && "font-medium text-blue-700 dark:text-blue-300",
                  st === "done" && "text-green-700 dark:text-green-300",
                  st === "upcoming" && "text-muted-foreground"
                )}
              >
                {stage.label}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div
                className={cn(
                  "mx-2 h-px min-w-2 flex-1",
                  st === "done" ? "bg-green-300" : "bg-border"
                )}
              />
            )}
          </div>
        );
      })}
      {allDone && (
        <span className="ml-2 flex-shrink-0 text-xs text-green-600">已完成</span>
      )}
    </div>
  );
}

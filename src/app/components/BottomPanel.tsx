"use client";

import React, { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Package } from "lucide-react";

/**
 * 把 PipelineStepper + OutputsBar + DenoiseReportCard 三块纵向堆叠收成一个
 * 可折叠面板:默认仅一行摘要(标 "N 文档 · M 用例 · 1 导图 · 状态词"),
 * 不挡聊天窗口的滚动;点开标题栏后下方下拉展开三块详细面板。
 *
 * 状态在组件内自管;展开/折叠按 user agent 的本地偏好记忆(localStorage)。
 * 传入子组件任意三个,默认都会渲染;若全部为空(子组件自己 return null),
 * 本组件也返回 null。
 */

interface BottomPanelProps {
  /** 一行摘要:左侧"产出与进度"前的标签,如 "5 步骤 · 3 文档 · 30 用例" */
  summary: ReactNode;
  /** 折叠时是否显示右上角的小标识徽章 */
  badge?: ReactNode;
  children: ReactNode;
  /** 初始是否展开;默认 false(只一行) */
  defaultOpen?: boolean;
  /** localStorage 记忆键;同一会话不同 thread 之间不互相覆盖 */
  storageKey?: string;
}

export function BottomPanel({
  summary,
  badge,
  children,
  defaultOpen = false,
  storageKey,
}: BottomPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === "1") setOpen(true);
      else if (saved === "0") setOpen(false);
    } catch {
      /* localStorage 不可用时静默忽略 */
    }
  }, [storageKey]);

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, next ? "1" : "0");
        } catch {
          /* 静默忽略 */
        }
      }
      return next;
    });
  };

  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-border/60 bg-muted/40 text-sm shadow-sm">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/60"
      >
        <Package size={14} className="shrink-0 text-primary/70" />
        <span className="text-xs font-medium text-foreground/80">
          产出与进度
        </span>
        <span className="truncate text-xs text-muted-foreground">{summary}</span>
        <span className="flex-1" />
        {badge}
        {open ? (
          <ChevronUp size={14} className="shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="space-y-2 border-t border-border/60 bg-background/60 px-2 py-2">
          {children}
        </div>
      )}
    </div>
  );
}
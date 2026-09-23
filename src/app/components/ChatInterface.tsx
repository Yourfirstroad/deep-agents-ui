"use client";

import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  FormEvent,
  Fragment,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Square,
  ArrowUp,
  CheckCircle,
  Clock,
  Circle,
  FileIcon,
  Paperclip,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { ChatMessage } from "@/app/components/ChatMessage";
import type {
  TodoItem,
  ToolCall,
  ActionRequest,
  ReviewConfig,
} from "@/app/types/types";
import { Assistant, Message } from "@langchain/langgraph-sdk";
import { extractStringFromMessageContent } from "@/app/utils/utils";
import { useChatContext } from "@/providers/ChatProvider";
import { cn } from "@/lib/utils";
import { useStickToBottom } from "use-stick-to-bottom";
import { FilesPopover } from "@/app/components/TasksFilesSidebar";
import { OutputsBar } from "@/app/components/OutputsBar";
import { DenoiseReportCard } from "@/app/components/DenoiseReportCard";
import { PipelineStepper } from "@/app/components/PipelineStepper";
import { BottomPanel } from "@/app/components/BottomPanel";
import type { ParsePhase, ParseReport } from "@/app/types/types";
import { DEFAULT_DENOISE_CONFIG, getConfig } from "@/lib/config";

interface ChatInterfaceProps {
  assistant: Assistant | null;
}

const sanitizeFileName = (name: string) =>
  name
    .replace(/\.pdf$/i, "")
    .replace(/[^\w一-龥-]+/g, "_")
    .slice(0, 60);

const buildDocInstruction = (path: string, fileName: string) =>
  `我已上传需求文档「${fileName}」，解析后的 Markdown 已保存到虚拟文件系统的 ${path}。` +
  `请使用 read_file 阅读该文件，然后严格按以下流程执行：\n` +
  `1. 从文档中提取全部测试点（功能点、边界条件、异常场景），按模块分组；\n` +
  `2. 基于测试点设计测试用例（Markdown 表格，列：用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级，单元格内不要用 | 符号或换行），然后调用 generate_testcase_excel 工具把完整用例表转换为 Excel 文件保存到本机（doc_name 传「${sanitizeFileName(fileName)}」），不要用 write_file 保存 testcases.md；\n` +
  `3. 将测试点组织成思维导图：先用 \`\`\`mindmap 代码块输出 markmap 兼容的 Markdown 缩进列表，再用 write_file 把该 Markdown 原样保存到 /outputs/${sanitizeFileName(fileName)}-mindmap.md（纯标题列表，供导出 XMind 使用），最后按模板将完整 markmap HTML 保存到 /outputs/${sanitizeFileName(fileName)}-mindmap.html。`;

const getStatusIcon = (status: TodoItem["status"], className?: string) => {
  switch (status) {
    case "completed":
      return (
        <CheckCircle
          size={16}
          className={cn("text-success/80", className)}
        />
      );
    case "in_progress":
      return (
        <Clock
          size={16}
          className={cn("text-warning/80", className)}
        />
      );
    default:
      return (
        <Circle
          size={16}
          className={cn("text-tertiary/70", className)}
        />
      );
  }
};

export const ChatInterface = React.memo<ChatInterfaceProps>(({ assistant }) => {
  const [metaOpen, setMetaOpen] = useState<"tasks" | "files" | null>(null);
  const tasksContainerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [input, setInput] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parsePhase, setParsePhase] = useState<ParsePhase | null>(null);
  const [parseDetail, setParseDetail] = useState("");
  const [parseReport, setParseReport] = useState<ParseReport | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { scrollRef, contentRef } = useStickToBottom();

  const {
    stream,
    messages,
    todos,
    files,
    ui,
    setFiles,
    isLoading,
    isThreadLoading,
    interrupt,
    sendMessage,
    stopStream,
    resumeInterrupt,
  } = useChatContext();

  const submitDisabled = isLoading || !assistant;

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      if (e) {
        e.preventDefault();
      }
      const messageText = input.trim();
      if (!messageText || isLoading || submitDisabled) return;
      sendMessage(messageText);
      setInput("");
    },
    [input, isLoading, sendMessage, setInput, submitDisabled]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (submitDisabled) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, submitDisabled]
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // 允许重复选择同一文件
      if (!file || isLoading || isParsing) return;

      setIsParsing(true);
      setParsePhase("parsing");
      setParseReport(null);
      try {
        const fd = new FormData();
        fd.append("file", file);
        // 设置对话框里的降噪参数随请求带给后端(按次生效)
        const dc = getConfig()?.denoise ?? DEFAULT_DENOISE_CONFIG;
        fd.append(
          "denoise_params",
          JSON.stringify({
            enabled: dc.enabled,
            repeat_min_pages: dc.repeatMinPages,
            repeat_maxlen: dc.repeatMaxlen,
            max_delete_ratio: dc.maxDeleteRatio,
            picture_description: dc.pictureDescription,
          })
        );
        const resp = await fetch("/api/parse-document", {
          method: "POST",
          body: fd,
        });
        if (!resp.ok || !resp.body) {
          const data = await resp.json().catch(() => ({}));
          toast.error(`文档解析失败:${data.error ?? `HTTP ${resp.status}`}`);
          return;
        }

        // SSE 流式读取:parsing / denoising / done / error
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let donePayload: Record<string, any> | null = null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const evt of events) {
            const line = evt.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.phase === "parsing" || data.phase === "denoising") {
                setParsePhase(data.phase);
                if (data.detail) setParseDetail(data.detail);
              } else if (data.phase === "done") {
                donePayload = data;
              } else if (data.phase === "error") {
                toast.error(`文档解析失败:${data.error}`);
              }
            } catch {
              /* 忽略不完整的事件行 */
            }
          }
        }
        if (!donePayload) return;

        const path = `/uploads/${sanitizeFileName(file.name)}.md`;
        setParseReport({
          path,
          fileName: file.name,
          markdown: donePayload.markdown,
          rawMarkdown: donePayload.raw_markdown ?? donePayload.markdown,
          denoise: donePayload.denoise ?? null,
          denoiseError: donePayload.denoise_error,
          auditMarkdown: donePayload.audit_markdown ?? null,
          artifacts: donePayload.artifacts ?? undefined,
        });
        toast.success(`已解析「${file.name}」,正在生成测试用例…`);
        // 降噪报告一并注入文件面板(持久可预览),与文档一起进入会话
        const extra: Record<string, string> = { [path]: donePayload.markdown };
        if (donePayload.audit_markdown) {
          extra[`/outputs/${sanitizeFileName(file.name)}-降噪报告.md`] =
            donePayload.audit_markdown;
        }
        sendMessage(buildDocInstruction(path, file.name), extra);
      } catch {
        toast.error("文档解析失败:网络错误");
      } finally {
        setIsParsing(false);
        setParsePhase(null);
      }
    },
    [isLoading, isParsing, sendMessage]
  );

  // TODO: can we make this part of the hook?
  const processedMessages = useMemo(() => {
    /*
     1. Loop through all messages
     2. For each AI message, add the AI message, and any tool calls to the messageMap
     3. For each tool message, find the corresponding tool call in the messageMap and update the status and output
    */
    const messageMap = new Map<
      string,
      { message: Message; toolCalls: ToolCall[] }
    >();
    messages.forEach((message: Message) => {
      if (message.type === "ai") {
        const toolCallsInMessage: Array<{
          id?: string;
          function?: { name?: string; arguments?: unknown };
          name?: string;
          type?: string;
          args?: unknown;
          input?: unknown;
        }> = [];
        if (
          message.additional_kwargs?.tool_calls &&
          Array.isArray(message.additional_kwargs.tool_calls)
        ) {
          toolCallsInMessage.push(...message.additional_kwargs.tool_calls);
        } else if (message.tool_calls && Array.isArray(message.tool_calls)) {
          toolCallsInMessage.push(
            ...message.tool_calls.filter(
              (toolCall: { name?: string }) => toolCall.name !== ""
            )
          );
        } else if (Array.isArray(message.content)) {
          const toolUseBlocks = message.content.filter(
            (block: { type?: string }) => block.type === "tool_use"
          );
          toolCallsInMessage.push(...toolUseBlocks);
        }
        const toolCallsWithStatus = toolCallsInMessage.map(
          (toolCall: {
            id?: string;
            function?: { name?: string; arguments?: unknown };
            name?: string;
            type?: string;
            args?: unknown;
            input?: unknown;
          }) => {
            const name =
              toolCall.function?.name ||
              toolCall.name ||
              toolCall.type ||
              "unknown";
            const args =
              toolCall.function?.arguments ||
              toolCall.args ||
              toolCall.input ||
              {};
            return {
              id: toolCall.id || `tool-${Math.random()}`,
              name,
              args,
              status: interrupt ? "interrupted" : ("pending" as const),
            } as ToolCall;
          }
        );
        messageMap.set(message.id!, {
          message,
          toolCalls: toolCallsWithStatus,
        });
      } else if (message.type === "tool") {
        const toolCallId = message.tool_call_id;
        if (!toolCallId) {
          return;
        }
        for (const [, data] of messageMap.entries()) {
          const toolCallIndex = data.toolCalls.findIndex(
            (tc: ToolCall) => tc.id === toolCallId
          );
          if (toolCallIndex === -1) {
            continue;
          }
          data.toolCalls[toolCallIndex] = {
            ...data.toolCalls[toolCallIndex],
            status: "completed" as const,
            result: extractStringFromMessageContent(message),
          };
          break;
        }
      } else if (message.type === "human") {
        messageMap.set(message.id!, {
          message,
          toolCalls: [],
        });
      }
    });
    const processedArray = Array.from(messageMap.values());
    return processedArray.map((data, index) => {
      const prevMessage = index > 0 ? processedArray[index - 1].message : null;
      return {
        ...data,
        showAvatar: data.message.type !== prevMessage?.type,
      };
    });
  }, [messages, interrupt]);

  const groupedTodos = {
    in_progress: todos.filter((t) => t.status === "in_progress"),
    pending: todos.filter((t) => t.status === "pending"),
    completed: todos.filter((t) => t.status === "completed"),
  };

  const hasTasks = todos.length > 0;
  const hasFiles = Object.keys(files).length > 0;

  // Parse out any action requests or review configs from the interrupt
  const actionRequestsMap: Map<string, ActionRequest> | null = useMemo(() => {
    const actionRequests =
      interrupt?.value && (interrupt.value as any)["action_requests"];
    if (!actionRequests) return new Map<string, ActionRequest>();
    return new Map(actionRequests.map((ar: ActionRequest) => [ar.name, ar]));
  }, [interrupt]);

  const reviewConfigsMap: Map<string, ReviewConfig> | null = useMemo(() => {
    const reviewConfigs =
      interrupt?.value && (interrupt.value as any)["review_configs"];
    if (!reviewConfigs) return new Map<string, ReviewConfig>();
    return new Map(
      reviewConfigs.map((rc: ReviewConfig) => [rc.actionName, rc])
    );
  }, [interrupt]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
        ref={scrollRef}
      >
        <div
          className="mx-auto w-full max-w-[1024px] px-6 pb-6 pt-4"
          ref={contentRef}
        >
          {isThreadLoading ? (
            <div className="flex items-center justify-center p-8">
              <p className="text-muted-foreground">加载中...</p>
            </div>
          ) : (
            <>
              {processedMessages.map((data, index) => {
                const messageUi = ui?.filter(
                  (u: any) => u.metadata?.message_id === data.message.id
                );
                const isLastMessage = index === processedMessages.length - 1;
                return (
                  <ChatMessage
                    key={data.message.id}
                    message={data.message}
                    toolCalls={data.toolCalls}
                    isLoading={isLoading}
                    actionRequestsMap={
                      isLastMessage ? actionRequestsMap : undefined
                    }
                    reviewConfigsMap={
                      isLastMessage ? reviewConfigsMap : undefined
                    }
                    ui={messageUi}
                    stream={stream}
                    onResumeInterrupt={resumeInterrupt}
                    graphId={assistant?.graph_id}
                  />
                );
              })}
            </>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 bg-gradient-to-t from-background via-background to-transparent pt-2">
        <div
          className={cn(
            "chat-input-box mx-4 mb-6 flex flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-[0_4px_20px_rgba(0,0,0,0.05)]",
            "mx-auto w-[calc(100%-32px)] max-w-[1024px]"
          )}
        >
          {(hasTasks || hasFiles) && (
            <div className="flex max-h-72 flex-col overflow-y-auto border-b border-border bg-sidebar empty:hidden">
              {!metaOpen && (
                <>
                  {(() => {
                    const activeTask = todos.find(
                      (t) => t.status === "in_progress"
                    );

                    const totalTasks = todos.length;
                    const remainingTasks =
                      totalTasks - groupedTodos.pending.length;
                    const isCompleted = totalTasks === remainingTasks;

                    const tasksTrigger = (() => {
                      if (!hasTasks) return null;
                      return (
                        <button
                          type="button"
                          onClick={() =>
                            setMetaOpen((prev) =>
                              prev === "tasks" ? null : "tasks"
                            )
                          }
                          className="grid w-full cursor-pointer grid-cols-[auto_auto_1fr] items-center gap-3 px-[18px] py-3 text-left"
                          aria-expanded={metaOpen === "tasks"}
                        >
                          {(() => {
                            if (isCompleted) {
                              return [
                                <CheckCircle
                                  key="icon"
                                  size={16}
                                  className="text-success/80"
                                />,
                                <span
                                  key="label"
                                  className="ml-[1px] min-w-0 truncate text-sm"
                                >
                                  所有任务已完成
                                </span>,
                              ];
                            }

                            if (activeTask != null) {
                              return [
                                <div key="icon">
                                  {getStatusIcon(activeTask.status)}
                                </div>,
                                <span
                                  key="label"
                                  className="ml-[1px] min-w-0 truncate text-sm"
                                >
                                  任务 {totalTasks - groupedTodos.pending.length} /{" "}
                                  {totalTasks}
                                </span>,
                                <span
                                  key="content"
                                  className="min-w-0 gap-2 truncate text-sm text-muted-foreground"
                                >
                                  {activeTask.content}
                                </span>,
                              ];
                            }

                            return [
                              <Circle
                                key="icon"
                                size={16}
                                className="text-tertiary/70"
                              />,
                              <span
                                key="label"
                                className="ml-[1px] min-w-0 truncate text-sm"
                              >
                                任务 {totalTasks - groupedTodos.pending.length}{" "}
                                / {totalTasks}
                              </span>,
                            ];
                          })()}
                        </button>
                      );
                    })();

                    const filesTrigger = (() => {
                      if (!hasFiles) return null;
                      return (
                        <button
                          type="button"
                          onClick={() =>
                            setMetaOpen((prev) =>
                              prev === "files" ? null : "files"
                            )
                          }
                          className="flex flex-shrink-0 cursor-pointer items-center gap-2 px-[18px] py-3 text-left text-sm"
                          aria-expanded={metaOpen === "files"}
                        >
                          <FileIcon size={16} />
                          文件（状态）
                          <span className="h-4 min-w-4 rounded-full bg-[#2F6868] px-0.5 text-center text-[10px] leading-[16px] text-white">
                            {Object.keys(files).length}
                          </span>
                        </button>
                      );
                    })();

                    return (
                      <div className="grid grid-cols-[1fr_auto_auto] items-center">
                        {tasksTrigger}
                        {filesTrigger}
                      </div>
                    );
                  })()}
                </>
              )}

              {metaOpen && (
                <>
                  <div className="sticky top-0 flex items-stretch bg-sidebar text-sm">
                    {hasTasks && (
                      <button
                        type="button"
                        className="py-3 pr-4 first:pl-[18px] aria-expanded:font-semibold"
                        onClick={() =>
                          setMetaOpen((prev) =>
                            prev === "tasks" ? null : "tasks"
                          )
                        }
                        aria-expanded={metaOpen === "tasks"}
                      >
                        任务
                      </button>
                    )}
                    {hasFiles && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 py-3 pr-4 first:pl-[18px] aria-expanded:font-semibold"
                        onClick={() =>
                          setMetaOpen((prev) =>
                            prev === "files" ? null : "files"
                          )
                        }
                        aria-expanded={metaOpen === "files"}
                      >
                        文件（状态）
                        <span className="h-4 min-w-4 rounded-full bg-[#2F6868] px-0.5 text-center text-[10px] leading-[16px] text-white">
                          {Object.keys(files).length}
                        </span>
                      </button>
                    )}
                    <button
                      aria-label="Close"
                      className="flex-1"
                      onClick={() => setMetaOpen(null)}
                    />
                  </div>
                  <div
                    ref={tasksContainerRef}
                    className="px-[18px]"
                  >
                    {metaOpen === "tasks" &&
                      Object.entries(groupedTodos)
                        .filter(([_, todos]) => todos.length > 0)
                        .map(([status, todos]) => (
                          <div
                            key={status}
                            className="mb-4"
                          >
                            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-tertiary">
                                {
                                  {
                                    pending: "待处理",
                                    in_progress: "进行中",
                                    completed: "已完成",
                                  }[status]
                                }
                            </h3>
                            <div className="grid grid-cols-[auto_1fr] gap-3 rounded-sm p-1 pl-0 text-sm">
                              {todos.map((todo, index) => (
                                <Fragment key={`${status}_${todo.id}_${index}`}>
                                  {getStatusIcon(todo.status, "mt-0.5")}
                                  <span className="break-words text-inherit">
                                    {todo.content}
                                  </span>
                                </Fragment>
                              ))}
                            </div>
                          </div>
                        ))}

                    {metaOpen === "files" && (
                      <div className="mb-6">
                        <FilesPopover
                          files={files}
                          setFiles={setFiles}
                          editDisabled={
                            isLoading === true || interrupt !== undefined
                          }
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          <PipelineStepper messages={messages} />
          {(() => {
            // 三块产出面板默认折叠,只显一行摘要,避免压住聊天窗口的滚动
            const docKeys = Object.keys(files).filter((k) =>
              k.startsWith("/uploads/")
            );
            const hasMindmap =
              Object.keys(files).some((k) =>
                /-mindmap\.(md|html)$/i.test(k)
              );
            const hasCases = Object.keys(files).some((k) =>
              /-testcases\.md$/i.test(k)
            );
            const segments: string[] = [];
            if (docKeys.length > 0) segments.push(`${docKeys.length} 文档`);
            if (hasCases) segments.push("用例 ✔");
            if (hasMindmap) segments.push("导图 ✔");
            if (parseReport?.denoise) {
              const total = parseReport.denoise.removals.length;
              segments.push(
                parseReport.denoise.aborted
                  ? "降噪保留原文"
                  : total === 0
                    ? "降噪无噪音"
                    : `降噪 ${total} 处`
              );
            }
            const summary =
              segments.length > 0 ? segments.join(" · ") : "暂无产出";
            const hasContent =
              docKeys.length > 0 || hasCases || hasMindmap || parseReport;
            if (!hasContent) return null;
            return (
              <BottomPanel
                summary={summary}
                storageKey={`bottom-panel-${assistant?.assistant_id ?? "default"}`}
              >
                <OutputsBar files={files} messages={messages} />
                {parseReport && <DenoiseReportCard report={parseReport} />}
              </BottomPanel>
            );
          })()}
          {parsePhase && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
              <Loader2 size={13} className="animate-spin" />
              {parseDetail ||
                (parsePhase === "parsing"
                  ? "文档解析中(docling + 千问 VL 图片描述,大文档需数分钟)…"
                  : "降噪清洗中(去页眉页脚/水印/页码)…")}
            </div>
          )}
          <form
            onSubmit={handleSubmit}
            className="flex flex-col"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isLoading ? "正在运行..." : "输入您的问题..."}
              className="font-inherit field-sizing-content flex-1 resize-none border-0 bg-transparent px-[18px] pb-[13px] pt-[14px] text-sm leading-7 text-primary outline-none placeholder:text-tertiary"
              rows={1}
            />
            <div className="flex justify-between gap-2 p-3">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isLoading || isParsing || !assistant}
                  onClick={() => fileInputRef.current?.click()}
                  title="上传需求文档 PDF"
                >
                  {isParsing ? (
                    <Loader2
                      size={18}
                      className="animate-spin"
                    />
                  ) : (
                    <Paperclip size={18} />
                  )}
                </Button>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type={isLoading ? "button" : "submit"}
                  variant={isLoading ? "destructive" : "default"}
                  onClick={isLoading ? stopStream : handleSubmit}
                  disabled={
                    !isLoading && (submitDisabled || isParsing || !input.trim())
                  }
                  className={
                    isLoading
                      ? "rounded-full"
                      : "rounded-full border-transparent text-white shadow-md transition-all hover:opacity-90 hover:shadow-lg"
                  }
                  style={
                    isLoading
                      ? undefined
                      : { background: "var(--brand-gradient-soft)" }
                  }
                >
                  {isLoading ? (
                    <>
                      <Square size={14} />
                      <span>停止</span>
                    </>
                  ) : (
                    <>
                      <ArrowUp size={18} />
                      <span>发送</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
});

ChatInterface.displayName = "ChatInterface";

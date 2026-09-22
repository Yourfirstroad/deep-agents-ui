export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: "pending" | "completed" | "error" | "interrupted";
}

export interface SubAgent {
  id: string;
  name: string;
  subAgentName: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: "pending" | "active" | "completed" | "error";
}

export interface FileItem {
  path: string;
  content: string;
}

// deepagents 0.7+ 的虚拟文件系统要求 files 状态值是 FileData 对象，
// 不能直接提交纯字符串（否则后端 read_file 会抛
// "string indices must be integers, not 'str'"）。
export interface FileData {
  content: string;
  encoding: string;
  created_at?: string;
  modified_at?: string;
}

export type FilesMap = Record<string, string | FileData>;

export function toFileData(content: string): FileData {
  const now = new Date().toISOString();
  return { content, encoding: "utf-8", created_at: now, modified_at: now };
}

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  updatedAt?: Date;
}

export interface Thread {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InterruptData {
  value: any;
  ns?: string[];
  scope?: string;
}

export interface ActionRequest {
  name: string;
  args: Record<string, unknown>;
  description?: string;
}

export interface ReviewConfig {
  actionName: string;
  allowedDecisions?: string[];
}

export interface ToolApprovalInterruptData {
  action_requests: ActionRequest[];
  review_configs?: ReviewConfig[];
}

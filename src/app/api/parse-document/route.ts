import { spawn } from "child_process";
import { writeFile } from "fs/promises";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 1200; // 图片描述走远程多模态模型,图片多的大 PDF 可能 10-20 分钟

const DOCLING_URL = process.env.DOCLING_SERVE_URL ?? "http://localhost:5001";
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// harness 项目位置(denoise CLI 所在);outputs 目录与 /api/download 共享
const HARNESS_DIR = path.resolve(process.cwd(), "../deep-agents-harness");
const HARNESS_OUTPUTS = path.join(HARNESS_DIR, "outputs");
const DENOISE_PYTHON = path.join(HARNESS_DIR, "venv/bin/python");
const DENOISE_CLI = path.join(HARNESS_DIR, "tools/denoise_cli.py");

// ---- 图片描述(路线 A:标准管线 + 多模态模型描述图片)----
// QWEN_* 优先(与 deep-agents-harness/.env 同一套约定),回退 DOCLING_VLM_*
const PICTURE_DESCRIPTION =
  (process.env.DOCLING_PICTURE_DESCRIPTION ?? "").toLowerCase() === "true";
const QWEN_KEY = process.env.QWEN_API_KEY ?? "";
const VLM_MODEL = QWEN_KEY
  ? (process.env.QWEN_VL_MODEL ?? "qwen3-vl-flash")
  : (process.env.DOCLING_VLM_MODEL ?? "");
const VLM_BASE_URL = (
  QWEN_KEY
    ? (process.env.QWEN_BASE_URL ??
      "https://dashscope.aliyuncs.com/compatible-mode/v1")
    : (process.env.DOCLING_VLM_BASE_URL ?? "")
).replace(/\/$/, "");
const VLM_API_KEY = QWEN_KEY || (process.env.DOCLING_VLM_API_KEY ?? "");
const VLM_PROMPT =
  "请用中文描述这张图片的内容,供需求分析使用。" +
  "若是流程图/时序图/状态图,逐步列出节点、分支条件与流转关系;" +
  "若是表格,用 Markdown 表格完整转录;" +
  "若是界面截图或原型图,列出页面上的关键字段、按钮、文案与交互说明;" +
  "若是纯装饰图片,只回答「装饰图」。直接输出描述,不要输出思考过程或前缀。";

const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 20 * 60 * 1000; // 整体最长等 20 分钟(图片多的大文档 VL 描述较慢)
// VL 图片描述并发数(路 A 的耗时大头;DashScope 限流对 flash 很宽松,8 并发通常快一倍)
const VLM_CONCURRENCY = Number(process.env.DOCLING_VLM_CONCURRENCY ?? 8);

interface DenoiseParams {
  enabled?: boolean;
  repeat_min_pages?: number;
  repeat_maxlen?: number;
  page_number?: boolean;
  empty_image?: boolean;
  max_delete_ratio?: number;
  picture_description?: boolean; // 按次开关图片描述(关掉后解析提速 3-5 倍)
}

interface DenoiseResult {
  cleaned_markdown: string;
  aborted: boolean;
  stats: Record<string, number>;
  removals: Array<{
    rule_id: string;
    rule_name: string;
    text: string;
    line_no: number | null;
    page_no: number | null;
  }>;
  audit_markdown?: string;
}

/** 文件名安全化(与前端 sanitizeFileName 同规则)。 */
function safeDocName(name: string): string {
  return name
    .replace(/\.pdf$/i, "")
    .replace(/[^\w一-龥-]+/g, "_")
    .slice(0, 60);
}

/**
 * 把降噪交付物落盘到 harness outputs/(与 /api/download 共享):
 * 原始版 md、机器审计 json、人读降噪报告 md。
 * 返回文件名映射,写盘失败不阻断主流程。
 */
async function saveDenoiseArtifacts(
  docName: string,
  rawMarkdown: string,
  result: DenoiseResult
): Promise<Record<string, string>> {
  const files: Record<string, [string, string]> = {
    raw_md: [`${docName}.raw.md`, rawMarkdown],
    audit_json: [
      `${docName}.denoise.json`,
      JSON.stringify(
        {
          aborted: result.aborted,
          stats: result.stats,
          removals: result.removals,
        },
        null,
        2
      ),
    ],
    report_md: [`${docName}-降噪报告.md`, result.audit_markdown ?? ""],
  };
  const saved: Record<string, string> = {};
  await Promise.all(
    Object.entries(files).map(async ([key, [fname, content]]) => {
      if (!content) return;
      try {
        await writeFile(path.join(HARNESS_OUTPUTS, fname), content, "utf-8");
        saved[key] = fname;
      } catch {
        /* 落盘失败不影响返回 */
      }
    })
  );
  return saved;
}

/**
 * 组装 docling-serve 的 multipart 表单。
 * to_formats 同时请求 md + json:json 的版面 label/页码用于降噪的 R1/R2 规则。
 */
function buildConvertForm(file: File, pictureDesc: boolean): FormData {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("to_formats", "md");
  form.append("to_formats", "json");
  form.append("include_images", "true");
  form.append("image_export_mode", "placeholder");

  if (pictureDesc && PICTURE_DESCRIPTION && VLM_MODEL && VLM_BASE_URL && VLM_API_KEY) {
    form.append("do_picture_description", "true");
    form.append("picture_description_area_threshold", "0.02");
    form.append(
      "picture_description_custom_config",
      JSON.stringify({
        model_spec: {
          name: VLM_MODEL,
          // schema 必填字段,API 引擎下不会被真正使用
          default_repo_id: VLM_MODEL,
          prompt: VLM_PROMPT,
          response_format: "plaintext",
          api_overrides: {
            api_openai: {
              // DashScope 兼容模式对 max_completion_tokens 支持不稳定,用 max_tokens
              params: { model: VLM_MODEL, max_tokens: 500 },
            },
          },
        },
        engine_options: {
          engine_type: "api_openai",
          url: `${VLM_BASE_URL}/chat/completions`,
          headers: { Authorization: `Bearer ${VLM_API_KEY}` },
          timeout: 120.0,
          concurrency: VLM_CONCURRENCY,
        },
        prompt: VLM_PROMPT,
        scale: 2.0,
        picture_area_threshold: 0.02,
      })
    );
  }
  return form;
}

/** 调 harness 的降噪 CLI(stdin JSON → stdout JSON);失败返回 null 并说明原因。 */
function runDenoise(
  markdown: string,
  jsonContent: unknown,
  params: DenoiseParams
): Promise<{ result?: DenoiseResult; error?: string }> {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(DENOISE_PYTHON, [DENOISE_CLI], { cwd: HARNESS_DIR });
    } catch (e) {
      resolve({ error: `无法启动降噪进程: ${String(e)}` });
      return;
    }
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (e) => resolve({ error: `降噪进程启动失败: ${e.message}` }));
    proc.on("close", (code) => {
      try {
        const data = JSON.parse(stdout);
        if (code !== 0 || data.error) {
          resolve({ error: data.error ?? `降噪进程退出码 ${code}: ${stderr.slice(0, 300)}` });
          return;
        }
        resolve({ result: data as DenoiseResult });
      } catch {
        resolve({ error: `降噪输出解析失败: ${stderr.slice(0, 300) || stdout.slice(0, 300)}` });
      }
    });
    proc.stdin.write(
      JSON.stringify({ markdown, json_content: jsonContent ?? null, params })
    );
    proc.stdin.end();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * SSE 流式接口:上传 PDF → 解析 → 降噪,阶段事件实时推送。
 * 事件序列:{phase:"parsing"} → {phase:"denoising"} → {phase:"done", ...结果}
 * 任一步失败发 {phase:"error", error}。早期参数错误仍返回普通 JSON 4xx。
 */
export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json(
      { error: "请求格式错误,需要 multipart/form-data" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "缺少 file 字段" }, { status: 400 });
  }
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    return Response.json({ error: "仅支持 PDF 文件" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ error: "文件超过 20MB 限制" }, { status: 413 });
  }

  // 前端设置对话框传入的降噪参数(JSON 字符串)
  let denoiseParams: DenoiseParams = {};
  const rawParams = formData.get("denoise_params");
  if (typeof rawParams === "string" && rawParams) {
    try {
      denoiseParams = JSON.parse(rawParams);
    } catch {
      /* 非法参数忽略,用默认 */
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const fail = (error: string) => {
        send({ phase: "error", error });
        controller.close();
      };

      try {
        // 1. 提交解析任务(图片描述较慢,走异步接口)
        const pictureDesc = denoiseParams.picture_description !== false;
        send({
          phase: "parsing",
          detail: pictureDesc
            ? "已提交解析任务(含千问 VL 图片理解,图片多时最慢)"
            : "已提交解析任务(已关闭图片理解,速度优先)",
        });
        let taskId: string;
        try {
          const resp = await fetch(`${DOCLING_URL}/v1/convert/file/async`, {
            method: "POST",
            body: buildConvertForm(file, pictureDesc),
            signal: AbortSignal.timeout(60_000),
          });
          if (!resp.ok) {
            const detail = (await resp.text()).slice(0, 300);
            fail(`docling 提交任务失败(HTTP ${resp.status}):${detail}`);
            return;
          }
          taskId = (await resp.json()).task_id;
        } catch {
          fail(`无法连接 docling-serve(${DOCLING_URL}),请确认 Docker 容器已启动`);
          return;
        }

        // 2. 轮询任务状态(每次轮询都回报已等待秒数,证明链路活着)
        const deadline = Date.now() + MAX_WAIT_MS;
        const startedAt = Date.now();
        let status = "";
        while (Date.now() < deadline) {
          await sleep(POLL_INTERVAL_MS);
          try {
            const poll = await fetch(`${DOCLING_URL}/v1/status/poll/${taskId}`, {
              signal: AbortSignal.timeout(15_000),
            });
            status = (await poll.json()).task_status ?? "";
          } catch {
            continue; // 单次轮询失败不致命,继续等
          }
          const elapsed = Math.round((Date.now() - startedAt) / 1000);
          send({
            phase: "parsing",
            detail: `解析中,已等待 ${elapsed} 秒(服务状态:${status || "排队"})`,
            elapsed,
          });
          if (status === "success" || status === "failure") break;
        }
        if (status !== "success") {
          fail(
            status === "failure"
              ? "docling 解析任务失败,请查看 docling-serve 容器日志"
              : "docling 解析超时,请换更小的 PDF 重试"
          );
          return;
        }

        // 3. 拉取结果(md + json)
        const result = await fetch(`${DOCLING_URL}/v1/result/${taskId}`, {
          signal: AbortSignal.timeout(60_000),
        });
        const data = await result.json();
        const rawMarkdown: string | undefined = data?.document?.md_content;
        if (!rawMarkdown) {
          fail("docling 返回内容为空");
          return;
        }
        const jsonContent = data?.document?.json_content ?? null;

        // 4. 降噪(params.enabled === false 时跳过)
        if (denoiseParams.enabled === false) {
          send({
            phase: "done",
            filename: file.name,
            markdown: rawMarkdown,
            raw_markdown: rawMarkdown,
            denoise: null,
          });
          controller.close();
          return;
        }
        send({ phase: "denoising", detail: "降噪清洗中(页眉页脚/水印/页码)" });
        const docName = safeDocName(file.name);
        const { result: denoise, error } = await runDenoise(
          rawMarkdown,
          jsonContent,
          { ...denoiseParams, doc_name: docName } as DenoiseParams
        );
        if (error || !denoise) {
          // 降噪失败不阻断交付:返回原文并说明
          send({
            phase: "done",
            filename: file.name,
            markdown: rawMarkdown,
            raw_markdown: rawMarkdown,
            denoise: null,
            denoise_error: error,
          });
          controller.close();
          return;
        }
        // 降噪交付物落盘:原始版/机器审计/人读报告(均可经 /api/download 下载)
        const artifacts = await saveDenoiseArtifacts(docName, rawMarkdown, denoise);
        send({
          phase: "done",
          filename: file.name,
          markdown: denoise.cleaned_markdown,
          raw_markdown: rawMarkdown,
          audit_markdown: denoise.audit_markdown ?? null,
          artifacts,
          denoise: {
            stats: denoise.stats,
            removals: denoise.removals,
            aborted: denoise.aborted,
          },
        });
        controller.close();
      } catch (e) {
        fail(`解析过程异常: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

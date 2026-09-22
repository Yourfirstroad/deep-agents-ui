import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 600; // 图片描述走远程多模态模型，大 PDF 可能需要数分钟

const DOCLING_URL = process.env.DOCLING_SERVE_URL ?? "http://localhost:5001";
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// ---- 图片描述（路线 A：标准管线 + 多模态模型描述图片）----
// 与后端 deep-agents-harness/.env 保持同一套变量名约定
const PICTURE_DESCRIPTION =
  (process.env.DOCLING_PICTURE_DESCRIPTION ?? "").toLowerCase() === "true";
const VLM_MODEL = process.env.DOCLING_VLM_MODEL ?? "";
const VLM_BASE_URL = (process.env.DOCLING_VLM_BASE_URL ?? "").replace(/\/$/, "");
const VLM_API_KEY = process.env.DOCLING_VLM_API_KEY ?? "";
const VLM_PROMPT =
  "请用中文简要描述这张图片的内容，直接输出描述，不要输出思考过程或前缀。";

const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 10 * 60 * 1000; // 整体最长等 10 分钟

/**
 * 组装 docling-serve 的 multipart 表单。
 * 注意字段编码约定（与 docling-serve file 端点的契约）：
 * - 文件字段名为 files；
 * - 标量字段直接写字符串（"true"/"0.05"）；
 * - 对象字段（picture_description_custom_config）用 JSON 字符串。
 * custom_config 结构按服务端 /openapi.json 的 PictureDescriptionVlmEngineOptions：
 * model_spec 必填 name/default_repo_id/prompt/response_format，
 * 模型名经 api_overrides.api_openai.params 传给 OpenAI 兼容端点。
 */
function buildConvertForm(file: File): FormData {
  const form = new FormData();
  form.append("files", file, file.name);
  form.append("to_formats", "md");
  form.append("include_images", "true");
  form.append("image_export_mode", "placeholder");

  if (PICTURE_DESCRIPTION && VLM_MODEL && VLM_BASE_URL && VLM_API_KEY) {
    form.append("do_picture_description", "true");
    form.append("picture_description_area_threshold", "0.05");
    form.append(
      "picture_description_custom_config",
      JSON.stringify({
        model_spec: {
          name: VLM_MODEL,
          // schema 必填字段，API 引擎下不会被真正使用
          default_repo_id: VLM_MODEL,
          prompt: VLM_PROMPT,
          response_format: "plaintext",
          api_overrides: {
            api_openai: {
              params: { model: VLM_MODEL, max_completion_tokens: 300 },
            },
          },
        },
        engine_options: {
          engine_type: "api_openai",
          url: `${VLM_BASE_URL}/chat/completions`,
          headers: { Authorization: `Bearer ${VLM_API_KEY}` },
          timeout: 120.0,
          concurrency: 4,
        },
        prompt: VLM_PROMPT,
        scale: 2.0,
        picture_area_threshold: 0.05,
      })
    );
  }
  return form;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "请求格式错误，需要 multipart/form-data" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });
  }
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    return NextResponse.json({ error: "仅支持 PDF 文件" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "文件超过 20MB 限制" }, { status: 413 });
  }

  // 1. 异步提交转换任务（图片描述较慢，同步接口会超时）
  let taskId: string;
  try {
    const resp = await fetch(`${DOCLING_URL}/v1/convert/file/async`, {
      method: "POST",
      body: buildConvertForm(file),
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) {
      const detail = (await resp.text()).slice(0, 300);
      return NextResponse.json(
        { error: `docling 提交任务失败（HTTP ${resp.status}）：${detail}` },
        { status: 502 }
      );
    }
    taskId = (await resp.json()).task_id;
  } catch {
    return NextResponse.json(
      {
        error: `无法连接 docling-serve（${DOCLING_URL}），请确认 Docker 容器已启动`,
      },
      { status: 502 }
    );
  }

  // 2. 轮询任务状态
  const deadline = Date.now() + MAX_WAIT_MS;
  let status = "";
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const poll = await fetch(`${DOCLING_URL}/v1/status/poll/${taskId}`, {
        signal: AbortSignal.timeout(15_000),
      });
      status = (await poll.json()).task_status ?? "";
    } catch {
      continue; // 单次轮询失败不致命，继续等
    }
    if (status === "success" || status === "failure") break;
  }
  if (status !== "success") {
    return NextResponse.json(
      {
        error:
          status === "failure"
            ? "docling 解析任务失败，请查看 docling-serve 容器日志"
            : "docling 解析超时，请换更小的 PDF 重试",
      },
      { status: 504 }
    );
  }

  // 3. 拉取结果
  // docling-serve ConvertDocumentResponse: { document: { md_content }, status, ... }
  try {
    const result = await fetch(`${DOCLING_URL}/v1/result/${taskId}`, {
      signal: AbortSignal.timeout(60_000),
    });
    const data = await result.json();
    const markdown: string | undefined = data?.document?.md_content;
    if (!markdown) {
      return NextResponse.json(
        { error: "docling 返回内容为空" },
        { status: 502 }
      );
    }
    return NextResponse.json({ filename: file.name, markdown });
  } catch {
    return NextResponse.json(
      { error: "拉取 docling 解析结果失败" },
      { status: 502 }
    );
  }
}

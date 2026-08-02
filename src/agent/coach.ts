import { complete, getModel, type KnownProvider, type Model } from "@mariozechner/pi-ai";

import type { SetScore } from "../pose/formRuleEngine";
import {
  DEFAULT_ZHIPU_API_KEY,
  DEFAULT_ZHIPU_BASE_URL,
  DEFAULT_ZHIPU_MODEL,
} from "./defaultCredentials";

export interface AgentSettings {
  provider: string;
  modelId: string;
  apiKey: string;
  /** Only used by the OpenAI-compatible custom provider (e.g. Zhipu GLM). */
  baseUrl?: string;
}

export interface CoachRequest {
  exercise: string;
  cameraView: string;
  reps: Array<{
    repIndex: number;
    durationMs: number;
    amplitude: number;
  }>;
}

export const ZHIPU_DEFAULTS = {
  provider: "zhipu",
  modelId: DEFAULT_ZHIPU_MODEL,
  baseUrl: DEFAULT_ZHIPU_BASE_URL,
  apiKey: DEFAULT_ZHIPU_API_KEY,
};

const SYSTEM_PROMPT = `你是一名力量训练教练。用户正在做背部训练,客户端姿态识别 SDK 会上报结构化的动作事件(JSON)。
请根据数据给出简短、具体、可执行的中文反馈:
1. 一句话总体评价这一组;
2. 指出数据中最值得关注的一个问题(如果数据正常就说明正常);
3. 给出下一句训练时的一句口头提示(cue),不超过 15 字。
不要编造数据中不存在的细节。`;

/**
 * LLM 调用的超时与重试。
 *
 * 实测带 3 张图的请求会一直挂着不 settle(既不返回也不报错),UI 就永远停在
 * "识别动作中"。pi-ai 的 complete() 不接受 AbortSignal,所以这里用 Promise.race
 * 做外层超时 —— 注意这只是**让调用方不再等**,底层请求仍在后台跑完,
 * 不是真正的取消。
 */
const LLM_TIMEOUT_MS = 45_000;
const LLM_RETRIES = 1;

class LlmTimeoutError extends Error {
  constructor(ms: number) {
    super(`LLM 请求超过 ${Math.round(ms / 1000)}s 未返回`);
    this.name = "LlmTimeoutError";
  }
}

async function withTimeoutAndRetry<T>(
  label: string,
  run: () => Promise<T>,
  timeoutMs = LLM_TIMEOUT_MS,
  retries = LLM_RETRIES,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new LlmTimeoutError(timeoutMs)), timeoutMs);
        }),
      ]);
    } catch (error) {
      lastError = error;
      console.warn(`[llm] ${label} 第 ${attempt + 1} 次失败:`, error);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastError instanceof Error
    ? new Error(`${label} 失败(已重试 ${retries} 次):${lastError.message}`)
    : new Error(`${label} 失败(已重试 ${retries} 次)`);
}

function resolveModel(settings: AgentSettings): Model<never> {
  if (settings.provider === "zhipu") {
    return {
      id: settings.modelId,
      name: `Zhipu ${settings.modelId}`,
      api: "openai-completions",
      provider: "zhipu",
      baseUrl: settings.baseUrl ?? DEFAULT_ZHIPU_BASE_URL,
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 8192,
    } as Model<never>;
  }
  return getModel(settings.provider as KnownProvider, settings.modelId as never) as Model<never>;
}

/** Send one set of rep events to the remote LLM via pi-ai (BYOK). */
export async function askCoach(
  settings: AgentSettings,
  request: CoachRequest,
): Promise<string> {
  const model = resolveModel(settings);
  const response = await withTimeoutAndRetry("askCoach", () =>
    complete(
      model,
      {
        systemPrompt: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `本次训练数据:\n${JSON.stringify(request, null, 2)}`,
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey: settings.apiKey },
    ),
  );
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("\n");
}

const CLASSIFY_PROMPT = `你是动作分类器。客户端姿态 SDK 从一段训练视频中提取了结构化特征(JSON),拍摄机位已知。
候选动作只有 5 个:
- barbell_row 杠铃俯身划船:站姿,躯干明显前倾(30-60°),手腕向腹部方向水平拉动
- pull_up 引体向上:悬垂,躯干接近直立,手腕从肩上方垂直向下拉到颈部,肘角变化大
- lat_pulldown 高位下拉:坐姿,躯干直立或略后仰,手腕从肩上方垂直下拉,肘角变化大
- seated_row 坐姿划船:坐姿,躯干直立,手腕水平向躯干拉动,肘角变化大
- straight_arm_pulldown 直臂下压:站姿,躯干略前倾,手臂接近伸直(肘角大且变化小),手腕走弧线

特征说明:posture=坐姿/站姿推断;torsoLean*=躯干倾角(伪3D);wristRangeX/Y=手腕轨迹幅度(归一化);dominantWristAxis=主导运动方向;wristAboveShoulderRatio=手腕高于肩的帧比例;elbowAngle*=肘角统计。

要求:
1. 给出最可能的动作和置信度(高/中/低)
2. 用 2-3 条特征作为判断依据
3. 如果特征互相矛盾或不足以区分(如引体 vs 高位下拉),明确说明
4. 回答用中文,简洁`;

export interface ClassifyRequest {
  cameraView: string;
  features: unknown;
}

/** Classify the exercise from structured pose features (agent path test). */
export async function classifyExercise(
  settings: AgentSettings,
  request: ClassifyRequest,
): Promise<string> {
  const model = resolveModel(settings);
  const response = await withTimeoutAndRetry("classifyExercise", () =>
    complete(
      model,
      {
        systemPrompt: CLASSIFY_PROMPT,
        messages: [
          {
            role: "user",
            content: `机位: ${request.cameraView}\n特征:\n${JSON.stringify(request.features, null, 2)}`,
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey: settings.apiKey },
    ),
  );
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("\n");
}

// ---------- 开放式动作识别(不给候选列表,模型自主判断) ----------

const OPEN_RECOGNIZE_PROMPT = `你是健身动作识别专家。输入是同一组训练的三张按动作分期抽取的截图,以及从骨架关键点算出的量化轨迹特征。

三张图的相位含义(按顺序):
1. 起始位 —— 动作循环的起点(通常是完全伸展/还原的位置)
2. 中间位 —— 起点到极点的中途
3. 顶点 —— 行程的另一端极值(通常是收缩最深/幅度最大处)

重要:**不给你候选列表,不要做选择题。** 你要自己判断这是什么训练动作,直接说出动作名称。
如果它是某个常见动作的变式(不同握法/站距/器械),说出具体的变式名。
如果你无法确定,就说无法确定,并说明还缺什么信息——**编一个像样的答案比承认不确定更糟**。

轨迹特征说明:
- jointRom: 各关节角度活动范围,按幅度降序。dominantJoint = 幅度最大的关节
- wristPath: 手腕路径。principalAxisDeg 0°=水平 90°=垂直;straightness 1=直线 0=往返闭合;
  primaryRange/secondaryRange = 主方向幅度 / 垂直于主方向的跑偏量(单位:躯干长)
- bodyTravelRatio: 肩位移 /(肩+腕位移)。**高=身体在动(如引体向上),低=手臂在动(如高位下拉)**
- shoulderPath / hipPath: 肩中点、髋中点自身的路径
- bilateralPathGap: 左右手腕路径的平均分离度(躯干长为单位)
- torsoAngle: 躯干与画面竖直方向夹角(度),meanDeg 均值 / driftDeg 全程漂移量
- period: 自相关得到的动作周期与强度
- consistency: 逐 rep 路径一致性。amplitudeCv 越小越稳;pathDeviation 是 rep 之间路径平均偏差

请严格输出 JSON,不要输出 JSON 以外的任何文字:
{
  "name": "中文动作名称(你自己判断的,不是从列表里选的)",
  "nameEn": "英文名称",
  "equipment": "器械判断,看不出就写 未知",
  "bodyPosition": "体位:站姿/坐姿/仰卧/俯卧/悬垂/跪姿等",
  "confidence": "high|medium|low",
  "uncertain": true 或 false,
  "reasoning": "判断过程,要同时引用图像观察和具体的轨迹数值",
  "evidence": ["支撑判断的关键证据,每条注明来自图像还是来自数据"],
  "alternatives": [{"name": "你考虑过但排除的动作", "whyNot": "排除理由"}],
  "cannotTell": ["仅凭骨架和这几张图无法确定的方面,例如负重、握距、具体器械型号"]
}

注意事项:
1. 骨架数据看不见器械和负重。杠铃/哑铃/绳索之类只能从图像里看,看不清就在 cannotTell 里说明,不要猜
2. evidence 里引用的数值必须来自输入,不许编造
3. 图像和数据矛盾时,说出矛盾在哪,不要强行圆一个答案`;

export interface OpenRecognition {
  name: string;
  nameEn: string;
  equipment: string;
  bodyPosition: string;
  confidence: "high" | "medium" | "low";
  uncertain: boolean;
  reasoning: string;
  evidence: string[];
  alternatives: Array<{ name: string; whyNot: string }>;
  cannotTell: string[];
}

export interface OpenRecognizeRequest {
  cameraView: string;
  /** 轨迹特征(trajectory.ts 的输出) */
  trajectory: unknown;
  /** 按相位抽取的三张图,顺序为 起始位 / 中间位 / 顶点 */
  phaseFrames: Array<{ phase: string; jpeg: string; timestampMs: number }>;
}

/**
 * 链路 B:把轨迹特征 + 三张相位截图交给模型,让它**自主判断**是什么动作。
 * 与 classifyExercise() 的区别是不提供候选列表,不做选择题。
 */
export async function recognizeExerciseOpen(
  settings: AgentSettings,
  request: OpenRecognizeRequest,
): Promise<OpenRecognition> {
  const model = resolveModel(settings);
  const header =
    `机位: ${request.cameraView}\n` +
    `三张截图的相位与时间戳: ${request.phaseFrames
      .map((f, i) => `${i + 1}=${f.phase}@${Math.round(f.timestampMs)}ms`)
      .join(", ")}\n` +
    `轨迹特征:\n${JSON.stringify(request.trajectory)}\n` +
    `截图按上述顺序附后。只输出 JSON。`;

  const content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  > = [{ type: "text", text: header }];
  for (const frame of request.phaseFrames) {
    content.push({ type: "text", text: `【${frame.phase}】` });
    content.push({ type: "image", data: frame.jpeg, mimeType: "image/jpeg" });
  }

  const response = await withTimeoutAndRetry("recognizeExerciseOpen", () =>
    complete(
      model,
      { systemPrompt: OPEN_RECOGNIZE_PROMPT, messages: [{ role: "user", content, timestamp: Date.now() }] },
      { apiKey: settings.apiKey },
    ),
  );
  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("\n");
  return parseOpenRecognition(raw);
}

function parseOpenRecognition(raw: string): OpenRecognition {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error(`开放式识别未返回 JSON: ${raw.slice(0, 120)}`);
  }
  const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<OpenRecognition>;
  if (!parsed.name) {
    throw new Error(`开放式识别缺少 name 字段: ${raw.slice(0, 120)}`);
  }
  return {
    name: parsed.name,
    nameEn: parsed.nameEn ?? "",
    equipment: parsed.equipment ?? "未知",
    bodyPosition: parsed.bodyPosition ?? "未知",
    confidence: parsed.confidence ?? "low",
    uncertain: parsed.uncertain ?? false,
    reasoning: parsed.reasoning ?? "",
    evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
    alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives : [],
    cannotTell: Array.isArray(parsed.cannotTell) ? parsed.cannotTell : [],
  };
}

const SCORE_PROMPT = `你是一名严格但建设性的力量训练教练,专长背部训练动作技术。
客户端姿态 SDK 上报了一段训练视频的结构化数据:整体特征(姿势/躯干角/手腕轨迹/肘角)和逐 rep 事件(时长/幅度)。
数据来自单目 2D 姿态估计,存在噪声;机位已知,请只基于该机位可见的信息判断,不要臆测看不到的部位。

任务:
1. 动作质量打分(1-10 分),并说明打分依据
2. 指出 1-2 个最主要的技术问题(引用具体数据,如幅度不一致、节奏过快、躯干角漂移)
3. 给出针对性的纠正建议和一句训练提示(cue)
4. 如果数据不足以判断(幅度太小、有效帧太少),明确说"数据不足"而不是硬打分
回答用中文,简洁务实。`;

export interface ScoreRequest {
  exercise: string;
  cameraView: string;
  features: unknown;
  reps: Array<{
    repIndex: number;
    durationMs: number;
    amplitude: number;
  }>;
}

/** Score form quality from trajectory + skeleton features. */
async function scoreForm(
  settings: AgentSettings,
  request: ScoreRequest,
): Promise<string> {
  const model = resolveModel(settings);
  const response = await withTimeoutAndRetry("scoreForm", () =>
    complete(
      model,
      {
        systemPrompt: SCORE_PROMPT,
        messages: [
          {
            role: "user",
            content: `动作: ${request.exercise}\n机位: ${request.cameraView}\n整体特征:\n${JSON.stringify(request.features, null, 2)}\n逐 rep 数据:\n${JSON.stringify(request.reps, null, 2)}`,
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey: settings.apiKey },
    ),
  );
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("\n");
}

const CRITIQUE_PROMPT = `你是一名严格但建设性的力量训练教练。客户端上报了:
1) 结构化指标(对称性/轨迹/肘角/逐 rep 数据)——来自单目 2D 姿态估计,有噪声
2) 几张训练关键帧截图

你的任务是做"双重证据"指正:
1. 先看数据:是否存在左高右低/双手发力不均/轨迹幅度不一致等问题(引用具体数值)
2. 再看截图:核对数据反映的问题在画面上是否真实存在——
   是"真动作问题"还是"骨架识别误差/遮挡导致的假信号",明确给出判断
3. 对确认为真的问题,给出具体纠正:哪边高了、哪边发力多了、轨迹该怎么走、一句口头提示(cue)
4. 对疑似识别误差的部分,说明可能原因(遮挡/机位/模型置信度)并建议重拍方式

注意:坐标里的 left/right 是画面左右;背面机位时与人的左右相反,请按机位换算后再说"左边/右边"。
只基于可见证据说话,数据不足就明说。回答用中文,务实简洁。`;

export interface CritiqueRequest {
  exercise: string;
  cameraView: string;
  symmetry: unknown;
  features: unknown;
  reps: Array<{
    repIndex: number;
    durationMs: number;
    amplitude: number;
  }>;
  /** JPEG base64 关键帧(不带 data: 前缀) */
  frames: string[];
}

/** 数据 + 关键帧截图的双重证据指正(需要视觉模型)。 */
async function critiqueForm(
  settings: AgentSettings,
  request: CritiqueRequest,
): Promise<string> {
  const model = resolveModel(settings);
  const text = `动作: ${request.exercise}\n机位: ${request.cameraView}\n对称性指标:\n${JSON.stringify(request.symmetry, null, 2)}\n整体特征:\n${JSON.stringify(request.features, null, 2)}\n逐 rep 数据:\n${JSON.stringify(request.reps, null, 2)}\n关键帧截图共 ${request.frames.length} 张,按时间顺序附后:`;
  const content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  > = [
    { type: "text", text },
    ...request.frames.map((data) => ({
      type: "image" as const,
      data,
      mimeType: "image/jpeg",
    })),
  ];
  const response = await withTimeoutAndRetry("critiqueForm", () =>
    complete(
      model,
      {
        systemPrompt: CRITIQUE_PROMPT,
        messages: [{ role: "user", content, timestamp: Date.now() }],
      },
      { apiKey: settings.apiKey },
    ),
  );
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("\n");
}

// ---------- 结构化分析:数据层(判断)与表达层(渲染)分离 ----------

export interface ReportFinding {
  /** 短标题,如"躯干前倾代偿" */
  title: string;
  severity: "high" | "medium" | "low";
  /** confirmed=截图核实的真问题; suspected=疑似; artifact=识别误差假信号; insufficient=数据不足 */
  status: "confirmed" | "suspected" | "artifact" | "insufficient";
  /** 引用的数据证据 */
  evidence: Array<{ metric: string; value: string; reference?: string }>;
  /** 相关关键帧序号(1-based),无则 null */
  frameRef: number | null;
  /** 具体纠正方法 */
  correction: string;
  /** 一句训练提示,≤15字 */
  cue: string;
}

export interface CoachReport {
  exercise: {
    id: string;
    confidence: "high" | "medium" | "low";
    reasoning: string;
  };
  /** 0-10 综合质量分 */
  score: number;
  findings: ReportFinding[];
  dataQuality: {
    /** 数据层问题,如"侧面机位导致对称性数据缺失" */
    issues: string[];
    cameraAdvice: string | null;
  };
  /** 一句话总结(客观陈述,不做修辞) */
  summary: string;
}

const STRUCTURED_PROMPT = `你是力量训练动作分析引擎。输入:结构化姿态指标 + 逐 rep 数据 + 关键帧截图。
任务:产出严格的 JSON 报告(不要输出任何 JSON 以外的文字),schema:
{
  "exercise": {"id": "barbell_row|pull_up|lat_pulldown|seated_row|straight_arm_pulldown", "confidence": "high|medium|low", "reasoning": "分类依据(引用特征)"},
  "score": 0-10 的数字,
  "findings": [{
    "title": "问题短标题",
    "severity": "high|medium|low",
    "status": "confirmed|suspected|artifact|insufficient",
    "evidence": [{"metric": "指标名", "value": "数值", "reference": "正常参考(可选)"}],
    "frameRef": 相关截图序号或 null,
    "correction": "具体纠正方法",
    "cue": "≤15字的训练提示"
  }],
  "dataQuality": {"issues": ["数据层问题"], "cameraAdvice": "机位建议或 null"},
  "summary": "一句话客观总结"
}
规则:
1. status 的判定:截图能核实的问题=confirmed;数据可疑但截图不支持=artifact;证据不足=insufficient。严禁把 artifact/insufficient 写成训练建议
2. 每条 finding 的 evidence 必须引用输入里的真实指标和数值,禁止编造
3. 机位限制:只判断当前机位可见的内容;left/right 按机位换算成人的左右
4. findings 按 severity 排序,最多 3 条;没有问题就给空数组
5. summary 只陈述事实,不做修辞`;

export interface StructuredAnalysisRequest {
  cameraView: string;
  features: unknown;
  symmetry: unknown;
  /** 轨迹特征(trajectory.ts):路径形状、主轴、逐 rep 一致性 */
  trajectory?: unknown;
  reps: unknown[];
  frames: string[];
}

/** 数据层:姿态数据 + 截图 → 结构化 JSON 报告(判断,确定性优先)。 */
async function analyzeStructured(
  settings: AgentSettings,
  request: StructuredAnalysisRequest,
): Promise<CoachReport> {
  const model = resolveModel(settings);
  const text =
    `机位: ${request.cameraView}\n整体特征:\n${JSON.stringify(request.features)}\n` +
    `对称性指标:\n${JSON.stringify(request.symmetry)}\n` +
    (request.trajectory ? `轨迹特征:\n${JSON.stringify(request.trajectory)}\n` : "") +
    `逐 rep 数据:\n${JSON.stringify(request.reps)}\n` +
    `关键帧 ${request.frames.length} 张附后。只输出 JSON。`;
  const content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  > = [
    { type: "text", text },
    ...request.frames.map((data) => ({
      type: "image" as const,
      data,
      mimeType: "image/jpeg",
    })),
  ];
  const response = await withTimeoutAndRetry("analyzeStructured", () =>
    complete(
      model,
      { systemPrompt: STRUCTURED_PROMPT, messages: [{ role: "user", content, timestamp: Date.now() }] },
      { apiKey: settings.apiKey },
    ),
  );
  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("\n");
  return parseReportJson(raw);
}

function parseReportJson(raw: string): CoachReport {
  // 容错:提取第一个 { 到最后一个 } 之间的内容
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error(`结构化分析未返回 JSON: ${raw.slice(0, 120)}`);
  }
  const parsed = JSON.parse(raw.slice(start, end + 1)) as CoachReport;
  if (!parsed.exercise?.id || !Array.isArray(parsed.findings)) {
    throw new Error(`结构化报告缺少必需字段: ${raw.slice(0, 120)}`);
  }
  return parsed;
}

const FUN_REPORT_PROMPT = `你是健身房里最懂训练也最有梗的内容编辑。输入是一份结构化的动作分析 JSON(由严谨的教练引擎产出)。
任务:把它改写成一份有趣的训练报告(Markdown),要求:
1. 数据、结论、纠正方法与 JSON 完全一致,一个数字都不能改——你的工作是表达,不是判断
2. status=confirmed 的问题重点写;artifact/insufficient 的用轻松方式说明"这是相机看不到,不怪你"
3. 用健身圈能共鸣的语言和比喻,可以幽默但不说教、不恐吓
4. 结构:开场一句话总评(含分数)→ 主要发现(每条带纠正和 cue)→ 数据质量说明 → 结尾一句鼓励
5. 控制在 300 字以内,中文`;

// ---------- 表达层:规则引擎的判定结果 → 大白话教练点评 ----------
//
// 判断已经在 formRuleEngine.scoreFormSet() 里做完了(哪个 rep、哪条规则、扣多少分)。
// 这里的 LLM 调用只做一件事:把已经确定的事实换一种说法,面向完全不懂运动生物力学的用户。
// 它不允许做任何新判断——这条边界不能只靠 prompt 约束嘴,parseFormScoreExplanation()
// 会按真实存在的 repIndex 过滤模型返回的内容,编出一个不存在的 rep 会被直接丢弃。

const FORM_EXPLANATION_PROMPT = `你是一名力量训练教练。下面会给你一份规则引擎已经算好的判定结果(JSON),
你的任务只有一件事:把它翻译成普通健身爱好者能听懂的大白话点评。**你不做任何新的判断**——
所有对错、扣分、数值都已经算好了,你只负责换一种说法。

严格规则(违反任意一条都是错误输出):
1. 不许添加数据里没有出现过的判断、原因或身体部位。看到 torsoDriftDeg 偏大就说"身体在晃/借力了",
   不要编造成"背部肌肉激活不足"这类数据完全没提到的解释。
2. 不许改变分数、扣分点数或规则判定结果——你只能重新措辞,不能重新评分。
3. 语言要面向完全不懂运动生物力学的人:不要出现"幅度"、"离心阶段"、"躯干漂移角"、
   "torsoDriftDeg"、百分比这类术语,换成"没拉到位"、"放得太快"、"身体在晃"这类效果描述。
4. 纠正建议要指向动作效果而不是身体部位/肌肉(外部注意焦点),例如
   说"把杠铃拉向肚脐"而不是"收紧背阔肌"。
5. 每条 rep 的点评不超过一句话,不说教、不恐吓。
6. 某个 rep 的 status 是 not_scored/partial,或某条判据是 refused 的,要如实说
   "这一下没看清楚/没法判断",绝不能猜一个结论出来凑数。
7. 全组都没有扣分(所有 rep 的 deductions 为空)时,给一句鼓励性总结,不要因为"没什么可说的"就随便找茬。

请严格输出 JSON,不要输出 JSON 以外的任何文字:
{
  "summary": "一句话总体点评,可以提到分数,但不能用技术术语",
  "perRep": [
    {"repIndex": 数字, "note": "这一下的大白话点评;如果这个 rep 没有任何 finding 就说类似'这一下没问题'"}
  ]
}
只为输入里 reps 数组中实际出现过的 repIndex 生成 perRep 条目,不要新增或跳过。`;

export interface FormScoreExplanationRequest {
  /** 人话动作名,由调用方从内部 id 翻译好(如 "杠铃俯身划船"),不要传内部 ExerciseId */
  exerciseLabel: string;
  cameraView: string;
  score: SetScore;
}

export interface FormScoreExplanation {
  summary: string;
  perRep: Array<{ repIndex: number; note: string }>;
}

/**
 * 表达层:规则引擎已经判定好的 SetScore → 大白话教练点评。
 * 与 renderFunReport() 是同一种分层(数据层判断、表达层只管说法),
 * 区别是这里的判断来自确定性的 formRuleEngine,而不是另一次 LLM 判断。
 */
export async function explainFormScore(
  settings: AgentSettings,
  request: FormScoreExplanationRequest,
): Promise<FormScoreExplanation> {
  const model = resolveModel(settings);
  const text =
    `动作: ${request.exerciseLabel}\n机位: ${request.cameraView}\n` +
    `规则引擎判定结果(已经是最终事实,不要重新判断,只翻译):\n${JSON.stringify(request.score, null, 2)}\n` +
    `只输出 JSON。`;
  const response = await withTimeoutAndRetry("explainFormScore", () =>
    complete(
      model,
      {
        systemPrompt: FORM_EXPLANATION_PROMPT,
        messages: [{ role: "user", content: text, timestamp: Date.now() }],
      },
      { apiKey: settings.apiKey },
    ),
  );
  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("\n");
  return parseFormScoreExplanation(raw, request.score);
}

function parseFormScoreExplanation(raw: string, score: SetScore): FormScoreExplanation {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error(`大白话点评未返回 JSON: ${raw.slice(0, 120)}`);
  }
  const parsed = JSON.parse(raw.slice(start, end + 1)) as {
    summary?: unknown;
    perRep?: unknown;
  };
  if (typeof parsed.summary !== "string" || !Array.isArray(parsed.perRep)) {
    throw new Error(`大白话点评缺少必需字段: ${raw.slice(0, 120)}`);
  }
  // 代码级兜底,不只靠 prompt 约束:模型编出一个规则引擎里不存在的 rep 就直接丢弃,
  // 而不是信它、显示给用户一个凭空多出来的判定。
  const validRepIndexes = new Set(score.reps.map((r) => r.repIndex));
  const perRep = parsed.perRep.filter(
    (item): item is { repIndex: number; note: string } =>
      !!item &&
      typeof (item as { repIndex?: unknown }).repIndex === "number" &&
      typeof (item as { note?: unknown }).note === "string" &&
      validRepIndexes.has((item as { repIndex: number }).repIndex),
  );
  return { summary: parsed.summary, perRep };
}

/** 表达层:结构化 JSON → 有趣报告(另一个 agent 调用,可独立换风格)。 */
async function renderFunReport(
  settings: AgentSettings,
  report: CoachReport,
): Promise<string> {
  const model = resolveModel(settings);
  const response = await withTimeoutAndRetry("renderFunReport", () =>
    complete(
      model,
      {
        systemPrompt: FUN_REPORT_PROMPT,
        messages: [
          { role: "user", content: `分析 JSON:\n${JSON.stringify(report, null, 2)}`, timestamp: Date.now() },
        ],
      },
      { apiKey: settings.apiKey },
    ),
  );
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => (block as { type: "text"; text: string }).text)
    .join("\n");
}

import { STEP_NAMES, STEP_DEPS, OPTIONAL_STEPS, INTAKE_STEP_NAMES, downstreamOf, type StepName } from "./steps";
import { getStep, getSteps, setStepStatus, updateTask, getTask } from "./repo";

// step 执行器签名：拿 taskId，干活，产出写库
export type StepExecutor = (taskId: string) => Promise<void>;

// 各步骤的执行器注册表（M2+ 逐步填充）
const executors: Partial<Record<StepName, StepExecutor>> = {};

export function registerStep(name: StepName, fn: StepExecutor) {
  executors[name] = fn;
}

export function isStepReady(taskId: string, name: StepName): boolean {
  return STEP_DEPS[name].every((dep) => getStep(taskId, dep)?.status === "done");
}

// 运行中的步骤锁（防止同一 task 的同一 step 被并发触发，导致中间文件互相踩踏）。
// 用 globalThis 持有，确保 dev 热重载重新求值本模块时锁状态不丢失（否则会误判正在跑的步骤为僵尸）。
const running: Set<string> = ((globalThis as any).__stepRunningLock ??= new Set<string>());
const PIPELINE_WAIT_INTERVAL_MS = 2_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStepToSettle(taskId: string, name: StepName) {
  while (getStep(taskId, name)?.status === "running") {
    await sleep(PIPELINE_WAIT_INTERVAL_MS);
  }
  const settled = getStep(taskId, name);
  if (settled?.status === "failed") {
    throw new Error(`step '${name}' 失败: ${settled.error || "unknown error"}`);
  }
  return settled;
}

// 复位"僵尸"步骤：DB 标记 running，但本进程内存锁里没有 → 是上次进程崩溃/重启的残留。
// 在读取状态时调用，避免 UI 永远转圈、且无法重跑。
export function reapZombieSteps(taskId: string): void {
  for (const s of getSteps(taskId)) {
    if (s.status === "running" && !running.has(`${taskId}:${s.name}`)) {
      setStepStatus(taskId, s.name as StepName, {
        status: "failed", error: "服务重启导致中断，请重跑该步骤", finishedAt: Date.now(),
      });
    }
  }
}

// 运行单个步骤
export async function runStep(taskId: string, name: StepName) {
  const exec = executors[name];
  if (!exec) throw new Error(`step '${name}' 未实现`);
  if (!isStepReady(taskId, name)) throw new Error(`step '${name}' 上游未完成`);

  const lockKey = `${taskId}:${name}`;
  if (running.has(lockKey)) throw new Error(`step '${name}' 正在运行中，忽略重复触发`);
  running.add(lockKey);

  setStepStatus(taskId, name, { status: "running", output: "", error: "", progress: 0, startedAt: Date.now() });
  updateTask(taskId, { status: "running" });
  try {
    await exec(taskId);
    setStepStatus(taskId, name, { status: "done", progress: 1, finishedAt: Date.now() });
  } catch (e: any) {
    setStepStatus(taskId, name, { status: "failed", error: String(e?.message || e), finishedAt: Date.now() });
    updateTask(taskId, { status: "failed" });
    throw e;
  } finally {
    running.delete(lockKey);
  }
  // 必需步骤全部 done 则任务完成（OPTIONAL_STEPS 保留给未来可选步骤）。
  const all = getSteps(taskId);
  if (all.filter((s) => !OPTIONAL_STEPS.includes(s.name as StepName)).every((s) => s.status === "done")) {
    updateTask(taskId, { status: "done" });
  }
}

// 重跑某步：先把下游全部置为 pending（级联失效），再跑本步
export async function rerunStep(taskId: string, name: StepName) {
  for (const ds of downstreamOf(name)) {
    setStepStatus(taskId, ds, { status: "pending", output: "", error: "", progress: 0 });
  }
  await runStep(taskId, name);
}

// 第一版只自动推进抖音采集、转写和分析，并在图书确认门前停止。
export async function runPipeline(taskId: string) {
  for (const name of INTAKE_STEP_NAMES) {
    const s = getStep(taskId, name);
    if (s?.status === "done") continue;
    if (s?.status === "running") {
      const settled = await waitForStepToSettle(taskId, name);
      if (settled?.status === "done") continue;
    }
    await runStep(taskId, name);
  }
}

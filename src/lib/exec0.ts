import { getLogger } from "@logtape/logtape";

const logger = getLogger(["spring", "exec0"]);
const BASE_URL = process.env.ENGINE_URL ?? "http://localhost:8080";

interface CreateSubmissionRequest {
  language_id: number;
  source_code: string;
  stdin?: string;
  expected_output?: string;
  cpu_time_limit?: number;
  wall_time_limit?: number;
  memory_limit?: number;
}

interface TestCaseInput {
  stdin: string;
  expected_output?: string;
}

interface CreateBatchSubmissionRequest {
  language_id: number;
  source_code: string;
  test_cases: TestCaseInput[];
  cpu_time_limit?: number;
  wall_time_limit?: number;
  memory_limit?: number;
}

export interface TestCaseResult {
  id: number;
  position: number;
  stdin: string;
  expected_output: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  exit_signal: number;
  status: string;
  time: number;
  wall_time: number;
  memory: number;
}

export interface SubmissionResponse {
  id: number;
  language_id: number;
  source_code: string;
  mode: "single" | "batch";
  status: string;
  compile_output: string;
  message: string;
  time: number;
  wall_time: number;
  memory: number;
  started_at: string;
  finished_at: string;
  created_at: string;
  updated_at: string;
  test_cases: TestCaseResult[];
  // single-mode convenience
  stdout?: string;
  stderr?: string;
  exit_code?: number;
}

const PENDING_STATUSES = new Set(["pending", "compiling", "running"]);

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`exec0 ${options?.method ?? "GET"} ${path}: ${res.status} ${body}`);
  }
  return res.json();
}

export async function createSubmission(
  body: CreateSubmissionRequest
): Promise<{ id: number }> {
  return request("/submissions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function createBatchSubmission(
  body: CreateBatchSubmissionRequest
): Promise<{ id: number }> {
  return request("/submissions/batch", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getSubmission(id: number): Promise<SubmissionResponse> {
  return request(`/submissions/${id}`);
}

export async function pollSubmission(
  id: number,
  maxAttempts = 20
): Promise<SubmissionResponse> {
  let delay = 500;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const sub = await getSubmission(id);
    if (!PENDING_STATUSES.has(sub.status)) {
      return sub;
    }
    logger.debug`polling exec0 submission ${id}: ${sub.status} (attempt ${attempt + 1})`;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 5000);
  }
  throw new Error(`exec0 submission ${id} did not complete after ${maxAttempts} attempts`);
}

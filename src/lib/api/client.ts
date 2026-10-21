"use client";

// 浏览器访问 Next 服务端 API 的统一入口。
// 业务规则、鉴权、数据库访问都在服务端，客户端不直接连接 Neon。

export class ApiClientError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.details = details;
  }
}

interface ApiErrorBody {
  error?: string;
  details?: unknown;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    credentials: "same-origin",
  });

  if (!response.ok) {
    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // 非 JSON 错误响应（如网关 502）
    }
    throw new ApiClientError(
      response.status,
      body.error ?? `请求失败（${response.status}）`,
      body.details,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

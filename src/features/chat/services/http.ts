import { withAuthHeaders } from "@features/auth/client/authClient";

const toQuery = (data: object) => {
  const params = new URLSearchParams();
  Object.entries(data as Record<string, unknown>).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    params.append(key, String(value));
  });
  return params.toString();
};

async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  data: object = {}
): Promise<T> {
  const isGet = method === "GET";
  const query = isGet ? toQuery(data) : "";
  const response = await fetch(`/api${url}${query ? `?${query}` : ""}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...withAuthHeaders(),
    },
    ...(isGet ? {} : { body: JSON.stringify(data) }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `${method} ${url} 失败`;
    throw new Error(message);
  }
  return payload as T;
}

export const httpGet = <T>(url: string, data: object = {}) =>
  request<T>("GET", url, data);
export const httpPost = <T>(url: string, data: object = {}) =>
  request<T>("POST", url, data);
export const httpPut = <T>(url: string, data: object = {}) =>
  request<T>("PUT", url, data);
export const httpDelete = <T>(url: string, data: object = {}) =>
  request<T>("DELETE", url, data);

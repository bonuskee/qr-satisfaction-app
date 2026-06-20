export async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || "เกิดข้อผิดพลาด");
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function getSession() {
  return requestJson("/api/auth/session");
}

export function login(password) {
  return requestJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password })
  });
}

export function logout() {
  return requestJson("/api/auth/logout", { method: "POST" });
}

export function getDashboard() {
  return requestJson("/api/dashboard");
}

export function getSurvey(id) {
  return requestJson(`/api/surveys/${encodeURIComponent(id)}`);
}

export function getSurveyResponses(id) {
  return requestJson(`/api/surveys/${encodeURIComponent(id)}/responses`);
}

export function createSurvey(data) {
  return requestJson("/api/surveys", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

export function updateSurvey(id, data) {
  return requestJson(`/api/surveys/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(data)
  });
}

export function toggleSurvey(id) {
  return requestJson(`/api/surveys/${encodeURIComponent(id)}`, {
    method: "PATCH"
  });
}

export function clearSurveyResponses(id) {
  return requestJson(`/api/surveys/${encodeURIComponent(id)}/responses`, {
    method: "DELETE"
  });
}

export function deleteSurvey(id) {
  return requestJson(`/api/surveys/${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
}

export function submitResponse(data) {
  return requestJson("/api/responses", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

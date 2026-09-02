export async function api(url, options = {}) {
  const response = await fetch(`/api${url}`, options);
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json') ? await response.json() : await response.text();
  if (!response.ok) { const error = new Error(data.error || 'Не удалось выполнить действие'); error.status = response.status; throw error; }
  return data;
}
export const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

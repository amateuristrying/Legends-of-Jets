export function reply(body, status = 200) {
  return Response.json(body, { status, headers:{ 'Cache-Control':'no-store' } });
}

export const bad = (error, status = 400) => reply({ error },status);

export async function readBody(request) {
  if (Number(request.headers.get('Content-Length')) > 8192 || !request.body) throw Error('Invalid body');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let length = 0, data = '';
  for (;;) {
    const { value,done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 8192) { await reader.cancel(); throw Error('Body too large'); }
    data += decoder.decode(value,{ stream:true });
  }
  data += decoder.decode();
  const body = JSON.parse(data);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
  return body;
}

export function internal(path, value) {
  return new Request('https://crew.internal' + path,{
    method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(value),
  });
}

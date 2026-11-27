export function onRequest({ request, env }) {
  if (env.CREW_BACKEND) return env.CREW_BACKEND.fetch(request);

  const status = new URL(request.url).pathname === '/api/crew/status';
  return Response.json(status ? { available: false } : { error: 'Crew is not configured on this site.' }, {
    status: status ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}

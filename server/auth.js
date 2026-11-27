import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { bad, readBody, reply } from './http.js';

export function authConfigured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY);
}

export function authClient(request, env) {
  const jar = new Map(parseCookieHeader(request.headers.get('Cookie') ?? '').map(({ name,value })=>[name,value]));
  const cookies = [];
  const client = createServerClient(env.SUPABASE_URL,env.SUPABASE_PUBLISHABLE_KEY,{
    cookieOptions:{ name:'legends-crew-auth', path:'/', sameSite:'lax', secure:new URL(request.url).protocol==='https:', httpOnly:true },
    cookies:{
      getAll:()=> [...jar].map(([name,value])=>({ name,value })),
      setAll(items) {
        for (const { name,value,options } of items) {
          jar.set(name,value);
          cookies.push(serializeCookieHeader(name,value,{ ...options,httpOnly:true }));
        }
      },
    },
  });
  return {
    client,
    apply(response) {
      if (!cookies.length) return response;
      const headers = new Headers(response.headers);
      for (const cookie of cookies) headers.append('Set-Cookie',cookie);
      headers.set('Cache-Control','no-store');
      return new Response(response.body,{ status:response.status,headers });
    },
  };
}

const authErrors = {
  invalid_credentials:'The email or password is incorrect.',
  email_not_confirmed:'Verify your email before signing in.',
  weak_password:'Choose a stronger password.',
  over_email_send_rate_limit:'Please wait before requesting another email.',
  user_already_exists:'That email may already have an account. Try signing in.',
};

export async function authRoute(request, env, path) {
  if (!authConfigured(env)) return bad('Crew sign-in is not configured on this server.',503);
  const origin = new URL(request.url).origin;
  const callback = origin + '/api/crew/auth/callback';
  const { client, apply } = authClient(request,env);
  const failure = error => bad(authErrors[error.code] ?? 'Sign-in could not be completed. Please try again.',error.status===429?429:400);
  if (request.method==='GET' && path === 'google') {
    const { data,error } = await client.auth.signInWithOAuth({
      provider:'google', options:{ redirectTo:callback,skipBrowserRedirect:true },
    });
    return apply(error ? failure(error) : Response.redirect(data.url,302));
  }
  if (request.method==='GET' && path === 'callback') {
    const code = new URL(request.url).searchParams.get('code');
    const result = code && await client.auth.exchangeCodeForSession(code);
    return apply(Response.redirect(origin + '/?crew=1' + (result && !result.error ? '' : '&auth=retry'),302));
  }
  if (request.method!=='POST') return bad('Method not allowed.',405);
  if (path === 'logout') {
    const { error } = await client.auth.signOut({ scope:'local' });
    return apply(error ? failure(error) : reply({ ok:true }));
  }
  if (!['login','signup'].includes(path)) return bad('Not found.',404);
  let body;
  try { body = await readBody(request); } catch { return bad('Invalid request.'); }
  const email = typeof body.email==='string' ? body.email.trim() : '';
  const password = typeof body.password==='string' ? body.password : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length > 128) {
    return bad('Enter a valid email and password.');
  }
  if (path === 'signup') {
    if (password.length < 8) return bad('Use at least eight characters for your password.');
    const name = typeof body.name==='string' ? body.name.trim().slice(0,28) : '';
    const { data,error } = await client.auth.signUp({ email,password,options:{ data:{ display_name:name },emailRedirectTo:callback } });
    return apply(error ? failure(error) : reply({ verify:!data.session }));
  }
  const { error } = await client.auth.signInWithPassword({ email,password });
  return apply(error ? failure(error) : reply({ ok:true }));
}

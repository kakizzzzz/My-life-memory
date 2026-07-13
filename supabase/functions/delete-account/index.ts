import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  clientIp,
  createCorsHeaders,
  forbiddenOriginResponse,
  hitRateLimit,
  isOriginAllowed,
  rateLimitResponse,
} from '../_shared/security.ts';

const MEDIA_BUCKET = 'life-media';
const STORAGE_PAGE_SIZE = 100;
const STORAGE_REMOVE_BATCH_SIZE = 100;

const jsonResponse = (
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...corsHeaders,
    'Content-Type': 'application/json',
  },
});

const bearerToken = (request: Request) => (
  request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || ''
);

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

const listStorageFiles = async (
  storage: ReturnType<typeof createClient>['storage'],
  prefix: string,
): Promise<string[]> => {
  const files: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await storage.from(MEDIA_BUCKET).list(prefix, {
      limit: STORAGE_PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;

    for (const entry of data || []) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id) {
        files.push(path);
      } else {
        files.push(...await listStorageFiles(storage, path));
      }
    }

    if (!data || data.length < STORAGE_PAGE_SIZE) break;
    offset += STORAGE_PAGE_SIZE;
  }

  return files;
};

const removeUserMedia = async (
  storage: ReturnType<typeof createClient>['storage'],
  userId: string,
) => {
  const files = await listStorageFiles(storage, userId);
  for (let index = 0; index < files.length; index += STORAGE_REMOVE_BATCH_SIZE) {
    const batch = files.slice(index, index + STORAGE_REMOVE_BATCH_SIZE);
    const { error } = await storage.from(MEDIA_BUCKET).remove(batch);
    if (error) throw error;
  }

  const remaining = await listStorageFiles(storage, userId);
  if (remaining.length > 0) {
    throw new Error('Storage cleanup did not remove every user object.');
  }

  return files.length;
};

serve(async request => {
  if (!isOriginAllowed(request)) return forbiddenOriginResponse();

  const corsHeaders = createCorsHeaders(request);
  const json = (body: unknown, status = 200) => jsonResponse(body, status, corsHeaders);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return json({ error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: { code: 'setup_required', message: 'Account deletion is not configured.' } }, 500);
  }

  const token = bearerToken(request);
  if (!token) {
    return json({ error: { code: 'unauthorized', message: 'Authentication is required.' } }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const user = authData.user;
  if (authError || !user?.id || !user.email) {
    return json({ error: { code: 'unauthorized', message: 'Authentication is invalid.' } }, 401);
  }

  const limit = await hitRateLimit(`delete-account:${clientIp(request)}:${user.id}`, 5, 10 * 60_000);
  if (limit.limited) return rateLimitResponse(corsHeaders, limit.retryAfterSeconds);

  let password = '';
  try {
    const body = await request.json() as { password?: unknown };
    password = typeof body.password === 'string' ? body.password : '';
  } catch {
    return json({ error: { code: 'bad_request', message: 'Invalid request body.' } }, 400);
  }
  if (!password) {
    return json({ error: { code: 'password_required', message: 'Current password is required.' } }, 400);
  }

  const passwordClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: verified, error: verifyError } = await passwordClient.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (verifyError || verified.user?.id !== user.id) {
    return json({ error: { code: 'invalid_password', message: 'Current password is incorrect.' } }, 401);
  }
  const verificationSignOut = await passwordClient.auth.signOut({ scope: 'local' });
  if (verificationSignOut.error) {
    console.warn(JSON.stringify({
      event: 'account_delete_verification_session_cleanup_failed',
      userId: user.id,
      message: verificationSignOut.error.message,
    }));
  }

  const sessionRevocation = await admin.auth.admin.signOut(token, 'global');
  if (sessionRevocation.error) {
    console.error(JSON.stringify({
      event: 'account_delete_session_revocation_failed',
      userId: user.id,
      message: sessionRevocation.error.message,
    }));
    return json({
      error: {
        code: 'session_revocation_failed',
        message: 'Account data was not deleted because active sessions could not be revoked.',
      },
    }, 502);
  }

  let removedMediaCount = 0;
  try {
    removedMediaCount = await removeUserMedia(admin.storage, user.id);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'account_delete_storage_failed',
      userId: user.id,
      message: error instanceof Error ? error.message : String(error),
    }));
    return json({
      error: {
        code: 'storage_cleanup_failed',
        message: 'Account data was not deleted because private media cleanup failed.',
      },
    }, 502);
  }

  let deleteError: { message?: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await admin.auth.admin.deleteUser(user.id, false);
    deleteError = result.error;
    if (!deleteError) break;
    if (attempt < 2) await wait(250 * (attempt + 1));
  }

  if (deleteError) {
    console.error(JSON.stringify({
      event: 'account_delete_auth_failed',
      userId: user.id,
      removedMediaCount,
      message: deleteError.message || 'Unknown Auth deletion error',
    }));
    return json({
      error: {
        code: 'auth_delete_failed',
        message: 'Private media was removed, but the account could not be finalized. Please retry.',
      },
    }, 500);
  }

  return json({
    ok: true,
    userId: user.id,
    removedMediaCount,
  });
});

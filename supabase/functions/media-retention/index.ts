import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  type MediaDeletionQueueItem,
  runMediaRetentionCycle,
} from '../_shared/media-retention-core.ts';

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  },
});

const bearerToken = (request: Request) => (
  request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || ''
);

const timingSafeEqual = (left: string, right: string) => {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
};

serve(async request => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const cronSecret = Deno.env.get('MEDIA_RETENTION_CRON_SECRET') || '';
  if (!supabaseUrl || !serviceRoleKey || cronSecret.length < 32) {
    return jsonResponse({
      error: { code: 'setup_required', message: 'Media retention is not configured.' },
    }, 500);
  }

  const suppliedSecret = bearerToken(request);
  if (!suppliedSecret || !timingSafeEqual(suppliedSecret, cronSecret)) {
    return jsonResponse({ error: { code: 'unauthorized', message: 'Authentication is invalid.' } }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const result = await runMediaRetentionCycle({
      purgeExpiredTrash: async () => {
        const { data, error } = await admin.rpc('run_server_memory_retention');
        if (error) throw error;
        return data;
      },
      claimDue: async limit => {
        const { data, error } = await admin.rpc('claim_due_memory_media_deletions', {
          p_limit: limit,
        });
        if (error) throw error;
        return (data || []) as MediaDeletionQueueItem[];
      },
      isProtected: async item => {
        const { data, error } = await admin.rpc('memory_media_path_is_protected', {
          p_user_id: item.user_id,
          p_path: item.path,
        });
        if (error) throw error;
        return data === true;
      },
      removeObject: async item => {
        const { error } = await admin.storage.from(item.bucket).remove([item.path]);
        if (error) throw error;
      },
      complete: async queueId => {
        const { error } = await admin.rpc('complete_memory_media_deletion', {
          p_queue_id: queueId,
        });
        if (error) throw error;
      },
      fail: async (queueId, message, retryAfterSeconds) => {
        const { error } = await admin.rpc('fail_memory_media_deletion', {
          p_queue_id: queueId,
          p_error: message,
          p_retry_after_seconds: retryAfterSeconds,
        });
        if (error) {
          console.error(JSON.stringify({
            event: 'media_retention_queue_failure_record_failed',
            queueId,
            message: error.message,
          }));
        }
      },
    });

    console.log(JSON.stringify({ event: 'media_retention_completed', ...result }));
    return jsonResponse(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: 'media_retention_failed', message }));
    return jsonResponse({
      error: { code: 'media_retention_failed', message: 'Media retention did not complete.' },
    }, 500);
  }
});

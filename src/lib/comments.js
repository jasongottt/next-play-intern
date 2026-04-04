import { supabase } from './supabase'

const COMMENT_FIELDS = 'id, task_id, body, user_id, created_at'

function getSupabaseClient() {
  if (!supabase) {
    throw new Error(
      'Missing Supabase environment variables. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.',
    )
  }

  return supabase
}

async function getAuthenticatedUser() {
  const client = getSupabaseClient()
  const {
    data: { user },
    error,
  } = await client.auth.getUser()

  if (error) {
    throw error
  }

  if (!user) {
    throw new Error('No guest session was found. Refresh the page and try again.')
  }

  return user
}

export async function fetchTaskComments(taskId) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('comments')
    .select(COMMENT_FIELDS)
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  return data ?? []
}

export async function createTaskComment(taskId, body) {
  const client = getSupabaseClient()
  const user = await getAuthenticatedUser()

  const payload = {
    task_id: taskId,
    body: body.trim(),
    user_id: user.id,
  }

  const { data, error } = await client
    .from('comments')
    .insert(payload)
    .select(COMMENT_FIELDS)
    .single()

  if (error) {
    throw error
  }

  return data
}

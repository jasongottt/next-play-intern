import { supabase } from './supabase'

const ACTIVITY_FIELDS = 'id, task_id, event_type, message, user_id, created_at'

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

export async function fetchTaskActivity(taskId) {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('task_activity')
    .select(ACTIVITY_FIELDS)
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  return data ?? []
}

export async function createTaskActivity(taskId, eventType, message) {
  const client = getSupabaseClient()
  const user = await getAuthenticatedUser()

  const payload = {
    task_id: taskId,
    event_type: eventType,
    message,
    user_id: user.id,
  }

  const { data, error } = await client
    .from('task_activity')
    .insert(payload)
    .select(ACTIVITY_FIELDS)
    .single()

  if (error) {
    throw error
  }

  return data
}

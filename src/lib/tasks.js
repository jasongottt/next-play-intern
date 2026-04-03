import { supabase } from './supabase'

const TASK_FIELDS =
  'id, title, description, status, priority, due_date, user_id, created_at'

const VALID_STATUSES = ['todo', 'in_progress', 'in_review', 'done']

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

export async function ensureGuestSession() {
  const client = getSupabaseClient()
  const {
    data: { session },
    error,
  } = await client.auth.getSession()

  if (error) {
    throw error
  }

  if (session) {
    return session
  }

  const { data, error: signInError } = await client.auth.signInAnonymously()

  if (signInError) {
    if (signInError.message.toLowerCase().includes('anonymous')) {
      throw new Error(
        'Anonymous auth appears to be disabled in Supabase. Enable Anonymous Sign-Ins and try again.',
      )
    }

    throw signInError
  }

  return data.session
}

export async function fetchTasks() {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('tasks')
    .select(TASK_FIELDS)
    .order('created_at', { ascending: false })

  if (error) {
    throw error
  }

  return data ?? []
}

export async function createTask(input) {
  const client = getSupabaseClient()
  const user = await getAuthenticatedUser()

  const payload = {
    title: input.title.trim(),
    description: input.description?.trim() || null,
    status: 'todo',
    priority: input.priority || 'normal',
    due_date: input.due_date || null,
    user_id: user.id,
  }

  const { data, error } = await client
    .from('tasks')
    .insert(payload)
    .select(TASK_FIELDS)
    .single()

  if (error) {
    throw error
  }

  return data
}

export async function updateTaskStatus(taskId, status) {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`Invalid task status: ${status}`)
  }

  const client = getSupabaseClient()
  const { data, error } = await client
    .from('tasks')
    .update({ status })
    .eq('id', taskId)
    .select('id')
    .single()

  if (error) {
    throw error
  }

  return data
}

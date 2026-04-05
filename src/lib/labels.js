import { supabase } from './supabase'

const LABEL_FIELDS = 'id, name, color, user_id, created_at'
const TASK_LABEL_FIELDS = 'task_id, label_id, user_id, created_at'

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

export async function fetchLabels() {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('labels')
    .select(LABEL_FIELDS)
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  return data ?? []
}

export async function createLabel(input) {
  const client = getSupabaseClient()
  const user = await getAuthenticatedUser()

  const payload = {
    name: input.name.trim(),
    color: input.color || null,
    user_id: user.id,
  }

  const { data, error } = await client
    .from('labels')
    .insert(payload)
    .select(LABEL_FIELDS)
    .single()

  if (error) {
    throw error
  }

  return data
}

export async function fetchTaskLabels() {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('task_labels')
    .select(TASK_LABEL_FIELDS)
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  return data ?? []
}

export async function replaceTaskLabels(taskId, labelIds) {
  const client = getSupabaseClient()
  const user = await getAuthenticatedUser()
  const nextLabelIds = [...new Set(labelIds)]

  const { data: existingTaskLabels, error: existingError } = await client
    .from('task_labels')
    .select('label_id')
    .eq('task_id', taskId)

  if (existingError) {
    throw existingError
  }

  const currentLabelIds = (existingTaskLabels ?? []).map((taskLabel) => taskLabel.label_id)
  const labelIdsToRemove = currentLabelIds.filter((labelId) => !nextLabelIds.includes(labelId))
  const labelIdsToAdd = nextLabelIds.filter((labelId) => !currentLabelIds.includes(labelId))

  if (labelIdsToRemove.length) {
    const { error } = await client
      .from('task_labels')
      .delete()
      .eq('task_id', taskId)
      .in('label_id', labelIdsToRemove)

    if (error) {
      throw error
    }
  }

  if (labelIdsToAdd.length) {
    const payload = labelIdsToAdd.map((labelId) => ({
      task_id: taskId,
      label_id: labelId,
      user_id: user.id,
    }))

    const { error } = await client.from('task_labels').insert(payload)

    if (error) {
      throw error
    }
  }

  return nextLabelIds
}

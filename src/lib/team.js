import { supabase } from './supabase'

const TEAM_MEMBER_FIELDS = 'id, name, color, user_id, created_at'
const TASK_ASSIGNEE_FIELDS = 'task_id, member_id, user_id, created_at'

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

export async function fetchTeamMembers() {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('team_members')
    .select(TEAM_MEMBER_FIELDS)
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  return data ?? []
}

export async function createTeamMember(input) {
  const client = getSupabaseClient()
  const user = await getAuthenticatedUser()

  const payload = {
    name: input.name.trim(),
    color: input.color || null,
    user_id: user.id,
  }

  const { data, error } = await client
    .from('team_members')
    .insert(payload)
    .select(TEAM_MEMBER_FIELDS)
    .single()

  if (error) {
    throw error
  }

  return data
}

export async function fetchTaskAssignees() {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('task_assignees')
    .select(TASK_ASSIGNEE_FIELDS)
    .order('created_at', { ascending: true })

  if (error) {
    throw error
  }

  return data ?? []
}

export async function replaceTaskAssignees(taskId, memberIds) {
  const client = getSupabaseClient()
  const user = await getAuthenticatedUser()
  const nextMemberIds = [...new Set(memberIds)]

  const { data: existingAssignees, error: existingError } = await client
    .from('task_assignees')
    .select('member_id')
    .eq('task_id', taskId)

  if (existingError) {
    throw existingError
  }

  const currentMemberIds = (existingAssignees ?? []).map((assignment) => assignment.member_id)
  const memberIdsToRemove = currentMemberIds.filter(
    (memberId) => !nextMemberIds.includes(memberId),
  )
  const memberIdsToAdd = nextMemberIds.filter(
    (memberId) => !currentMemberIds.includes(memberId),
  )

  if (memberIdsToRemove.length) {
    const { error } = await client
      .from('task_assignees')
      .delete()
      .eq('task_id', taskId)
      .in('member_id', memberIdsToRemove)

    if (error) {
      throw error
    }
  }

  if (memberIdsToAdd.length) {
    const payload = memberIdsToAdd.map((memberId) => ({
      task_id: taskId,
      member_id: memberId,
      user_id: user.id,
    }))

    const { error } = await client.from('task_assignees').insert(payload)

    if (error) {
      throw error
    }
  }

  return nextMemberIds
}

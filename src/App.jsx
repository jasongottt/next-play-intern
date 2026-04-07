import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useCallback, useEffect, useRef, useState } from 'react'
import { COLUMNS } from './constants/columns'
import {
  createTask,
  deleteTask,
  ensureGuestSession,
  fetchTasks,
  updateTask,
  updateTaskStatus,
} from './lib/tasks'
import {
  createTeamMember,
  fetchTaskAssignees,
  fetchTeamMembers,
  replaceTaskAssignees,
} from './lib/team'
import {
  createLabel,
  fetchLabels,
  fetchTaskLabels,
  replaceTaskLabels,
} from './lib/labels'
import { createTaskActivity, fetchTaskActivity } from './lib/activity'
import { createTaskComment, fetchTaskComments } from './lib/comments'
import './App.css'

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
]

const PRIORITY_FILTER_OPTIONS = [
  { value: 'all', label: 'All priorities' },
  ...PRIORITY_OPTIONS,
]

const COLUMN_FILTER_OPTIONS = [
  { value: 'all', label: 'All columns' },
  ...COLUMNS.map((column) => ({
    value: column.id,
    label: column.title,
  })),
]

const MEMBER_COLOR_OPTIONS = [
  { value: '', label: 'Auto' },
  { value: '#7cb1ff', label: 'Sky' },
  { value: '#60dc8f', label: 'Mint' },
  { value: '#df6747', label: 'Ember' },
  { value: '#be9124', label: 'Gold' },
  { value: '#8b7dff', label: 'Lilac' },
  { value: '#ff6fa8', label: 'Rose' },
]

const LABEL_COLOR_OPTIONS = [
  { value: '', label: 'Auto' },
  { value: '#7cb1ff', label: 'Sky' },
  { value: '#60dc8f', label: 'Mint' },
  { value: '#df6747', label: 'Ember' },
  { value: '#be9124', label: 'Gold' },
  { value: '#8b7dff', label: 'Lilac' },
  { value: '#ff6fa8', label: 'Rose' },
]

const EMPTY_FORM = {
  title: '',
  description: '',
  priority: 'normal',
  due_date: '',
}

const EMPTY_MEMBER_FORM = {
  name: '',
  color: '',
}

const EMPTY_LABEL_FORM = {
  name: '',
  color: '',
}

const EMPTY_COMMENT_FORM = {
  body: '',
}

const COLUMN_IDS = new Set(COLUMNS.map((column) => column.id))

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
})

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const relativeTimeFormatter = new Intl.RelativeTimeFormat('en', {
  numeric: 'auto',
})

function sortTasks(tasks) {
  return [...tasks].sort((left, right) => {
    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  })
}

function groupTasks(tasks) {
  return COLUMNS.reduce((groups, column) => {
    groups[column.id] = sortTasks(tasks.filter((task) => task.status === column.id))
    return groups
  }, {})
}

function filterTasks(tasks, filters) {
  const normalizedQuery = filters.searchQuery.trim().toLowerCase()

  return tasks.filter((task) => {
    const matchesTitle = normalizedQuery
      ? task.title.toLowerCase().includes(normalizedQuery)
      : true
    const matchesColumn =
      filters.columnId === 'all' ? true : task.status === filters.columnId
    const matchesPriority =
      filters.priority === 'all' ? true : task.priority === filters.priority
    const matchesLabel =
      filters.labelId === 'all'
        ? true
        : (filters.taskLabelMap[task.id] ?? []).includes(filters.labelId)

    return matchesTitle && matchesColumn && matchesPriority && matchesLabel
  })
}

function formatDueDate(dueDate) {
  if (!dueDate) {
    return null
  }

  return dateFormatter.format(new Date(`${dueDate}T00:00:00`))
}

function formatDateTime(value) {
  return dateTimeFormatter.format(new Date(value))
}

function formatRelativeTime(value) {
  const timestamp = new Date(value).getTime()
  const elapsedSeconds = Math.round((timestamp - Date.now()) / 1000)
  const ranges = [
    { unit: 'year', seconds: 31536000 },
    { unit: 'month', seconds: 2592000 },
    { unit: 'week', seconds: 604800 },
    { unit: 'day', seconds: 86400 },
    { unit: 'hour', seconds: 3600 },
    { unit: 'minute', seconds: 60 },
  ]

  for (const range of ranges) {
    if (Math.abs(elapsedSeconds) >= range.seconds) {
      return relativeTimeFormatter.format(
        Math.round(elapsedSeconds / range.seconds),
        range.unit,
      )
    }
  }

  return relativeTimeFormatter.format(elapsedSeconds, 'second')
}

function getPriorityLabel(priority) {
  return PRIORITY_OPTIONS.find((option) => option.value === priority)?.label ?? priority
}

function getDueDateTone(dueDate) {
  if (!dueDate) {
    return 'neutral'
  }

  const today = new Date()
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  )
  const due = new Date(`${dueDate}T00:00:00`)
  const diffInDays = Math.round((due.getTime() - startOfToday.getTime()) / 86400000)

  if (diffInDays < 0) {
    return 'overdue'
  }

  if (diffInDays <= 2) {
    return 'soon'
  }

  return 'neutral'
}

function getBoardStats(tasks) {
  const today = new Date()
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  )

  const completed = tasks.filter((task) => task.status === 'done').length
  const overdue = tasks.filter((task) => {
    if (!task.due_date || task.status === 'done') {
      return false
    }

    const dueDate = new Date(`${task.due_date}T00:00:00`)
    return dueDate.getTime() < startOfToday.getTime()
  }).length

  return {
    total: tasks.length,
    completed,
    overdue,
  }
}

function getTaskFormState(task) {
  return {
    title: task.title ?? '',
    description: task.description ?? '',
    priority: task.priority ?? 'normal',
    due_date: task.due_date ?? '',
  }
}

function getColumnTitle(status) {
  return COLUMNS.find((column) => column.id === status)?.title ?? 'Unknown'
}

function buildTaskAssignmentMap(assignments) {
  return assignments.reduce((map, assignment) => {
    if (!map[assignment.task_id]) {
      map[assignment.task_id] = []
    }

    map[assignment.task_id].push(assignment.member_id)
    return map
  }, {})
}

function getTaskAssigneeIds(taskId, taskAssignments) {
  return taskAssignments[taskId] ?? []
}

function buildTaskLabelMap(taskLabels) {
  return taskLabels.reduce((map, taskLabel) => {
    if (!map[taskLabel.task_id]) {
      map[taskLabel.task_id] = []
    }

    map[taskLabel.task_id].push(taskLabel.label_id)
    return map
  }, {})
}

function getTaskLabelIds(taskId, taskLabelMap) {
  return taskLabelMap[taskId] ?? []
}

function areIdListsEqual(left, right) {
  if (left.length !== right.length) {
    return false
  }

  const normalizedLeft = [...left].sort()
  const normalizedRight = [...right].sort()

  return normalizedLeft.every((value, index) => value === normalizedRight[index])
}

function joinLabelList(items) {
  if (!items.length) {
    return ''
  }

  if (items.length === 1) {
    return items[0]
  }

  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`
  }

  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`
}

function hashString(input) {
  return [...input].reduce((hash, char) => {
    return (hash << 5) - hash + char.charCodeAt(0)
  }, 0)
}

function getMemberColor(member) {
  if (member.color) {
    return member.color
  }

  const fallbackPalette = MEMBER_COLOR_OPTIONS.filter((option) => option.value)
  const paletteIndex =
    Math.abs(hashString(member.id || member.name || 'member')) % fallbackPalette.length

  return fallbackPalette[paletteIndex].value
}

function getLabelColor(label) {
  if (label.color) {
    return label.color
  }

  const fallbackPalette = LABEL_COLOR_OPTIONS.filter((option) => option.value)
  const paletteIndex =
    Math.abs(hashString(label.id || label.name || 'label')) % fallbackPalette.length

  return fallbackPalette[paletteIndex].value
}

function getMemberInitials(name) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)

  if (!parts.length) {
    return '?'
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('')
}

function buildTaskEditActivityMessage(previousTask, nextTask) {
  const changedFields = []

  if (previousTask.title !== nextTask.title) {
    changedFields.push('title')
  }

  if ((previousTask.description ?? '') !== (nextTask.description ?? '')) {
    changedFields.push('description')
  }

  if (previousTask.priority !== nextTask.priority) {
    changedFields.push('priority')
  }

  if ((previousTask.due_date ?? '') !== (nextTask.due_date ?? '')) {
    changedFields.push('due date')
  }

  if (!changedFields.length) {
    return null
  }

  return `Updated ${joinLabelList(changedFields)}`
}

function buildAssignmentActivityMessage(previousMemberIds, nextMemberIds, teamMembersById) {
  if (areIdListsEqual(previousMemberIds, nextMemberIds)) {
    return null
  }

  const addedNames = nextMemberIds
    .filter((memberId) => !previousMemberIds.includes(memberId))
    .map((memberId) => teamMembersById[memberId]?.name)
    .filter(Boolean)

  const removedNames = previousMemberIds
    .filter((memberId) => !nextMemberIds.includes(memberId))
    .map((memberId) => teamMembersById[memberId]?.name)
    .filter(Boolean)

  if (!nextMemberIds.length) {
    return 'Cleared all assignees'
  }

  if (!previousMemberIds.length && addedNames.length) {
    return `Assigned ${joinLabelList(addedNames)}`
  }

  const changes = []

  if (addedNames.length) {
    changes.push(`added ${joinLabelList(addedNames)}`)
  }

  if (removedNames.length) {
    changes.push(`removed ${joinLabelList(removedNames)}`)
  }

  return `Updated assignees: ${changes.join('; ')}`
}

function buildLabelActivityMessage(previousLabelIds, nextLabelIds, labelsById) {
  if (areIdListsEqual(previousLabelIds, nextLabelIds)) {
    return null
  }

  const addedNames = nextLabelIds
    .filter((labelId) => !previousLabelIds.includes(labelId))
    .map((labelId) => labelsById[labelId]?.name)
    .filter(Boolean)

  const removedNames = previousLabelIds
    .filter((labelId) => !nextLabelIds.includes(labelId))
    .map((labelId) => labelsById[labelId]?.name)
    .filter(Boolean)

  if (!nextLabelIds.length) {
    return 'Cleared all labels'
  }

  if (!previousLabelIds.length && addedNames.length) {
    return `Added labels: ${joinLabelList(addedNames)}`
  }

  const changes = []

  if (addedNames.length) {
    changes.push(`added ${joinLabelList(addedNames)}`)
  }

  if (removedNames.length) {
    changes.push(`removed ${joinLabelList(removedNames)}`)
  }

  return `Updated labels: ${changes.join('; ')}`
}

function App() {
  const boardStageRef = useRef(null)
  const [tasks, setTasks] = useState([])
  const [teamMembers, setTeamMembers] = useState([])
  const [labels, setLabels] = useState([])
  const [taskAssignments, setTaskAssignments] = useState({})
  const [taskLabelMap, setTaskLabelMap] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isTeamOpen, setIsTeamOpen] = useState(false)
  const [isLabelsOpen, setIsLabelsOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isCreatingMember, setIsCreatingMember] = useState(false)
  const [isCreatingLabel, setIsCreatingLabel] = useState(false)
  const [isActivityLoading, setIsActivityLoading] = useState(false)
  const [isCommentsLoading, setIsCommentsLoading] = useState(false)
  const [isCreatingComment, setIsCreatingComment] = useState(false)
  const [appError, setAppError] = useState('')
  const [boardError, setBoardError] = useState('')
  const [createError, setCreateError] = useState('')
  const [memberError, setMemberError] = useState('')
  const [labelError, setLabelError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [activityError, setActivityError] = useState('')
  const [commentsError, setCommentsError] = useState('')
  const [activeTaskId, setActiveTaskId] = useState(null)
  const [selectedTaskId, setSelectedTaskId] = useState(null)
  const [isDetailEditing, setIsDetailEditing] = useState(false)
  const [isSavingTask, setIsSavingTask] = useState(false)
  const [isDeletingTask, setIsDeletingTask] = useState(false)
  const [isUpdatingAssignees, setIsUpdatingAssignees] = useState(false)
  const [isSpotlightEnabled, setIsSpotlightEnabled] = useState(true)
  const [formState, setFormState] = useState(EMPTY_FORM)
  const [detailFormState, setDetailFormState] = useState(EMPTY_FORM)
  const [memberFormState, setMemberFormState] = useState(EMPTY_MEMBER_FORM)
  const [labelFormState, setLabelFormState] = useState(EMPTY_LABEL_FORM)
  const [commentFormState, setCommentFormState] = useState(EMPTY_COMMENT_FORM)
  const [taskActivity, setTaskActivity] = useState([])
  const [taskComments, setTaskComments] = useState([])
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState([])
  const [selectedLabelIds, setSelectedLabelIds] = useState([])
  const [filters, setFilters] = useState({
    searchQuery: '',
    columnId: 'all',
    priority: 'all',
    labelId: 'all',
  })

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  )

  const labelsById = Object.fromEntries(labels.map((label) => [label.id, label]))
  const filteredTasks = filterTasks(tasks, {
    ...filters,
    taskLabelMap,
  })
  const boardStats = getBoardStats(filteredTasks)
  const tasksByColumn = groupTasks(filteredTasks)
  const activeTask = tasks.find((task) => task.id === activeTaskId) ?? null
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null
  const teamMembersById = Object.fromEntries(teamMembers.map((member) => [member.id, member]))
  const selectedTaskAssigneeIds = selectedTask
    ? getTaskAssigneeIds(selectedTask.id, taskAssignments)
    : []
  const selectedTaskLabelIds = selectedTask
    ? getTaskLabelIds(selectedTask.id, taskLabelMap)
    : []
  const selectedTaskAssignees = selectedTaskAssigneeIds
    .map((memberId) => teamMembersById[memberId])
    .filter(Boolean)
  const selectedTaskLabels = selectedTaskLabelIds
    .map((labelId) => labelsById[labelId])
    .filter(Boolean)
  const hasActiveFilters =
    filters.searchQuery.trim().length > 0 ||
    filters.columnId !== 'all' ||
    filters.priority !== 'all' ||
    filters.labelId !== 'all'

  const handleCloseDetails = useCallback(() => {
    if (isSavingTask || isDeletingTask) {
      return
    }

    setDetailError('')
    setActivityError('')
    setCommentsError('')
    setSelectedTaskId(null)
    setDetailFormState(EMPTY_FORM)
    setSelectedAssigneeIds([])
    setSelectedLabelIds([])
    setCommentFormState(EMPTY_COMMENT_FORM)
    setTaskActivity([])
    setTaskComments([])
    setIsDetailEditing(false)
  }, [isDeletingTask, isSavingTask])

  useEffect(() => {
    initializeBoard()
  }, [])

  useEffect(() => {
    if (!selectedTaskId) {
      return
    }

    if (!selectedTask) {
      handleCloseDetails()
      return
    }

    if (!isDetailEditing && !isSavingTask) {
      setDetailFormState(getTaskFormState(selectedTask))
    }
  }, [handleCloseDetails, selectedTaskId, selectedTask, isDetailEditing, isSavingTask])

  useEffect(() => {
    if (!selectedTaskId) {
      setSelectedAssigneeIds([])
      return
    }

    setSelectedAssigneeIds(getTaskAssigneeIds(selectedTaskId, taskAssignments))
  }, [selectedTaskId, taskAssignments])

  useEffect(() => {
    if (!selectedTaskId) {
      setSelectedLabelIds([])
      return
    }

    setSelectedLabelIds(getTaskLabelIds(selectedTaskId, taskLabelMap))
  }, [selectedTaskId, taskLabelMap])

  useEffect(() => {
    if (!selectedTaskId) {
      setTaskActivity([])
      setActivityError('')
      setIsActivityLoading(false)
      return
    }

    let isCancelled = false

    async function loadTaskActivity() {
      setIsActivityLoading(true)
      setActivityError('')

      try {
        const nextActivity = await fetchTaskActivity(selectedTaskId)

        if (!isCancelled) {
          setTaskActivity(nextActivity)
        }
      } catch (error) {
        if (!isCancelled) {
          setActivityError(error.message || 'Unable to load activity right now.')
        }
      } finally {
        if (!isCancelled) {
          setIsActivityLoading(false)
        }
      }
    }

    loadTaskActivity()

    return () => {
      isCancelled = true
    }
  }, [selectedTaskId])

  useEffect(() => {
    if (!selectedTaskId) {
      setTaskComments([])
      setCommentsError('')
      setCommentFormState(EMPTY_COMMENT_FORM)
      setIsCommentsLoading(false)
      return
    }

    let isCancelled = false

    async function loadTaskComments() {
      setIsCommentsLoading(true)
      setCommentsError('')

      try {
        const nextComments = await fetchTaskComments(selectedTaskId)

        if (!isCancelled) {
          setTaskComments(nextComments)
        }
      } catch (error) {
        if (!isCancelled) {
          setCommentsError(error.message || 'Unable to load comments right now.')
        }
      } finally {
        if (!isCancelled) {
          setIsCommentsLoading(false)
        }
      }
    }

    loadTaskComments()

    return () => {
      isCancelled = true
    }
  }, [selectedTaskId])

  useEffect(() => {
    const stage = boardStageRef.current

    if (!stage || isSpotlightEnabled) {
      return
    }

    stage.style.setProperty('--spotlight-opacity', '0')
  }, [isSpotlightEnabled])

  async function initializeBoard() {
    setIsLoading(true)
    setAppError('')

    try {
      await ensureGuestSession()

      const [nextTasks, nextMembers, nextAssignments, nextLabels, nextTaskLabels] =
        await Promise.all([
        fetchTasks(),
        fetchTeamMembers(),
        fetchTaskAssignees(),
        fetchLabels(),
        fetchTaskLabels(),
      ])

      setTasks(nextTasks)
      setTeamMembers(nextMembers)
      setTaskAssignments(buildTaskAssignmentMap(nextAssignments))
      setLabels(nextLabels)
      setTaskLabelMap(buildTaskLabelMap(nextTaskLabels))
    } catch (error) {
      setAppError(error.message || 'Unable to load your task board.')
    } finally {
      setIsLoading(false)
    }
  }

  function handleOpenCreate() {
    setBoardError('')
    setCreateError('')
    setIsCreateOpen(true)
  }

  function handleOpenTeam() {
    setMemberError('')
    setIsTeamOpen(true)
  }

  function handleOpenLabels() {
    setLabelError('')
    setIsLabelsOpen(true)
  }

  function handleCloseCreate() {
    if (isCreating) {
      return
    }

    setCreateError('')
    setFormState(EMPTY_FORM)
    setIsCreateOpen(false)
  }

  function handleCloseTeam() {
    if (isCreatingMember) {
      return
    }

    setMemberError('')
    setMemberFormState(EMPTY_MEMBER_FORM)
    setIsTeamOpen(false)
  }

  function handleCloseLabels() {
    if (isCreatingLabel) {
      return
    }

    setLabelError('')
    setLabelFormState(EMPTY_LABEL_FORM)
    setIsLabelsOpen(false)
  }

  function handleFieldChange(event) {
    const { name, value } = event.target
    setFormState((current) => ({
      ...current,
      [name]: value,
    }))
  }

  function handleDetailFieldChange(event) {
    const { name, value } = event.target
    setDetailFormState((current) => ({
      ...current,
      [name]: value,
    }))
  }

  function handleMemberFieldChange(event) {
    const { name, value } = event.target
    setMemberFormState((current) => ({
      ...current,
      [name]: value,
    }))
  }

  function handleLabelFieldChange(event) {
    const { name, value } = event.target
    setLabelFormState((current) => ({
      ...current,
      [name]: value,
    }))
  }

  function handleCommentFieldChange(event) {
    const { name, value } = event.target
    setCommentFormState((current) => ({
      ...current,
      [name]: value,
    }))
  }

  function handleFilterChange(event) {
    const { name, value } = event.target

    setFilters((current) => ({
      ...current,
      [name]: value,
    }))
  }

  function handleResetFilters() {
    setFilters({
      searchQuery: '',
      columnId: 'all',
      priority: 'all',
      labelId: 'all',
    })
  }

  function handleToggleAssignee(memberId) {
    setSelectedAssigneeIds((current) =>
      current.includes(memberId)
        ? current.filter((value) => value !== memberId)
        : [...current, memberId],
    )
  }

  function handleToggleLabel(labelId) {
    setSelectedLabelIds((current) =>
      current.includes(labelId)
        ? current.filter((value) => value !== labelId)
        : [...current, labelId],
    )
  }

  async function handleQuickToggleAssignee(memberId) {
    if (!selectedTask || isUpdatingAssignees) {
      return
    }

    const previousAssigneeIds = getTaskAssigneeIds(selectedTask.id, taskAssignments)
    const nextAssigneeIds = previousAssigneeIds.includes(memberId)
      ? previousAssigneeIds.filter((value) => value !== memberId)
      : [...previousAssigneeIds, memberId]

    setIsUpdatingAssignees(true)
    setDetailError('')

    try {
      await replaceTaskAssignees(selectedTask.id, nextAssigneeIds)

      setTaskAssignments((current) => {
        const nextAssignments = { ...current }

        if (nextAssigneeIds.length) {
          nextAssignments[selectedTask.id] = nextAssigneeIds
        } else {
          delete nextAssignments[selectedTask.id]
        }

        return nextAssignments
      })

      const assignmentMessage = buildAssignmentActivityMessage(
        previousAssigneeIds,
        nextAssigneeIds,
        teamMembersById,
      )

      if (assignmentMessage) {
        await recordTaskActivity(
          selectedTask.id,
          'task_assignments_updated',
          assignmentMessage,
        )
      }
    } catch (error) {
      setDetailError(error.message || 'Unable to update assignees right now.')
    } finally {
      setIsUpdatingAssignees(false)
    }
  }

  function handleToggleSpotlight() {
    setIsSpotlightEnabled((current) => !current)
  }

  async function recordTaskActivity(taskId, eventType, message) {
    try {
      const nextActivityEntry = await createTaskActivity(taskId, eventType, message)

      if (selectedTaskId === taskId) {
        setTaskActivity((current) => [nextActivityEntry, ...current])
      }
    } catch {
      // Keep primary task actions working even if activity logging fails.
    }
  }

  async function handleCreateTask(event) {
    event.preventDefault()

    const title = formState.title.trim()

    if (!title) {
      setCreateError('A task title is required.')
      return
    }

    setIsCreating(true)
    setCreateError('')

    try {
      const nextTask = await createTask({
        title,
        description: formState.description,
        priority: formState.priority,
        due_date: formState.due_date,
      })

      setTasks((current) => [nextTask, ...current])
      setFormState(EMPTY_FORM)
      setIsCreateOpen(false)
      await recordTaskActivity(nextTask.id, 'task_created', 'Created task')
    } catch (error) {
      setCreateError(error.message || 'Unable to create the task right now.')
    } finally {
      setIsCreating(false)
    }
  }

  async function handleCreateMember(event) {
    event.preventDefault()

    const name = memberFormState.name.trim()

    if (!name) {
      setMemberError('A team member name is required.')
      return
    }

    setIsCreatingMember(true)
    setMemberError('')

    try {
      const nextMember = await createTeamMember({
        name,
        color: memberFormState.color,
      })

      setTeamMembers((current) => [...current, nextMember])
      setMemberFormState(EMPTY_MEMBER_FORM)
    } catch (error) {
      setMemberError(error.message || 'Unable to add that team member right now.')
    } finally {
      setIsCreatingMember(false)
    }
  }

  async function handleCreateLabel(event) {
    event.preventDefault()

    const name = labelFormState.name.trim()

    if (!name) {
      setLabelError('A label name is required.')
      return
    }

    setIsCreatingLabel(true)
    setLabelError('')

    try {
      const nextLabel = await createLabel({
        name,
        color: labelFormState.color,
      })

      setLabels((current) => [...current, nextLabel])
      setLabelFormState(EMPTY_LABEL_FORM)
    } catch (error) {
      setLabelError(error.message || 'Unable to add that label right now.')
    } finally {
      setIsCreatingLabel(false)
    }
  }

  async function handleCreateComment(event) {
    event.preventDefault()

    if (!selectedTask) {
      return
    }

    const body = commentFormState.body.trim()

    if (!body) {
      setCommentsError('A comment cannot be empty.')
      return
    }

    setIsCreatingComment(true)
    setCommentsError('')

    try {
      const nextComment = await createTaskComment(selectedTask.id, body)
      setTaskComments((current) => [...current, nextComment])
      setCommentFormState(EMPTY_COMMENT_FORM)
      await recordTaskActivity(selectedTask.id, 'comment_added', 'Added a comment')
    } catch (error) {
      setCommentsError(error.message || 'Unable to post that comment right now.')
    } finally {
      setIsCreatingComment(false)
    }
  }

  function handleOpenDetails(task) {
    setBoardError('')
    setDetailError('')
    setActivityError('')
    setCommentsError('')
    setSelectedTaskId(task.id)
    setDetailFormState(getTaskFormState(task))
    setSelectedAssigneeIds(getTaskAssigneeIds(task.id, taskAssignments))
    setSelectedLabelIds(getTaskLabelIds(task.id, taskLabelMap))
    setCommentFormState(EMPTY_COMMENT_FORM)
    setIsDetailEditing(false)
  }

  function handleStartEditing() {
    if (!selectedTask) {
      return
    }

    setDetailError('')
    setDetailFormState(getTaskFormState(selectedTask))
    setSelectedAssigneeIds(getTaskAssigneeIds(selectedTask.id, taskAssignments))
    setSelectedLabelIds(getTaskLabelIds(selectedTask.id, taskLabelMap))
    setIsDetailEditing(true)
  }

  function handleCancelEditing() {
    if (!selectedTask || isSavingTask) {
      return
    }

    setDetailError('')
    setDetailFormState(getTaskFormState(selectedTask))
    setSelectedAssigneeIds(getTaskAssigneeIds(selectedTask.id, taskAssignments))
    setSelectedLabelIds(getTaskLabelIds(selectedTask.id, taskLabelMap))
    setIsDetailEditing(false)
  }

  async function handleSaveTask(event) {
    event.preventDefault()

    if (!selectedTask) {
      return
    }

    const title = detailFormState.title.trim()

    if (!title) {
      setDetailError('A task title is required.')
      return
    }

    setIsSavingTask(true)
    setDetailError('')

    try {
      const previousTask = selectedTask
      const previousAssigneeIds = selectedTaskAssigneeIds
      const previousLabelIds = selectedTaskLabelIds
      const updatedTask = await updateTask(selectedTask.id, {
        title,
        description: detailFormState.description,
        priority: detailFormState.priority,
        due_date: detailFormState.due_date,
      })

      setTasks((current) =>
        current.map((task) => (task.id === updatedTask.id ? updatedTask : task)),
      )

      await replaceTaskAssignees(selectedTask.id, selectedAssigneeIds)
      await replaceTaskLabels(selectedTask.id, selectedLabelIds)

      setTaskAssignments((current) => {
        const nextAssignments = { ...current }

        if (selectedAssigneeIds.length) {
          nextAssignments[selectedTask.id] = selectedAssigneeIds
        } else {
          delete nextAssignments[selectedTask.id]
        }

        return nextAssignments
      })

      setTaskLabelMap((current) => {
        const nextTaskLabels = { ...current }

        if (selectedLabelIds.length) {
          nextTaskLabels[selectedTask.id] = selectedLabelIds
        } else {
          delete nextTaskLabels[selectedTask.id]
        }

        return nextTaskLabels
      })

      setDetailFormState(getTaskFormState(updatedTask))
      setIsDetailEditing(false)

      const editMessage = buildTaskEditActivityMessage(previousTask, updatedTask)
      const assignmentMessage = buildAssignmentActivityMessage(
        previousAssigneeIds,
        selectedAssigneeIds,
        teamMembersById,
      )
      const labelMessage = buildLabelActivityMessage(
        previousLabelIds,
        selectedLabelIds,
        labelsById,
      )

      if (editMessage) {
        await recordTaskActivity(selectedTask.id, 'task_updated', editMessage)
      }

      if (assignmentMessage) {
        await recordTaskActivity(
          selectedTask.id,
          'task_assignments_updated',
          assignmentMessage,
        )
      }

      if (labelMessage) {
        await recordTaskActivity(selectedTask.id, 'task_labels_updated', labelMessage)
      }
    } catch (error) {
      setDetailError(error.message || 'Unable to save this task right now.')
    } finally {
      setIsSavingTask(false)
    }
  }

  async function handleDeleteTask() {
    if (!selectedTask) {
      return
    }

    const confirmed = window.confirm(
      `Delete "${selectedTask.title}"? This action cannot be undone.`,
    )

    if (!confirmed) {
      return
    }

    setIsDeletingTask(true)
    setDetailError('')

    try {
      await deleteTask(selectedTask.id)
      setTasks((current) => current.filter((task) => task.id !== selectedTask.id))
      setTaskAssignments((current) => {
        const nextAssignments = { ...current }
        delete nextAssignments[selectedTask.id]
        return nextAssignments
      })
      setSelectedTaskId(null)
      setDetailFormState(EMPTY_FORM)
      setSelectedAssigneeIds([])
      setIsDetailEditing(false)
    } catch (error) {
      setDetailError(error.message || 'Unable to delete this task right now.')
    } finally {
      setIsDeletingTask(false)
    }
  }

  function handleDragStart(event) {
    setActiveTaskId(String(event.active.id))
    setBoardError('')
  }

  async function handleDragEnd(event) {
    const { active, over } = event
    setActiveTaskId(null)

    if (!over) {
      return
    }

    const taskId = String(active.id)
    const nextStatus = String(over.id)
    const currentTask = tasks.find((task) => task.id === taskId)

    if (!currentTask || !COLUMN_IDS.has(nextStatus) || currentTask.status === nextStatus) {
      return
    }

    const previousTasks = tasks

    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: nextStatus,
            }
          : task,
      ),
    )

    try {
      await updateTaskStatus(taskId, nextStatus)
      await recordTaskActivity(
        taskId,
        'task_status_changed',
        `Moved from ${getColumnTitle(currentTask.status)} to ${getColumnTitle(nextStatus)}`,
      )
    } catch (error) {
      setTasks(previousTasks)
      setBoardError(error.message || 'Unable to move that task right now.')
    }
  }

  function handleDragCancel() {
    setActiveTaskId(null)
  }

  function handleBoardStagePointerMove(event) {
    const stage = boardStageRef.current

    if (!stage || !isSpotlightEnabled) {
      return
    }

    const bounds = stage.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width) * 100
    const y = ((event.clientY - bounds.top) / bounds.height) * 100

    stage.style.setProperty('--spotlight-x', `${x}%`)
    stage.style.setProperty('--spotlight-y', `${y}%`)
    stage.style.setProperty('--spotlight-opacity', '1')
  }

  function handleBoardStagePointerLeave() {
    const stage = boardStageRef.current

    if (!stage || !isSpotlightEnabled) {
      return
    }

    stage.style.setProperty('--spotlight-opacity', '0')
  }

  if (isLoading) {
    return (
      <main className="app-shell">
        <section className="status-screen">
          <span className="status-screen__eyebrow">Preparing workspace</span>
          <h1>Loading your guest board</h1>
          <p>Creating a secure guest session and pulling in your tasks.</p>
        </section>
      </main>
    )
  }

  if (appError) {
    return (
      <main className="app-shell">
        <section className="status-screen status-screen--error">
          <span className="status-screen__eyebrow">Setup issue</span>
          <h1>We could not load the task board</h1>
          <p>{appError}</p>
          <button className="primary-button" type="button" onClick={initializeBoard}>
            Retry
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <section
        ref={boardStageRef}
        className={[
          'board-stage',
          isSpotlightEnabled ? '' : 'board-stage--spotlight-off',
        ]
          .filter(Boolean)
          .join(' ')}
        onPointerMove={handleBoardStagePointerMove}
        onPointerLeave={handleBoardStagePointerLeave}
      >
        <div className="board-stage__content">
          <section className="board-toolbar">
            <BoardHero
              stats={boardStats}
            />

            <div className="board-toolbar__actions">
              <button
                className={`icon-button ${isSpotlightEnabled ? 'icon-button--active' : ''}`}
                type="button"
                onClick={handleToggleSpotlight}
                aria-pressed={isSpotlightEnabled}
              >
                Spotlight {isSpotlightEnabled ? 'On' : 'Off'}
              </button>
              <button className="icon-button" type="button" onClick={handleOpenTeam}>
                Manage Team
              </button>
              <button className="icon-button" type="button" onClick={handleOpenLabels}>
                Custom Labels
              </button>
              <button className="primary-button" type="button" onClick={handleOpenCreate}>
                New Task
              </button>
            </div>
          </section>

          <section className="board-filters" aria-label="Task filters">
            <div className="board-filters__fields">
              <label className="board-filters__search">
                <span>Search by title</span>
                <input
                  name="searchQuery"
                  type="search"
                  value={filters.searchQuery}
                  onChange={handleFilterChange}
                  placeholder="Search tasks"
                />
              </label>

              <label className="board-filters__select">
                <span>Column</span>
                <select
                  name="columnId"
                  value={filters.columnId}
                  onChange={handleFilterChange}
                >
                  {COLUMN_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="board-filters__select">
                <span>Priority</span>
                <select
                  name="priority"
                  value={filters.priority}
                  onChange={handleFilterChange}
                >
                  {PRIORITY_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="board-filters__select">
                <span>Label</span>
                <select name="labelId" value={filters.labelId} onChange={handleFilterChange}>
                  <option value="all">All labels</option>
                  {labels.map((label) => (
                    <option key={label.id} value={label.id}>
                      {label.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="board-filters__meta">
              <p>
                Showing {filteredTasks.length} of {tasks.length} tasks
              </p>
              {hasActiveFilters ? (
                <button
                  className="icon-button board-filters__clear"
                  type="button"
                  onClick={handleResetFilters}
                >
                  Clear Filters
                </button>
              ) : null}
            </div>
          </section>

          {boardError ? (
            <div className="banner banner--error" role="alert">
              {boardError}
            </div>
          ) : null}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <section className="board">
              {COLUMNS.map((column) => (
                <BoardColumn
                  key={column.id}
                  column={column}
                  tasks={tasksByColumn[column.id]}
                  activeTaskId={activeTaskId}
                  hasActiveFilters={hasActiveFilters}
                  selectedTaskId={selectedTaskId}
                  taskAssignments={taskAssignments}
                  taskLabelMap={taskLabelMap}
                  labelsById={labelsById}
                  teamMembersById={teamMembersById}
                  onOpenTask={handleOpenDetails}
                />
              ))}
            </section>

            <DragOverlay>
              {activeTask ? (
                <TaskPreviewCard
                  labels={getTaskLabelIds(activeTask.id, taskLabelMap)
                    .map((labelId) => labelsById[labelId])
                    .filter(Boolean)}
                  task={activeTask}
                  assignees={getTaskAssigneeIds(activeTask.id, taskAssignments)
                    .map((memberId) => teamMembersById[memberId])
                    .filter(Boolean)}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </section>

      {selectedTask ? (
        <TaskDetailsModal
          activity={taskActivity}
          activityError={activityError}
          assignees={selectedTaskAssignees}
          labels={selectedTaskLabels}
          commentFormState={commentFormState}
          comments={taskComments}
          commentsError={commentsError}
          errorMessage={detailError}
          formState={detailFormState}
          isActivityLoading={isActivityLoading}
          isCommentsLoading={isCommentsLoading}
          isCreatingComment={isCreatingComment}
          isDeleting={isDeletingTask}
          isEditing={isDetailEditing}
          isSaving={isSavingTask}
          isUpdatingAssignees={isUpdatingAssignees}
          labelOptions={labels}
          memberOptions={teamMembers}
          selectedLabelIds={selectedLabelIds}
          selectedAssigneeIds={selectedAssigneeIds}
          task={selectedTask}
          onChange={handleDetailFieldChange}
          onClose={handleCloseDetails}
          onDelete={handleDeleteTask}
          onEdit={handleStartEditing}
          onCancelEdit={handleCancelEditing}
          onCommentChange={handleCommentFieldChange}
          onCreateComment={handleCreateComment}
          onLabelToggle={handleToggleLabel}
          onOpenLabels={handleOpenLabels}
          onQuickToggleAssignee={handleQuickToggleAssignee}
          onToggleAssignee={handleToggleAssignee}
          onOpenTeam={handleOpenTeam}
          onSubmit={handleSaveTask}
        />
      ) : null}

      {isCreateOpen ? (
        <CreateTaskModal
          errorMessage={createError}
          formState={formState}
          isCreating={isCreating}
          onChange={handleFieldChange}
          onClose={handleCloseCreate}
          onSubmit={handleCreateTask}
        />
      ) : null}

      {isTeamOpen ? (
        <TeamModal
          errorMessage={memberError}
          formState={memberFormState}
          isCreating={isCreatingMember}
          members={teamMembers}
          onChange={handleMemberFieldChange}
          onClose={handleCloseTeam}
          onSubmit={handleCreateMember}
        />
      ) : null}

      {isLabelsOpen ? (
        <LabelsModal
          errorMessage={labelError}
          formState={labelFormState}
          isCreating={isCreatingLabel}
          labels={labels}
          onChange={handleLabelFieldChange}
          onClose={handleCloseLabels}
          onSubmit={handleCreateLabel}
        />
      ) : null}
    </main>
  )
}

function BoardColumn({
  column,
  tasks,
  activeTaskId,
  hasActiveFilters,
  selectedTaskId,
  taskAssignments,
  taskLabelMap,
  labelsById,
  teamMembersById,
  onOpenTask,
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: column.id,
  })

  return (
    <section
      ref={setNodeRef}
      className={`board-column ${isOver ? 'board-column--active' : ''}`}
    >
      <header className="board-column__header">
        <div>
          <span className="board-column__eyebrow">Stage</span>
          <h2>{column.title}</h2>
        </div>
        <span className="board-column__count">{tasks.length}</span>
      </header>

      <div className="board-column__body">
        {tasks.length ? (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              assignees={getTaskAssigneeIds(task.id, taskAssignments)
                .map((memberId) => teamMembersById[memberId])
                .filter(Boolean)}
              labels={getTaskLabelIds(task.id, taskLabelMap)
                .map((labelId) => labelsById[labelId])
                .filter(Boolean)}
              task={task}
              isGhosted={activeTaskId === task.id}
              isSelected={selectedTaskId === task.id}
              onOpen={onOpenTask}
            />
          ))
        ) : (
          <div className="empty-column">
            <p>{hasActiveFilters ? 'No matching tasks.' : 'No tasks here yet.'}</p>
            <span>
              {hasActiveFilters
                ? 'Try a different search, column, priority, or label filter.'
                : 'Drop a task here or create a new one.'}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}

function BoardHero({ stats }) {
  return (
    <header className="app-header">
      <div className="app-header__main">
        <div className="app-header__title-group">
          <h1>Spotlight.</h1>
        </div>
      </div>

      <div className="app-header__support">
        <div className="hero-panel__meta" aria-label="Board overview">
          <span className="meta-chip">
            <span className="meta-chip__label">Total tasks</span>
            <strong>{stats.total}</strong>
          </span>
          <span className="meta-chip">
            <span className="meta-chip__label">Completed</span>
            <strong>{stats.completed}</strong>
          </span>
          <span className="meta-chip meta-chip--warning">
            <span className="meta-chip__label">Overdue</span>
            <strong>{stats.overdue}</strong>
          </span>
        </div>
      </div>
    </header>
  )
}

function TaskCard({
  assignees,
  labels,
  task,
  isGhosted = false,
  isSelected = false,
  onOpen,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: task.id,
  })

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined

  const dueTone = getDueDateTone(task.due_date)
  const dueLabel = formatDueDate(task.due_date)

  return (
    <article
      ref={setNodeRef}
      style={style}
      className={[
        'task-card',
        `task-card--priority-${task.priority}`,
        isDragging ? 'task-card--dragging' : '',
        isGhosted ? 'task-card--ghosted' : '',
        isSelected ? 'task-card--selected' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => onOpen(task)}
      {...attributes}
      {...listeners}
    >
      <TaskCardContent
        assignees={assignees}
        labels={labels}
        task={task}
        dueLabel={dueLabel}
        dueTone={dueTone}
      />
    </article>
  )
}

function TaskPreviewCard({ assignees, labels, task }) {
  const dueTone = getDueDateTone(task.due_date)
  const dueLabel = formatDueDate(task.due_date)

  return (
    <article className="task-card task-card--overlay">
      <TaskCardContent
        assignees={assignees}
        labels={labels}
        task={task}
        dueLabel={dueLabel}
        dueTone={dueTone}
      />
    </article>
  )
}

function TaskCardContent({ assignees, labels, task, dueLabel, dueTone }) {
  return (
    <>
      <div className="task-card__signals">
        <span className={`task-card__signal task-card__signal--priority-${task.priority}`}>
          {getPriorityLabel(task.priority)} priority
        </span>
        {dueLabel ? (
          <span
            className={[
              'task-card__signal',
              `task-card__signal--due-${dueTone}`,
              dueTone === 'soon' || dueTone === 'overdue'
                ? 'task-card__signal--due-emphasis'
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            Due {dueLabel}
          </span>
        ) : null}
      </div>

      <h3>{task.title}</h3>

      {task.description ? <p>{task.description}</p> : null}

      {labels.length ? <TaskLabelList labels={labels} /> : null}

      {assignees.length ? <TaskAssigneeSummary assignees={assignees} /> : null}
    </>
  )
}

function TaskLabelList({ labels }) {
  return (
    <div className="task-card__labels">
      {labels.map((label) => (
        <LabelChip key={label.id} label={label} />
      ))}
    </div>
  )
}

function TaskAssigneeSummary({ assignees }) {
  const visibleAssignees = assignees.slice(0, 3)
  const overflowCount = assignees.length - visibleAssignees.length

  return (
    <div className="task-card__footer">
      <div className="task-card__assignees">
        {visibleAssignees.map((member) => (
          <AssigneeAvatar key={member.id} member={member} size="small" />
        ))}
        {overflowCount > 0 ? (
          <span className="task-card__assignee-overflow">+{overflowCount}</span>
        ) : null}
      </div>
      {/* <span className="task-card__assignee-count">
        {assignees.length} assignee{assignees.length === 1 ? '' : 's'}
      </span> */}
    </div>
  )
}

function CreateTaskModal({
  errorMessage,
  formState,
  isCreating,
  onChange,
  onClose,
  onSubmit,
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-task-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            <span className="modal__eyebrow">Quick add</span>
            <h2 id="create-task-title">Create a new task</h2>
          </div>

          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={isCreating}
          >
            Close
          </button>
        </div>

        <form className="task-form" onSubmit={onSubmit}>
          {errorMessage ? (
            <div className="banner banner--error" role="alert">
              {errorMessage}
            </div>
          ) : null}

          <TaskFormFields formState={formState} onChange={onChange} />

          <div className="task-form__footer">
            <button className="primary-button" type="submit" disabled={isCreating}>
              {isCreating ? 'Creating...' : 'Create Task'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function TeamModal({
  errorMessage,
  formState,
  isCreating,
  members,
  onChange,
  onClose,
  onSubmit,
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal team-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            <span className="modal__eyebrow">Team roster</span>
            <h2 id="team-modal-title">Manage team members</h2>
          </div>

          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={isCreating}
          >
            Close
          </button>
        </div>

        {errorMessage ? (
          <div className="banner banner--error" role="alert">
            {errorMessage}
          </div>
        ) : null}

        <div className="team-modal__body">
          <section className="detail-panel">
            <span className="detail-panel__label">Current team</span>
            {members.length ? (
              <div className="team-modal__list">
                {members.map((member) => (
                  <div key={member.id} className="team-member">
                    <AssigneeAvatar member={member} />
                    <div>
                      <p>{member.name}</p>
                      <span>Added {formatDateTime(member.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="detail-panel__empty">No team members yet.</p>
            )}
          </section>

          <form className="task-form" onSubmit={onSubmit}>
            <div className="task-form__grid">
              <label>
                Name
                <input
                  name="name"
                  type="text"
                  value={formState.name}
                  onChange={onChange}
                  placeholder="Jordan Lee"
                  maxLength={80}
                  required
                />
              </label>

              <label>
                Avatar color
                <select name="color" value={formState.color} onChange={onChange}>
                  {MEMBER_COLOR_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="task-form__footer">
              {/* <p>Initials are generated automatically from the member name.</p> */}
              <button className="primary-button" type="submit" disabled={isCreating}>
                {isCreating ? 'Adding...' : 'Add Member'}
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  )
}

function LabelsModal({
  errorMessage,
  formState,
  isCreating,
  labels,
  onChange,
  onClose,
  onSubmit,
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal team-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="labels-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            <span className="modal__eyebrow">Custom tags</span>
            <h2 id="labels-modal-title">Custom labels</h2>
          </div>

          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={isCreating}
          >
            Close
          </button>
        </div>

        {errorMessage ? (
          <div className="banner banner--error" role="alert">
            {errorMessage}
          </div>
        ) : null}

        <div className="team-modal__body">
          <section className="detail-panel">
            <span className="detail-panel__label">Current labels</span>
            {labels.length ? (
              <div className="labels-list">
                {labels.map((label) => (
                  <div key={label.id} className="label-list-item">
                    <LabelChip label={label} />
                    <span>Added {formatDateTime(label.created_at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="detail-panel__empty">No labels yet.</p>
            )}
          </section>

          <form className="task-form" onSubmit={onSubmit}>
            <div className="task-form__grid">
              <label>
                Name
                <input
                  name="name"
                  type="text"
                  value={formState.name}
                  onChange={onChange}
                  placeholder="Design"
                  maxLength={60}
                  required
                />
              </label>

              <label>
                Label color
                <select name="color" value={formState.color} onChange={onChange}>
                  {LABEL_COLOR_OPTIONS.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="task-form__footer">
              <button className="primary-button" type="submit" disabled={isCreating}>
                {isCreating ? 'Adding...' : 'Add Label'}
              </button>
            </div>
          </form>
        </div>
      </section>
    </div>
  )
}

function DetailPanel({ label, meta, children }) {
  return (
    <section className="detail-panel">
      {label || meta ? (
        <div className="detail-panel__header">
          {label ? <span className="detail-panel__label">{label}</span> : <span />}
          {meta ? <span className="detail-panel__meta">{meta}</span> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

function DetailEmptyState({ actionLabel, message, onAction }) {
  return (
    <div className="detail-panel__empty-state">
      <p className="detail-panel__empty">{message}</p>
      {actionLabel && onAction ? (
        <button className="icon-button" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  )
}

function DetailInfoState({ description, title }) {
  return (
    <div className="comments-state">
      <p>{title}</p>
      {description ? <span>{description}</span> : null}
    </div>
  )
}

function TaskDetailsModal({
  activity,
  activityError,
  assignees,
  labels,
  commentFormState,
  comments,
  commentsError,
  errorMessage,
  formState,
  isActivityLoading,
  isCommentsLoading,
  isCreatingComment,
  isDeleting,
  isEditing,
  isSaving,
  isUpdatingAssignees,
  labelOptions,
  memberOptions,
  selectedLabelIds,
  selectedAssigneeIds,
  task,
  onChange,
  onClose,
  onDelete,
  onEdit,
  onCancelEdit,
  onCommentChange,
  onCreateComment,
  onLabelToggle,
  onOpenLabels,
  onQuickToggleAssignee,
  onToggleAssignee,
  onOpenTeam,
  onSubmit,
}) {
  const [isAssigneePickerOpen, setIsAssigneePickerOpen] = useState(false)
  const dueLabel = formatDueDate(task.due_date)
  const dueTone = getDueDateTone(task.due_date)
  const visibleAssignees = assignees.slice(0, 4)
  const overflowAssignees = assignees.length - visibleAssignees.length

  function handleEditAction() {
    setIsAssigneePickerOpen(false)
    onEdit()
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-details-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <div>
            <span className="modal__eyebrow">Task details</span>
          </div>

          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={isSaving || isDeleting}
          >
            Close
          </button>
        </div>

        {errorMessage ? (
          <div className="banner banner--error" role="alert">
            {errorMessage}
          </div>
        ) : null}

        {isEditing ? (
          <form className="task-form" onSubmit={onSubmit}>
            <TaskFormFields formState={formState} onChange={onChange} />

            <div className="detail-modal__editor-grid">
              <DetailPanel label="Assignees">
                {memberOptions.length ? (
                  <div className="member-picker">
                    {memberOptions.map((member) => {
                      const isSelected = selectedAssigneeIds.includes(member.id)

                      return (
                        <label
                          key={member.id}
                          className={[
                            'member-picker__item',
                            isSelected ? 'member-picker__item--selected' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => onToggleAssignee(member.id)}
                          />
                          <AssigneeAvatar member={member} size="small" />
                          <span>{member.name}</span>
                        </label>
                      )
                    })}
                  </div>
                ) : (
                  <DetailEmptyState
                    actionLabel="Manage Team"
                    message="Create team members before assigning work."
                    onAction={onOpenTeam}
                  />
                )}
              </DetailPanel>

              <DetailPanel label="Labels">
                {labelOptions.length ? (
                  <div className="label-picker">
                    {labelOptions.map((label) => {
                      const isSelected = selectedLabelIds.includes(label.id)

                      return (
                        <label
                          key={label.id}
                          className={[
                            'label-picker__item',
                            isSelected ? 'label-picker__item--selected' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => onLabelToggle(label.id)}
                          />
                          <LabelChip label={label} />
                        </label>
                      )
                    })}
                  </div>
                ) : (
                  <DetailEmptyState
                    actionLabel="Custom Labels"
                    message="Create labels before tagging tasks."
                    onAction={onOpenLabels}
                  />
                )}
              </DetailPanel>
            </div>

            <div className="task-form__footer task-form__footer--actions">
              <button
                className="icon-button"
                type="button"
                onClick={onCancelEdit}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button className="primary-button" type="submit" disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        ) : (
          <div className="detail-modal__content">
            <section className="detail-modal__hero">
              <div className="detail-modal__hero-top">
                <div className="detail-modal__meta">
                  <span className={`badge badge--priority-${task.priority}`}>
                    {task.priority}
                  </span>
                  <span className="badge badge--status">{getColumnTitle(task.status)}</span>
                  {dueLabel ? (
                    <span className={`badge badge--due-${dueTone}`}>Due {dueLabel}</span>
                  ) : (
                    <span className="badge badge--due-neutral">No due date</span>
                  )}
                  {labels.map((label) => (
                    <LabelChip key={label.id} label={label} />
                  ))}
                </div>

                <div className="detail-modal__hero-assignees">
                  {visibleAssignees.length ? (
                    <div className="detail-modal__hero-avatars">
                      {visibleAssignees.map((member) => (
                        <AssigneeAvatar key={member.id} member={member} />
                      ))}
                      {overflowAssignees > 0 ? (
                        <span className="detail-modal__hero-overflow">
                          +{overflowAssignees}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <span className="detail-modal__hero-assignees-empty">No assignees</span>
                  )}

                  <div className="detail-modal__assignee-menu">
                    <button
                      className="detail-modal__assignee-trigger"
                      type="button"
                      onClick={() => {
                        if (!memberOptions.length) {
                          onOpenTeam()
                          return
                        }

                        setIsAssigneePickerOpen((current) => !current)
                      }}
                      disabled={isUpdatingAssignees}
                      aria-expanded={isAssigneePickerOpen}
                      aria-label="Add or remove assignees"
                    >
                      +
                    </button>

                    {isAssigneePickerOpen && memberOptions.length ? (
                      <div className="detail-modal__assignee-picker">
                        {memberOptions.map((member) => {
                          const isSelected = selectedAssigneeIds.includes(member.id)

                          return (
                            <label
                              key={member.id}
                              className={[
                                'detail-modal__assignee-option',
                                isSelected ? 'detail-modal__assignee-option--selected' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                disabled={isUpdatingAssignees}
                                onChange={() => onQuickToggleAssignee(member.id)}
                              />
                              <AssigneeAvatar member={member} size="small" />
                              <span>{member.name}</span>
                            </label>
                          )
                        })}
                        <button
                          className="detail-modal__assignee-manage"
                          type="button"
                          onClick={onOpenTeam}
                        >
                          Manage team
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <h3 className="detail-modal__title">{task.title}</h3>
              <p className="detail-modal__subtitle">
                {task.description?.trim()
                  ? task.description
                  : 'Add more detail to explain the goal, context, or acceptance criteria.'}
              </p>
            </section>

            <DetailPanel
              label="Activity"
            >
              {activityError ? (
                <div className="banner banner--error" role="alert">
                  {activityError}
                </div>
              ) : null}

              {isActivityLoading ? (
                <DetailInfoState title="Loading activity..." />
              ) : activity.length ? (
                <div className="activity-list">
                  {activity.map((entry) => (
                    <article key={entry.id} className="activity-item">
                      <div className="activity-item__line" />
                      <div className="activity-item__content">
                        <div className="activity-item__header">
                          <p className="activity-item__message">{entry.message}</p>
                          <time
                            dateTime={entry.created_at}
                            title={formatDateTime(entry.created_at)}
                          >
                            {formatRelativeTime(entry.created_at)}
                          </time>
                        </div>
                        <span className="activity-item__timestamp">
                          {formatDateTime(entry.created_at)}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <DetailInfoState
                  title="No activity yet."
                  description="Status moves, edits, assignments, and comments will appear here."
                />
              )}
            </DetailPanel>

            <DetailPanel
              label="Comments"
            >
              <form className="comment-form" onSubmit={onCreateComment}>
                <label className="comment-form__field">
                  <span>Add a comment</span>
                  <textarea
                    name="body"
                    value={commentFormState.body}
                    onChange={onCommentChange}
                    rows="3"
                    placeholder="Write an update, question, or note"
                    disabled={isCreatingComment}
                  />
                </label>

                <div className="comment-form__footer">
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={isCreatingComment}
                  >
                    {isCreatingComment ? 'Posting...' : 'Post Comment'}
                  </button>
                </div>
              </form>

              {commentsError ? (
                <div className="banner banner--error" role="alert">
                  {commentsError}
                </div>
              ) : null}

              {isCommentsLoading ? (
                <DetailInfoState title="Loading comments..." />
              ) : comments.length ? (
                <div className="comments-list">
                  {comments.map((comment) => (
                    <article key={comment.id} className="comment-card">
                      <div className="comment-card__header">
                        <span className="comment-card__author">Guest</span>
                        <time dateTime={comment.created_at}>
                          {formatDateTime(comment.created_at)}
                        </time>
                      </div>
                      <p>{comment.body}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <DetailInfoState
                  title="No comments yet."
                  description="Start by leaving the first note on this task!"
                />
              )}
            </DetailPanel>

            <div className="detail-modal__actions">
              <button
                className="icon-button"
                type="button"
                onClick={handleEditAction}
                disabled={isDeleting}
              >
                Edit Task
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={onDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete Task'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function TaskFormFields({ formState, onChange }) {
  return (
    <>
      <label>
        Title
        <input
          name="title"
          type="text"
          value={formState.title}
          onChange={onChange}
          placeholder="Ship drag-and-drop board"
          maxLength={120}
          required
        />
      </label>

      <label>
        Description
        <textarea
          name="description"
          value={formState.description}
          onChange={onChange}
          rows="4"
          placeholder="Optional context for this task"
        />
      </label>

      <div className="task-form__grid">
        <label>
          Priority
          <select name="priority" value={formState.priority} onChange={onChange}>
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          Due date
          <input
            name="due_date"
            type="date"
            value={formState.due_date}
            onChange={onChange}
          />
        </label>
      </div>
    </>
  )
}

function AssigneeAvatar({ member, size = 'medium' }) {
  return (
    <span
      className={`assignee-avatar assignee-avatar--${size}`}
      style={{ '--avatar-color': getMemberColor(member) }}
      title={member.name}
      aria-label={member.name}
    >
      {getMemberInitials(member.name)}
    </span>
  )
}

function LabelChip({ label }) {
  return (
    <span
      className="label-chip"
      style={{ '--label-color': getLabelColor(label) }}
      title={label.name}
    >
      {label.name}
    </span>
  )
}

export default App

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
import { useEffect, useRef, useState } from 'react'
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

const MEMBER_COLOR_OPTIONS = [
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
    const matchesPriority =
      filters.priority === 'all' ? true : task.priority === filters.priority

    return matchesTitle && matchesPriority
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

function App() {
  const boardStageRef = useRef(null)
  const [tasks, setTasks] = useState([])
  const [teamMembers, setTeamMembers] = useState([])
  const [taskAssignments, setTaskAssignments] = useState({})
  const [isLoading, setIsLoading] = useState(true)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isTeamOpen, setIsTeamOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [isCreatingMember, setIsCreatingMember] = useState(false)
  const [isActivityLoading, setIsActivityLoading] = useState(false)
  const [isCommentsLoading, setIsCommentsLoading] = useState(false)
  const [isCreatingComment, setIsCreatingComment] = useState(false)
  const [appError, setAppError] = useState('')
  const [boardError, setBoardError] = useState('')
  const [createError, setCreateError] = useState('')
  const [memberError, setMemberError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [activityError, setActivityError] = useState('')
  const [commentsError, setCommentsError] = useState('')
  const [activeTaskId, setActiveTaskId] = useState(null)
  const [selectedTaskId, setSelectedTaskId] = useState(null)
  const [isDetailEditing, setIsDetailEditing] = useState(false)
  const [isSavingTask, setIsSavingTask] = useState(false)
  const [isDeletingTask, setIsDeletingTask] = useState(false)
  const [formState, setFormState] = useState(EMPTY_FORM)
  const [detailFormState, setDetailFormState] = useState(EMPTY_FORM)
  const [memberFormState, setMemberFormState] = useState(EMPTY_MEMBER_FORM)
  const [commentFormState, setCommentFormState] = useState(EMPTY_COMMENT_FORM)
  const [taskActivity, setTaskActivity] = useState([])
  const [taskComments, setTaskComments] = useState([])
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState([])
  const [filters, setFilters] = useState({
    searchQuery: '',
    priority: 'all',
  })

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  )

  const filteredTasks = filterTasks(tasks, filters)
  const tasksByColumn = groupTasks(filteredTasks)
  const activeTask = tasks.find((task) => task.id === activeTaskId) ?? null
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null
  const teamMembersById = Object.fromEntries(teamMembers.map((member) => [member.id, member]))
  const selectedTaskAssigneeIds = selectedTask
    ? getTaskAssigneeIds(selectedTask.id, taskAssignments)
    : []
  const selectedTaskAssignees = selectedTaskAssigneeIds
    .map((memberId) => teamMembersById[memberId])
    .filter(Boolean)
  const hasActiveFilters =
    filters.searchQuery.trim().length > 0 || filters.priority !== 'all'

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
  }, [selectedTaskId, selectedTask, isDetailEditing, isSavingTask])

  useEffect(() => {
    if (!selectedTaskId) {
      setSelectedAssigneeIds([])
      return
    }

    setSelectedAssigneeIds(getTaskAssigneeIds(selectedTaskId, taskAssignments))
  }, [selectedTaskId, taskAssignments])

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

  async function initializeBoard() {
    setIsLoading(true)
    setAppError('')

    try {
      await ensureGuestSession()

      const [nextTasks, nextMembers, nextAssignments] = await Promise.all([
        fetchTasks(),
        fetchTeamMembers(),
        fetchTaskAssignees(),
      ])

      setTasks(nextTasks)
      setTeamMembers(nextMembers)
      setTaskAssignments(buildTaskAssignmentMap(nextAssignments))
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
      priority: 'all',
    })
  }

  function handleToggleAssignee(memberId) {
    setSelectedAssigneeIds((current) =>
      current.includes(memberId)
        ? current.filter((value) => value !== memberId)
        : [...current, memberId],
    )
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
    setCommentFormState(EMPTY_COMMENT_FORM)
    setIsDetailEditing(false)
  }

  function handleCloseDetails() {
    if (isSavingTask || isDeletingTask) {
      return
    }

    setDetailError('')
    setActivityError('')
    setCommentsError('')
    setSelectedTaskId(null)
    setDetailFormState(EMPTY_FORM)
    setSelectedAssigneeIds([])
    setCommentFormState(EMPTY_COMMENT_FORM)
    setTaskActivity([])
    setTaskComments([])
    setIsDetailEditing(false)
  }

  function handleStartEditing() {
    if (!selectedTask) {
      return
    }

    setDetailError('')
    setDetailFormState(getTaskFormState(selectedTask))
    setSelectedAssigneeIds(getTaskAssigneeIds(selectedTask.id, taskAssignments))
    setIsDetailEditing(true)
  }

  function handleCancelEditing() {
    if (!selectedTask || isSavingTask) {
      return
    }

    setDetailError('')
    setDetailFormState(getTaskFormState(selectedTask))
    setSelectedAssigneeIds(getTaskAssigneeIds(selectedTask.id, taskAssignments))
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

      setTaskAssignments((current) => {
        const nextAssignments = { ...current }

        if (selectedAssigneeIds.length) {
          nextAssignments[selectedTask.id] = selectedAssigneeIds
        } else {
          delete nextAssignments[selectedTask.id]
        }

        return nextAssignments
      })

      setDetailFormState(getTaskFormState(updatedTask))
      setIsDetailEditing(false)

      const editMessage = buildTaskEditActivityMessage(previousTask, updatedTask)
      const assignmentMessage = buildAssignmentActivityMessage(
        previousAssigneeIds,
        selectedAssigneeIds,
        teamMembersById,
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

    if (!stage) {
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

    if (!stage) {
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
        className="board-stage"
        onPointerMove={handleBoardStagePointerMove}
        onPointerLeave={handleBoardStagePointerLeave}
      >
        <div className="board-stage__content">
          <section className="board-toolbar">
            <header className="app-header">
              <h1>Spotlight.</h1>
            </header>

            <div className="board-toolbar__actions">
              <button className="icon-button" type="button" onClick={handleOpenTeam}>
                Manage Team
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
            </div>

            <div className="board-filters__meta">
              <p>
                Showing {filteredTasks.length} of {tasks.length} tasks
              </p>
              {hasActiveFilters ? (
                <button
                  className="icon-button"
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
                  teamMembersById={teamMembersById}
                  onOpenTask={handleOpenDetails}
                />
              ))}
            </section>

            <DragOverlay>
              {activeTask ? (
                <TaskPreviewCard
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

      {selectedTask ? (
        <TaskDetailsModal
          activity={taskActivity}
          activityError={activityError}
          assignees={selectedTaskAssignees}
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
          memberOptions={teamMembers}
          selectedAssigneeIds={selectedAssigneeIds}
          task={selectedTask}
          onChange={handleDetailFieldChange}
          onClose={handleCloseDetails}
          onDelete={handleDeleteTask}
          onEdit={handleStartEditing}
          onCancelEdit={handleCancelEditing}
          onCommentChange={handleCommentFieldChange}
          onCreateComment={handleCreateComment}
          onToggleAssignee={handleToggleAssignee}
          onOpenTeam={handleOpenTeam}
          onSubmit={handleSaveTask}
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
                ? 'Try a different title or priority filter.'
                : 'Drop a task here or create a new one.'}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}

function TaskCard({ assignees, task, isGhosted = false, isSelected = false, onOpen }) {
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
        task={task}
        dueLabel={dueLabel}
        dueTone={dueTone}
      />
    </article>
  )
}

function TaskPreviewCard({ assignees, task }) {
  const dueTone = getDueDateTone(task.due_date)
  const dueLabel = formatDueDate(task.due_date)

  return (
    <article className="task-card task-card--overlay">
      <TaskCardContent
        assignees={assignees}
        task={task}
        dueLabel={dueLabel}
        dueTone={dueTone}
      />
    </article>
  )
}

function TaskCardContent({ assignees, task, dueLabel, dueTone }) {
  return (
    <>
      <div className="task-card__topline">
        <span className={`badge badge--priority-${task.priority}`}>
          {task.priority}
        </span>
        {dueLabel ? (
          <span className={`badge badge--due-${dueTone}`}>Due {dueLabel}</span>
        ) : null}
      </div>

      <h3>{task.title}</h3>

      {task.description ? <p>{task.description}</p> : null}

      {assignees.length ? <TaskAssigneeSummary assignees={assignees} /> : null}
    </>
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
      <span className="task-card__assignee-count">
        {assignees.length} assignee{assignees.length === 1 ? '' : 's'}
      </span>
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
            <p>New tasks always start in the To Do column.</p>
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
              <p>Initials are generated automatically from the member name.</p>
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

function TaskDetailsModal({
  activity,
  activityError,
  assignees,
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
  memberOptions,
  selectedAssigneeIds,
  task,
  onChange,
  onClose,
  onDelete,
  onEdit,
  onCancelEdit,
  onCommentChange,
  onCreateComment,
  onToggleAssignee,
  onOpenTeam,
  onSubmit,
}) {
  const dueLabel = formatDueDate(task.due_date)
  const dueTone = getDueDateTone(task.due_date)

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
            <h2 id="task-details-title">{isEditing ? 'Edit task' : task.title}</h2>
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

            <section className="detail-panel">
              <span className="detail-panel__label">Assignees</span>
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
                <div className="detail-panel__empty-state">
                  <p className="detail-panel__empty">
                    Create team members before assigning work.
                  </p>
                  <button className="icon-button" type="button" onClick={onOpenTeam}>
                    Manage Team
                  </button>
                </div>
              )}
            </section>

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
            </div>

            <section className="detail-panel">
              <span className="detail-panel__label">Description</span>
              {task.description ? (
                <p>{task.description}</p>
              ) : (
                <p className="detail-panel__empty">No description added yet.</p>
              )}
            </section>

            <section className="detail-panel">
              <span className="detail-panel__label">Assignees</span>
              {assignees.length ? (
                <div className="detail-panel__assignees">
                  {assignees.map((member) => (
                    <div key={member.id} className="team-member">
                      <AssigneeAvatar member={member} />
                      <div>
                        <p>{member.name}</p>
                        <span>Assigned to this task</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="detail-panel__empty-state">
                  <p className="detail-panel__empty">No assignees yet.</p>
                  <button className="icon-button" type="button" onClick={onOpenTeam}>
                    Manage Team
                  </button>
                </div>
              )}
            </section>

            <section className="detail-panel">
              <span className="detail-panel__label">Created</span>
              <p>{formatDateTime(task.created_at)}</p>
            </section>

            <section className="detail-panel">
              <div className="detail-panel__header">
                <span className="detail-panel__label">Activity</span>
                <span className="detail-panel__meta">
                  {activity.length} event{activity.length === 1 ? '' : 's'}
                </span>
              </div>

              {activityError ? (
                <div className="banner banner--error" role="alert">
                  {activityError}
                </div>
              ) : null}

              {isActivityLoading ? (
                <div className="comments-state">
                  <p>Loading activity...</p>
                </div>
              ) : activity.length ? (
                <div className="activity-list">
                  {activity.map((entry) => (
                    <article key={entry.id} className="activity-item">
                      <div className="activity-item__line" />
                      <div className="activity-item__content">
                        <div className="activity-item__header">
                          <p className="activity-item__message">{entry.message}</p>
                          <time dateTime={entry.created_at} title={formatDateTime(entry.created_at)}>
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
                <div className="comments-state">
                  <p>No activity yet.</p>
                  <span>Status moves, edits, assignments, and comments will appear here.</span>
                </div>
              )}
            </section>

            <section className="detail-panel">
              <div className="detail-panel__header">
                <span className="detail-panel__label">Comments</span>
                <span className="detail-panel__meta">
                  {comments.length} comment{comments.length === 1 ? '' : 's'}
                </span>
              </div>

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
                  <p>Comments are posted to this task in chronological order.</p>
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
                <div className="comments-state">
                  <p>Loading comments...</p>
                </div>
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
                <div className="comments-state">
                  <p>No comments yet.</p>
                  <span>Start the thread with the first note on this task.</span>
                </div>
              )}
            </section>

            <div className="detail-modal__actions">
              <button
                className="icon-button"
                type="button"
                onClick={onEdit}
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

export default App

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
  ensureGuestSession,
  fetchTasks,
  updateTaskStatus,
} from './lib/tasks'
import './App.css'

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
]

const EMPTY_FORM = {
  title: '',
  description: '',
  priority: 'normal',
  due_date: '',
}

const COLUMN_IDS = new Set(COLUMNS.map((column) => column.id))

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
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

function formatDueDate(dueDate) {
  if (!dueDate) {
    return null
  }

  return dateFormatter.format(new Date(`${dueDate}T00:00:00`))
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

function App() {
  const boardStageRef = useRef(null)
  const [session, setSession] = useState(null)
  const [tasks, setTasks] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [appError, setAppError] = useState('')
  const [actionError, setActionError] = useState('')
  const [activeTaskId, setActiveTaskId] = useState(null)
  const [formState, setFormState] = useState(EMPTY_FORM)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  )

  const tasksByColumn = groupTasks(tasks)
  const activeTask = tasks.find((task) => task.id === activeTaskId) ?? null

  useEffect(() => {
    initializeBoard()
  }, [])

  async function initializeBoard() {
    setIsLoading(true)
    setAppError('')

    try {
      const activeSession = await ensureGuestSession()
      setSession(activeSession)

      const nextTasks = await fetchTasks()
      setTasks(nextTasks)
    } catch (error) {
      setAppError(error.message || 'Unable to load your task board.')
    } finally {
      setIsLoading(false)
    }
  }

  function handleOpenCreate() {
    setActionError('')
    setIsCreateOpen(true)
  }

  function handleCloseCreate() {
    if (isCreating) {
      return
    }

    setFormState(EMPTY_FORM)
    setIsCreateOpen(false)
  }

  function handleFieldChange(event) {
    const { name, value } = event.target
    setFormState((current) => ({
      ...current,
      [name]: value,
    }))
  }

  async function handleCreateTask(event) {
    event.preventDefault()

    const title = formState.title.trim()

    if (!title) {
      setActionError('A task title is required.')
      return
    }

    setIsCreating(true)
    setActionError('')

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
    } catch (error) {
      setActionError(error.message || 'Unable to create the task right now.')
    } finally {
      setIsCreating(false)
    }
  }

  function handleDragStart(event) {
    setActiveTaskId(String(event.active.id))
    setActionError('')
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
    } catch (error) {
      setTasks(previousTasks)
      setActionError(error.message || 'Unable to move that task right now.')
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
            <div className="hero-panel__meta">
              <span className="meta-chip">{tasks.length} tasks</span>
              <span className="meta-chip meta-chip--muted">
                Session {session?.user?.id?.slice(0, 8) ?? 'guest'}
              </span>
            </div>

            <button className="primary-button" type="button" onClick={handleOpenCreate}>
              New Task
            </button>
          </section>

          {actionError ? (
            <div className="banner banner--error" role="alert">
              {actionError}
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
                />
              ))}
            </section>

            <DragOverlay>
              {activeTask ? <TaskPreviewCard task={activeTask} /> : null}
            </DragOverlay>
          </DndContext>
        </div>
      </section>

      {isCreateOpen ? (
        <CreateTaskModal
          formState={formState}
          isCreating={isCreating}
          onChange={handleFieldChange}
          onClose={handleCloseCreate}
          onSubmit={handleCreateTask}
        />
      ) : null}
    </main>
  )
}

function BoardColumn({ column, tasks, activeTaskId }) {
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
              task={task}
              isGhosted={activeTaskId === task.id}
            />
          ))
        ) : (
          <div className="empty-column">
            <p>No tasks here yet.</p>
            <span>Drop a task here or create a new one.</span>
          </div>
        )}
      </div>
    </section>
  )
}

function TaskCard({ task, isGhosted = false }) {
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
      ]
        .filter(Boolean)
        .join(' ')}
      {...attributes}
      {...listeners}
    >
      <TaskCardContent task={task} dueLabel={dueLabel} dueTone={dueTone} />
    </article>
  )
}

function TaskPreviewCard({ task }) {
  const dueTone = getDueDateTone(task.due_date)
  const dueLabel = formatDueDate(task.due_date)

  return (
    <article className="task-card task-card--overlay">
      <TaskCardContent task={task} dueLabel={dueLabel} dueTone={dueTone} />
    </article>
  )
}

function TaskCardContent({ task, dueLabel, dueTone }) {
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
    </>
  )
}

function CreateTaskModal({
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
              <select
                name="priority"
                value={formState.priority}
                onChange={onChange}
              >
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

export default App

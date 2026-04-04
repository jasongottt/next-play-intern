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

function App() {
  const boardStageRef = useRef(null)
  const [tasks, setTasks] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [appError, setAppError] = useState('')
  const [boardError, setBoardError] = useState('')
  const [createError, setCreateError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [activeTaskId, setActiveTaskId] = useState(null)
  const [selectedTaskId, setSelectedTaskId] = useState(null)
  const [isDetailEditing, setIsDetailEditing] = useState(false)
  const [isSavingTask, setIsSavingTask] = useState(false)
  const [isDeletingTask, setIsDeletingTask] = useState(false)
  const [formState, setFormState] = useState(EMPTY_FORM)
  const [detailFormState, setDetailFormState] = useState(EMPTY_FORM)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  )

  const tasksByColumn = groupTasks(tasks)
  const activeTask = tasks.find((task) => task.id === activeTaskId) ?? null
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null

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

  async function initializeBoard() {
    setIsLoading(true)
    setAppError('')

    try {
      await ensureGuestSession()

      const nextTasks = await fetchTasks()
      setTasks(nextTasks)
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

  function handleCloseCreate() {
    if (isCreating) {
      return
    }

    setCreateError('')
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

  function handleDetailFieldChange(event) {
    const { name, value } = event.target
    setDetailFormState((current) => ({
      ...current,
      [name]: value,
    }))
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
    } catch (error) {
      setCreateError(error.message || 'Unable to create the task right now.')
    } finally {
      setIsCreating(false)
    }
  }

  function handleOpenDetails(task) {
    setBoardError('')
    setDetailError('')
    setSelectedTaskId(task.id)
    setDetailFormState(getTaskFormState(task))
    setIsDetailEditing(false)
  }

  function handleCloseDetails() {
    if (isSavingTask || isDeletingTask) {
      return
    }

    setDetailError('')
    setSelectedTaskId(null)
    setDetailFormState(EMPTY_FORM)
    setIsDetailEditing(false)
  }

  function handleStartEditing() {
    if (!selectedTask) {
      return
    }

    setDetailError('')
    setDetailFormState(getTaskFormState(selectedTask))
    setIsDetailEditing(true)
  }

  function handleCancelEditing() {
    if (!selectedTask || isSavingTask) {
      return
    }

    setDetailError('')
    setDetailFormState(getTaskFormState(selectedTask))
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
      const updatedTask = await updateTask(selectedTask.id, {
        title,
        description: detailFormState.description,
        priority: detailFormState.priority,
        due_date: detailFormState.due_date,
      })

      setTasks((current) =>
        current.map((task) => (task.id === updatedTask.id ? updatedTask : task)),
      )
      setDetailFormState(getTaskFormState(updatedTask))
      setIsDetailEditing(false)
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
      setSelectedTaskId(null)
      setDetailFormState(EMPTY_FORM)
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

            <button className="primary-button" type="button" onClick={handleOpenCreate}>
              New Task
            </button>
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
                  selectedTaskId={selectedTaskId}
                  onOpenTask={handleOpenDetails}
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
          errorMessage={createError}
          formState={formState}
          isCreating={isCreating}
          onChange={handleFieldChange}
          onClose={handleCloseCreate}
          onSubmit={handleCreateTask}
        />
      ) : null}

      {selectedTask ? (
        <TaskDetailsModal
          errorMessage={detailError}
          formState={detailFormState}
          isDeleting={isDeletingTask}
          isEditing={isDetailEditing}
          isSaving={isSavingTask}
          task={selectedTask}
          onChange={handleDetailFieldChange}
          onClose={handleCloseDetails}
          onDelete={handleDeleteTask}
          onEdit={handleStartEditing}
          onCancelEdit={handleCancelEditing}
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
  selectedTaskId,
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
              task={task}
              isGhosted={activeTaskId === task.id}
              isSelected={selectedTaskId === task.id}
              onOpen={onOpenTask}
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

function TaskCard({ task, isGhosted = false, isSelected = false, onOpen }) {
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

function TaskDetailsModal({
  errorMessage,
  formState,
  isDeleting,
  isEditing,
  isSaving,
  task,
  onChange,
  onClose,
  onDelete,
  onEdit,
  onCancelEdit,
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
              <span className="detail-panel__label">Created</span>
              <p>{new Date(task.created_at).toLocaleString()}</p>
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

export default App

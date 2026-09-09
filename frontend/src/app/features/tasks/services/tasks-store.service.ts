import { Injectable, computed, signal } from '@angular/core';
import { uuid } from '../../../core/uuid';
import { KanbanLane, Subtask, TaskAttachment, TaskCategory, TaskComment, TaskItem, TaskProject, TaskProjectMembership } from '../models/task.model';
import { stripNotesImages } from '../notes/notes-html';
import { TaskUpsertInput, TasksService } from './tasks.service';

export interface TaskStateSnapshot {
  id: string;
  isCompleted: boolean;
  completedAt: string | null;
  deletedAt: string | null;
}

type TaskDraft = Partial<
  Pick<
    TaskUpsertInput,
    | 'title'
    | 'description'
    | 'dueDate'
    | 'priority'
    | 'categoryIds'
    | 'isRecurring'
    | 'recurrenceRule'
    | 'locationLabel'
  >
> & { subtasks?: Subtask[]; notes?: string | null };

@Injectable({ providedIn: 'root' })
export class TasksStoreService {
  categories = signal<TaskCategory[]>([]);
  projects = signal<TaskProject[]>([]);
  kanbanLanes = signal<KanbanLane[]>([]);
  memberships = signal<TaskProjectMembership[]>([]);
  tasks = signal<TaskItem[]>([]);
  loading = signal(true);

  activeTasks = computed(() => this.tasks().filter((t) => !t.deletedAt));
  trashedTasks = computed(() =>
    this.tasks()
      .filter((t) => !!t.deletedAt)
      .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '')),
  );

  constructor(private api: TasksService) {}

  async reload(): Promise<void> {
    this.loading.set(true);
    const [categories, projects, lanes, memberships, tasks] = await Promise.all([
      this.api.listCategories(),
      this.api.listProjects(),
      this.api.listKanbanLanes(),
      this.api.listMemberships(),
      this.api.listTasks(),
    ]);
    this.categories.set(categories);
    this.projects.set(projects);
    this.kanbanLanes.set(lanes);
    this.memberships.set(memberships);
    this.tasks.set(tasks);
    this.loading.set(false);
  }

  categoriesFor(task: TaskItem): TaskCategory[] {
    const byId = new Map(this.categories().map((c) => [c.id, c]));
    return task.categoryIds.map((id) => byId.get(id)).filter((c): c is TaskCategory => !!c);
  }

  lanesFor(projectId: string): KanbanLane[] {
    return this.kanbanLanes()
      .filter((l) => l.projectId === projectId)
      .sort((a, b) => a.position - b.position);
  }

  membershipsFor(projectId: string): TaskProjectMembership[] {
    return this.memberships()
      .filter((m) => m.projectId === projectId)
      .sort((a, b) => a.position - b.position);
  }

  projectsFor(task: TaskItem): TaskProject[] {
    const projectIds = new Set(this.memberships().filter((m) => m.taskId === task.id).map((m) => m.projectId));
    return this.projects().filter((p) => projectIds.has(p.id));
  }

  laneForMembership(membership: TaskProjectMembership): KanbanLane | undefined {
    return membership.kanbanLaneId ? this.kanbanLanes().find((l) => l.id === membership.kanbanLaneId) : undefined;
  }

  async createTask(draft: TaskDraft): Promise<TaskItem> {
    const now = new Date().toISOString();
    const id = uuid();
    const maxPosition = Math.max(0, ...this.activeTasks().map((t) => t.position));
    const created = await this.api.upsertTask(id, {
      title: draft.title?.trim() || 'Sem título',
      description: draft.description ?? null,
      dueDate: draft.dueDate ?? null,
      priority: draft.priority ?? 'Medium',
      categoryIds: draft.categoryIds ?? [],
      isRecurring: draft.isRecurring ?? false,
      recurrenceRule: draft.recurrenceRule ?? null,
      isCompleted: false,
      createdAt: now,
      completedAt: null,
      deletedAt: null,
      completedPomodoros: 0,
      position: maxPosition + 1,
      locationLat: null,
      locationLng: null,
      locationRadiusMeters: null,
      locationLabel: draft.locationLabel ?? null,
      subtasks: draft.subtasks ?? [],
      notes: draft.notes ?? null,
      updatedAt: now,
    });
    this.tasks.update((list) => [...list, created]);
    return created;
  }

  async updateTask(task: TaskItem, patch: TaskDraft): Promise<void> {
    await this.save(task, patch);
  }

  async toggleComplete(task: TaskItem): Promise<void> {
    await this.setCompleted(task, !task.isCompleted);
  }

  async setCompleted(task: TaskItem, isCompleted: boolean): Promise<void> {
    if (task.isCompleted === isCompleted) return;
    await this.save(task, {}, { isCompleted, completedAt: isCompleted ? new Date().toISOString() : null });
  }

  async toggleSubtask(task: TaskItem, index: number): Promise<void> {
    const subtasks = task.subtasks.map((s, i) => (i === index ? { ...s, isCompleted: !s.isCompleted } : s));
    await this.save(task, { subtasks });
  }

  async moveToTrash(task: TaskItem): Promise<void> {
    await this.save(task, {}, { deletedAt: new Date().toISOString() });
  }

  async restore(task: TaskItem): Promise<void> {
    await this.save(task, {}, { deletedAt: null });
  }

  async deleteForever(task: TaskItem): Promise<void> {
    await this.api.deleteTaskForever(task.id);
    this.tasks.update((list) => list.filter((t) => t.id !== task.id));
    this.memberships.update((list) => list.filter((m) => m.taskId !== task.id));
  }

  async duplicateTask(task: TaskItem): Promise<TaskItem> {
    return this.createTask({
      title: `${task.title} (cópia)`,
      description: task.description,
      dueDate: task.dueDate,
      priority: task.priority,
      categoryIds: task.categoryIds,
      isRecurring: task.isRecurring,
      recurrenceRule: task.recurrenceRule,
      locationLabel: task.locationLabel,
      subtasks: task.subtasks.map((s) => ({ ...s, isCompleted: false })),
      // Os anexos não são duplicados junto, então a cópia leva o texto sem as imagens (que
      // apontariam pra anexos da tarefa original).
      notes: stripNotesImages(task.notes) || null,
    });
  }

  async bulkComplete(tasks: TaskItem[], isCompleted: boolean): Promise<void> {
    await Promise.all(
      tasks.map((t) => this.save(t, {}, { isCompleted, completedAt: isCompleted ? new Date().toISOString() : null })),
    );
  }

  async bulkTrash(tasks: TaskItem[]): Promise<void> {
    const deletedAt = new Date().toISOString();
    await Promise.all(tasks.map((t) => this.save(t, {}, { deletedAt })));
  }

  async bulkSetCategory(tasks: TaskItem[], categoryId: string | null): Promise<void> {
    await Promise.all(tasks.map((t) => this.save(t, { categoryIds: categoryId ? [categoryId] : [] })));
  }

  /** Captura o estado mutável por ações em massa, pra permitir desfazer depois. */
  snapshotState(task: TaskItem): TaskStateSnapshot {
    return { id: task.id, isCompleted: task.isCompleted, completedAt: task.completedAt, deletedAt: task.deletedAt };
  }

  async restoreState(snapshots: TaskStateSnapshot[]): Promise<void> {
    const byId = new Map(this.tasks().map((t) => [t.id, t]));
    await Promise.all(
      snapshots.map((s) => {
        const task = byId.get(s.id);
        if (!task) return Promise.resolve();
        return this.save(task, {}, { isCompleted: s.isCompleted, completedAt: s.completedAt, deletedAt: s.deletedAt });
      }),
    );
  }

  listComments(taskId: string): Promise<TaskComment[]> {
    return this.api.listComments(taskId);
  }

  addComment(taskId: string, text: string): Promise<TaskComment> {
    return this.api.addComment(taskId, text);
  }

  deleteComment(taskId: string, commentId: string): Promise<void> {
    return this.api.deleteComment(taskId, commentId);
  }

  listAttachments(taskId: string): Promise<TaskAttachment[]> {
    return this.api.listAttachments(taskId);
  }

  addAttachment(taskId: string, fileName: string, contentType: string, dataBase64: string): Promise<TaskAttachment> {
    return this.api.addAttachment(taskId, fileName, contentType, dataBase64);
  }

  deleteAttachment(taskId: string, attachmentId: string): Promise<void> {
    return this.api.deleteAttachment(taskId, attachmentId);
  }

  downloadAttachment(taskId: string, attachmentId: string): Promise<Blob> {
    return this.api.downloadAttachment(taskId, attachmentId);
  }

  async incrementPomodoro(task: TaskItem): Promise<void> {
    await this.save(task, {}, { completedPomodoros: task.completedPomodoros + 1 });
  }

  async reorder(orderedIds: string[]): Promise<void> {
    const byId = new Map(this.tasks().map((t) => [t.id, t]));
    await Promise.all(
      orderedIds.map((id, index) => {
        const task = byId.get(id);
        return task && task.position !== index ? this.save(task, {}, { position: index }) : Promise.resolve();
      }),
    );
  }

  async createCategory(name: string, colorHex: string): Promise<TaskCategory> {
    const id = uuid();
    const category = await this.api.upsertCategory(id, name.trim(), colorHex, new Date().toISOString());
    this.categories.update((list) => [...list, category].sort((a, b) => a.name.localeCompare(b.name)));
    return category;
  }

  async renameCategory(category: TaskCategory, name: string, colorHex: string): Promise<void> {
    const updated = await this.api.upsertCategory(category.id, name.trim(), colorHex, new Date().toISOString());
    this.categories.update((list) =>
      list.map((c) => (c.id === category.id ? updated : c)).sort((a, b) => a.name.localeCompare(b.name)),
    );
  }

  async deleteCategory(category: TaskCategory): Promise<void> {
    await this.api.deleteCategory(category.id);
    this.categories.update((list) => list.filter((c) => c.id !== category.id));
    this.tasks.update((list) =>
      list.map((t) => (t.categoryIds.includes(category.id) ? { ...t, categoryIds: t.categoryIds.filter((id) => id !== category.id) } : t)),
    );
  }

  async createProject(name: string, colorHex: string): Promise<TaskProject> {
    const id = uuid();
    const position = Math.max(-1, ...this.projects().map((p) => p.position)) + 1;
    const project = await this.api.upsertProject(id, name.trim(), colorHex, position, new Date().toISOString());
    this.projects.update((list) => [...list, project].sort((a, b) => a.position - b.position));
    return project;
  }

  async renameProject(project: TaskProject, name: string, colorHex: string): Promise<void> {
    const updated = await this.api.upsertProject(project.id, name.trim(), colorHex, project.position, new Date().toISOString());
    this.projects.update((list) =>
      list.map((p) => (p.id === project.id ? updated : p)).sort((a, b) => a.position - b.position),
    );
  }

  async deleteProject(project: TaskProject): Promise<void> {
    await this.api.deleteProject(project.id);
    this.projects.update((list) => list.filter((p) => p.id !== project.id));
    this.kanbanLanes.update((list) => list.filter((l) => l.projectId !== project.id));
    this.memberships.update((list) => list.filter((m) => m.projectId !== project.id));
  }

  async createLane(projectId: string, name: string, colorHex: string): Promise<KanbanLane> {
    const id = uuid();
    const position = Math.max(-1, ...this.lanesFor(projectId).map((l) => l.position)) + 1;
    const lane = await this.api.upsertKanbanLane(id, projectId, name.trim(), colorHex, position, new Date().toISOString());
    this.kanbanLanes.update((list) => [...list, lane].sort((a, b) => a.position - b.position));
    return lane;
  }

  async renameLane(lane: KanbanLane, name: string, colorHex: string): Promise<void> {
    const updated = await this.api.upsertKanbanLane(
      lane.id, lane.projectId, name.trim(), colorHex, lane.position, new Date().toISOString(),
    );
    this.kanbanLanes.update((list) =>
      list.map((l) => (l.id === lane.id ? updated : l)).sort((a, b) => a.position - b.position),
    );
  }

  async deleteLane(lane: KanbanLane): Promise<void> {
    await this.api.deleteKanbanLane(lane.id);
    this.kanbanLanes.update((list) => list.filter((l) => l.id !== lane.id));
    this.memberships.update((list) => list.map((m) => (m.kanbanLaneId === lane.id ? { ...m, kanbanLaneId: null } : m)));
  }

  async reorderLanes(projectId: string, orderedIds: string[]): Promise<void> {
    const byId = new Map(this.lanesFor(projectId).map((l) => [l.id, l]));
    const updated = await Promise.all(
      orderedIds.map(async (id, index) => {
        const lane = byId.get(id);
        if (!lane || lane.position === index) return lane;
        return this.api.upsertKanbanLane(lane.id, lane.projectId, lane.name, lane.colorHex, index, new Date().toISOString());
      }),
    );
    this.kanbanLanes.update((list) => {
      const merged = new Map(list.map((l) => [l.id, l]));
      for (const lane of updated) if (lane) merged.set(lane.id, lane);
      return [...merged.values()].sort((a, b) => a.position - b.position);
    });
  }

  async addTaskToProject(taskId: string, projectId: string): Promise<TaskProjectMembership> {
    const id = uuid();
    const position = Math.max(-1, ...this.membershipsFor(projectId).map((m) => m.position)) + 1;
    const membership = await this.api.upsertMembership(id, taskId, projectId, null, position, new Date().toISOString());
    this.memberships.update((list) => [...list, membership]);
    return membership;
  }

  async removeTaskFromProject(membership: TaskProjectMembership): Promise<void> {
    await this.api.deleteMembership(membership.id);
    this.memberships.update((list) => list.filter((m) => m.id !== membership.id));
  }

  async setMembershipLane(membership: TaskProjectMembership, kanbanLaneId: string | null): Promise<void> {
    if (membership.kanbanLaneId === kanbanLaneId) return;
    const updated = await this.api.upsertMembership(
      membership.id, membership.taskId, membership.projectId, kanbanLaneId, membership.position, new Date().toISOString(),
    );
    this.memberships.update((list) => list.map((m) => (m.id === membership.id ? updated : m)));
  }

  async reorderMemberships(projectId: string, orderedIds: string[]): Promise<void> {
    const byId = new Map(this.membershipsFor(projectId).map((m) => [m.id, m]));
    const updated = await Promise.all(
      orderedIds.map(async (id, index) => {
        const membership = byId.get(id);
        if (!membership || membership.position === index) return membership;
        return this.api.upsertMembership(
          membership.id, membership.taskId, membership.projectId, membership.kanbanLaneId, index, new Date().toISOString(),
        );
      }),
    );
    this.memberships.update((list) => {
      const merged = new Map(list.map((m) => [m.id, m]));
      for (const membership of updated) if (membership) merged.set(membership.id, membership);
      return [...merged.values()];
    });
  }

  /** Aplica um patch parcial numa tarefa e persiste — sempre reenvia o objeto inteiro (upsert idempotente). */
  private async save(task: TaskItem, draft: TaskDraft, overrides: Partial<TaskItem> = {}): Promise<void> {
    const now = new Date().toISOString();
    const merged: TaskItem = {
      ...task,
      title: draft.title !== undefined ? draft.title.trim() || task.title : task.title,
      description: draft.description !== undefined ? draft.description : task.description,
      dueDate: draft.dueDate !== undefined ? draft.dueDate : task.dueDate,
      priority: draft.priority ?? task.priority,
      categoryIds: draft.categoryIds !== undefined ? draft.categoryIds : task.categoryIds,
      isRecurring: draft.isRecurring ?? task.isRecurring,
      recurrenceRule: draft.recurrenceRule !== undefined ? draft.recurrenceRule : task.recurrenceRule,
      subtasks: draft.subtasks ?? task.subtasks,
      notes: draft.notes !== undefined ? draft.notes : task.notes,
      ...overrides,
      updatedAt: now,
    };
    const saved = await this.api.upsertTask(task.id, {
      title: merged.title,
      description: merged.description,
      dueDate: merged.dueDate,
      priority: merged.priority,
      categoryIds: merged.categoryIds,
      isRecurring: merged.isRecurring,
      recurrenceRule: merged.recurrenceRule,
      isCompleted: merged.isCompleted,
      createdAt: merged.createdAt,
      completedAt: merged.completedAt,
      deletedAt: merged.deletedAt,
      completedPomodoros: merged.completedPomodoros,
      position: merged.position,
      locationLat: merged.locationLat,
      locationLng: merged.locationLng,
      locationRadiusMeters: merged.locationRadiusMeters,
      locationLabel: merged.locationLabel,
      subtasks: merged.subtasks,
      notes: merged.notes,
      updatedAt: merged.updatedAt,
    });
    this.tasks.update((list) => list.map((t) => (t.id === task.id ? saved : t)));
  }
}

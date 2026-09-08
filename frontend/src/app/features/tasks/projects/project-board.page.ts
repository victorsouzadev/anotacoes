import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../../shared/icon';
import { TasksTopBarComponent } from '../components/tasks-top-bar.component';
import { TaskFormComponent, TaskFormResult } from '../components/task-form.component';
import { TaskDetailComponent } from '../components/task-detail.component';
import { CATEGORY_COLORS, KanbanLane, TaskItem, TaskProject, TaskProjectMembership } from '../models/task.model';
import { TasksStoreService } from '../services/tasks-store.service';
import { TasksFilterStateService } from '../services/tasks-filter-state.service';
import { NO_CATEGORY } from '../list/task-filters';
import { reorderIds } from '../kanban/kanban-logic';

type GroupBy = 'lanes' | 'status';

const STATUS_TODO = '__todo__';
const STATUS_DONE = '__done__';
const NO_LANE = '__none__';

interface KanbanColumn {
  id: string;
  name: string;
  colorHex: string | null;
  /** Raias de verdade podem ser editadas/apagadas/reordenadas; a coluna "Sem raia" e as de status não. */
  lane: KanbanLane | null;
}

@Component({
  selector: 'app-project-board-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TasksTopBarComponent, IconComponent, TaskFormComponent, TaskDetailComponent],
  templateUrl: './project-board.page.html',
  styleUrl: './project-board.page.css',
})
export class ProjectBoardPageComponent implements OnInit {
  readonly colors = CATEGORY_COLORS;
  readonly NO_CATEGORY = NO_CATEGORY;

  projectId = '';
  groupBy: GroupBy = 'lanes';
  showCategoryFilter = false;
  showAddExisting = false;
  addExistingSearch = '';

  draggingTaskId: string | null = null;
  dragOverColumn: string | null = null;
  dragOverTaskId: string | null = null;

  draggingLaneId: string | null = null;
  dragOverLaneId: string | null = null;

  editingLaneId: string | null = null;
  editingLaneName = '';
  editingLaneColor = CATEGORY_COLORS[0];

  showNewLane = false;
  newLaneName = '';
  newLaneColor = CATEGORY_COLORS[0];

  detailTask: TaskItem | null = null;
  showForm = false;
  formTask: TaskItem | null = null;
  creatingTask = false;

  constructor(
    public store: TasksStoreService,
    public filterState: TasksFilterStateService,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    this.projectId = this.route.snapshot.paramMap.get('id') ?? '';
    await this.store.reload();
    if (!this.project()) {
      await this.router.navigateByUrl('/tasks/projetos');
      return;
    }
    this.cdr.markForCheck();
  }

  project(): TaskProject | undefined {
    return this.store.projects().find((p) => p.id === this.projectId);
  }

  columns(): KanbanColumn[] {
    if (this.groupBy === 'status') {
      return [
        { id: STATUS_TODO, name: 'A fazer', colorHex: null, lane: null },
        { id: STATUS_DONE, name: 'Concluída', colorHex: null, lane: null },
      ];
    }
    const lanes = this.store.lanesFor(this.projectId);
    return [
      { id: NO_LANE, name: 'Sem raia', colorHex: null, lane: null },
      ...lanes.map((l) => ({ id: l.id, name: l.name, colorHex: l.colorHex, lane: l })),
    ];
  }

  private membershipFor(taskId: string): TaskProjectMembership | undefined {
    return this.store.membershipsFor(this.projectId).find((m) => m.taskId === taskId);
  }

  private columnOf(task: TaskItem, membership: TaskProjectMembership | undefined): string | null {
    if (this.groupBy === 'status') return task.isCompleted ? STATUS_DONE : STATUS_TODO;
    return membership?.kanbanLaneId ?? NO_LANE;
  }

  tasksFor(columnId: string): TaskItem[] {
    const ids = this.filterState.categoryFilterIds();
    const wantsNoCategory = ids.includes(NO_CATEGORY);
    const wantedIds = ids.filter((id) => id !== NO_CATEGORY);
    const tasksById = new Map(this.store.tasks().map((t) => [t.id, t]));
    return this.store
      .membershipsFor(this.projectId)
      .map((m) => ({ membership: m, task: tasksById.get(m.taskId) }))
      .filter((x): x is { membership: TaskProjectMembership; task: TaskItem } => !!x.task && !x.task.deletedAt)
      .filter((x) => this.columnOf(x.task, x.membership) === columnId)
      .filter(
        (x) =>
          ids.length === 0 ||
          (wantsNoCategory && x.task.categoryIds.length === 0) ||
          x.task.categoryIds.some((id) => wantedIds.includes(id)),
      )
      .sort((a, b) => a.membership.position - b.membership.position)
      .map((x) => x.task);
  }

  tasksNotInProject(): TaskItem[] {
    const memberTaskIds = new Set(this.store.membershipsFor(this.projectId).map((m) => m.taskId));
    const term = this.addExistingSearch.trim().toLowerCase();
    return this.store
      .activeTasks()
      .filter((t) => !memberTaskIds.has(t.id))
      .filter((t) => !term || t.title.toLowerCase().includes(term))
      .slice(0, 30);
  }

  async addExistingTask(task: TaskItem): Promise<void> {
    await this.store.addTaskToProject(task.id, this.projectId);
    this.cdr.markForCheck();
  }

  async removeFromProject(task: TaskItem, event: Event): Promise<void> {
    event.stopPropagation();
    const membership = this.membershipFor(task.id);
    if (!membership) return;
    if (!confirm(`Remover "${task.title}" deste projeto? A tarefa continua existindo em /tasks.`)) return;
    await this.store.removeTaskFromProject(membership);
    this.cdr.markForCheck();
  }

  categoryFilterLabel(): string {
    const ids = this.filterState.categoryFilterIds();
    if (ids.length === 0) return 'Todas as categorias';
    const names = ids.map((id) =>
      id === NO_CATEGORY ? 'Sem categoria' : this.store.categories().find((c) => c.id === id)?.name ?? '?',
    );
    return names.length <= 2 ? names.join(', ') : `${names.length} categorias`;
  }

  isCategorySelected(id: string): boolean {
    return this.filterState.categoryFilterIds().includes(id);
  }

  toggleCategoryFilter(id: string): void {
    this.filterState.toggle(id);
  }

  isOverdue(task: TaskItem): boolean {
    return !!task.dueDate && !task.isCompleted && new Date(task.dueDate).getTime() < Date.now();
  }

  // --- Abrir/criar/editar tarefa ---

  openDetail(task: TaskItem, event: Event): void {
    event.stopPropagation();
    this.detailTask = task;
  }

  closeDetail(): void {
    this.detailTask = null;
  }

  editFromDetail(): void {
    const task = this.detailTask;
    this.detailTask = null;
    if (task) {
      this.formTask = task;
      this.creatingTask = false;
      this.showForm = true;
    }
  }

  openCreateForm(): void {
    this.formTask = null;
    this.creatingTask = true;
    this.showForm = true;
  }

  closeForm(): void {
    this.showForm = false;
    this.formTask = null;
    this.creatingTask = false;
  }

  async onSave(result: TaskFormResult): Promise<void> {
    if (this.creatingTask) {
      const created = await this.store.createTask(result);
      await this.store.addTaskToProject(created.id, this.projectId);
    } else if (this.formTask) {
      await this.store.updateTask(this.formTask, result);
    }
    this.closeForm();
    this.cdr.markForCheck();
  }

  async toggleComplete(task: TaskItem, event: Event): Promise<void> {
    event.stopPropagation();
    await this.store.toggleComplete(task);
    this.cdr.markForCheck();
  }

  // --- Drag-and-drop de tarefas entre colunas/cards ---

  onDragStart(task: TaskItem, event: DragEvent): void {
    this.draggingTaskId = task.id;
    event.dataTransfer?.setData('text/plain', task.id);
  }

  onDragEnd(): void {
    this.draggingTaskId = null;
    this.dragOverColumn = null;
    this.dragOverTaskId = null;
  }

  onDragOverColumn(columnId: string, event: DragEvent): void {
    event.preventDefault();
    this.dragOverColumn = columnId;
  }

  onDragOverCard(columnId: string, task: TaskItem, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOverColumn = columnId;
    this.dragOverTaskId = task.id;
  }

  async onDropColumn(columnId: string, event: DragEvent): Promise<void> {
    event.preventDefault();
    await this.dropTask(columnId, null);
  }

  async onDropCard(columnId: string, targetTask: TaskItem, event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    await this.dropTask(columnId, targetTask.id);
  }

  private async dropTask(columnId: string, targetTaskId: string | null): Promise<void> {
    this.dragOverColumn = null;
    this.dragOverTaskId = null;
    const id = this.draggingTaskId;
    this.draggingTaskId = null;
    if (!id) return;
    const task = this.store.activeTasks().find((t) => t.id === id);
    if (!task) return;

    const targetColumnIds = this.tasksFor(columnId).map((t) => t.id);
    const reordered = reorderIds(targetColumnIds, id, targetTaskId);

    await this.assignColumn(task, columnId);
    await this.store.reorderMemberships(this.projectId, reordered);
    this.cdr.markForCheck();
  }

  private async assignColumn(task: TaskItem, columnId: string): Promise<void> {
    const membership = this.membershipFor(task.id);
    if (!membership || this.columnOf(task, membership) === columnId) return;
    if (this.groupBy === 'status') {
      await this.store.setCompleted(task, columnId === STATUS_DONE);
    } else {
      await this.store.setMembershipLane(membership, columnId === NO_LANE ? null : columnId);
    }
  }

  // Fallback pra quem não consegue arrastar (touch não dispara drag-and-drop HTML5) — o select
  // por card move a tarefa direto pra outra coluna, indo pro fim dela.
  async onMoveSelect(task: TaskItem, event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    select.value = '';
    if (!value) return;
    await this.assignColumn(task, value);
    const targetColumnIds = [...this.tasksFor(value).map((t) => t.id), task.id];
    await this.store.reorderMemberships(this.projectId, targetColumnIds);
    this.cdr.markForCheck();
  }

  // --- Gestão das raias (criar / renomear / apagar / reordenar) ---

  async addLane(): Promise<void> {
    const name = this.newLaneName.trim();
    if (!name) return;
    await this.store.createLane(this.projectId, name, this.newLaneColor);
    this.newLaneName = '';
    this.newLaneColor = CATEGORY_COLORS[0];
    this.showNewLane = false;
    this.cdr.markForCheck();
  }

  startEditLane(lane: KanbanLane, event: Event): void {
    event.stopPropagation();
    this.editingLaneId = lane.id;
    this.editingLaneName = lane.name;
    this.editingLaneColor = lane.colorHex;
  }

  async commitEditLane(lane: KanbanLane): Promise<void> {
    if (this.editingLaneId !== lane.id) return;
    this.editingLaneId = null;
    const name = this.editingLaneName.trim();
    if (!name) return;
    await this.store.renameLane(lane, name, this.editingLaneColor);
    this.cdr.markForCheck();
  }

  cancelEditLane(): void {
    this.editingLaneId = null;
  }

  async removeLane(lane: KanbanLane, event: Event): Promise<void> {
    event.stopPropagation();
    if (!confirm(`Apagar a raia "${lane.name}"? As tarefas dela vão pra "Sem raia".`)) return;
    await this.store.deleteLane(lane);
    this.cdr.markForCheck();
  }

  onLaneDragStart(lane: KanbanLane, event: DragEvent): void {
    event.stopPropagation();
    this.draggingLaneId = lane.id;
    event.dataTransfer?.setData('text/plain', lane.id);
  }

  onLaneDragEnd(): void {
    this.draggingLaneId = null;
    this.dragOverLaneId = null;
  }

  onLaneDragOver(lane: KanbanLane, event: DragEvent): void {
    if (!this.draggingLaneId) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragOverLaneId = lane.id;
  }

  async onLaneDrop(lane: KanbanLane, event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.dragOverLaneId = null;
    const draggedId = this.draggingLaneId;
    this.draggingLaneId = null;
    if (!draggedId || draggedId === lane.id) return;
    const ids = this.store.lanesFor(this.projectId).map((l) => l.id);
    await this.store.reorderLanes(this.projectId, reorderIds(ids, draggedId, lane.id));
    this.cdr.markForCheck();
  }
}

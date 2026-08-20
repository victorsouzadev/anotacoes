import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../shared/icon';
import { TasksTopBarComponent } from '../components/tasks-top-bar.component';
import { TaskFormComponent, TaskFormResult } from '../components/task-form.component';
import { TaskDetailComponent } from '../components/task-detail.component';
import { CATEGORY_COLORS, KanbanLane, TaskItem } from '../models/task.model';
import { TasksStoreService } from '../services/tasks-store.service';
import { TasksFilterStateService } from '../services/tasks-filter-state.service';
import { NO_CATEGORY } from '../list/task-filters';
import { reorderIds } from './kanban-logic';

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
  selector: 'app-tasks-kanban-page',
  standalone: true,
  imports: [CommonModule, FormsModule, TasksTopBarComponent, IconComponent, TaskFormComponent, TaskDetailComponent],
  templateUrl: './tasks-kanban.page.html',
  styleUrl: './tasks-kanban.page.css',
})
export class TasksKanbanPageComponent implements OnInit {
  readonly colors = CATEGORY_COLORS;
  readonly NO_CATEGORY = NO_CATEGORY;

  groupBy: GroupBy = 'lanes';
  showCategoryFilter = false;

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

  constructor(
    public store: TasksStoreService,
    public filterState: TasksFilterStateService,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.store.reload();
    this.cdr.markForCheck();
  }

  columns(): KanbanColumn[] {
    if (this.groupBy === 'status') {
      return [
        { id: STATUS_TODO, name: 'A fazer', colorHex: null, lane: null },
        { id: STATUS_DONE, name: 'Concluída', colorHex: null, lane: null },
      ];
    }
    const lanes = this.store.kanbanLanes();
    return [
      { id: NO_LANE, name: 'Sem raia', colorHex: null, lane: null },
      ...lanes.map((l) => ({ id: l.id, name: l.name, colorHex: l.colorHex, lane: l })),
    ];
  }

  private columnOf(task: TaskItem): string | null {
    if (this.groupBy === 'status') return task.isCompleted ? STATUS_DONE : STATUS_TODO;
    return task.kanbanLaneId ?? NO_LANE;
  }

  tasksFor(columnId: string) {
    const ids = this.filterState.categoryFilterIds();
    const wantsNoCategory = ids.includes(NO_CATEGORY);
    const wantedIds = ids.filter((id) => id !== NO_CATEGORY);
    return this.store
      .activeTasks()
      .filter((t) => this.columnOf(t) === columnId)
      .filter(
        (t) =>
          ids.length === 0 ||
          (wantsNoCategory && t.categoryIds.length === 0) ||
          t.categoryIds.some((id) => wantedIds.includes(id)),
      )
      .sort((a, b) => a.position - b.position);
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

  // --- Abrir/editar tarefa ---

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
      this.showForm = true;
    }
  }

  closeForm(): void {
    this.showForm = false;
    this.formTask = null;
  }

  async onSave(result: TaskFormResult): Promise<void> {
    if (this.formTask) await this.store.updateTask(this.formTask, result);
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
    await this.store.reorder(reordered);
    this.cdr.markForCheck();
  }

  private async assignColumn(task: TaskItem, columnId: string): Promise<void> {
    if (this.columnOf(task) === columnId) return;
    if (this.groupBy === 'status') {
      await this.store.setCompleted(task, columnId === STATUS_DONE);
    } else {
      await this.store.setTaskLane(task, columnId === NO_LANE ? null : columnId);
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
    await this.store.reorder(targetColumnIds);
    this.cdr.markForCheck();
  }

  // --- Gestão das raias (criar / renomear / apagar / reordenar) ---

  async addLane(): Promise<void> {
    const name = this.newLaneName.trim();
    if (!name) return;
    await this.store.createLane(name, this.newLaneColor);
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
    const ids = this.store.kanbanLanes().map((l) => l.id);
    await this.store.reorderLanes(reorderIds(ids, draggedId, lane.id));
    this.cdr.markForCheck();
  }
}

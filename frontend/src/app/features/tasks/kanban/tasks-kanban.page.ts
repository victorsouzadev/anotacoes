import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { IconComponent } from '../../../shared/icon';
import { TasksTopBarComponent } from '../components/tasks-top-bar.component';
import { TaskCategory, TaskItem } from '../models/task.model';
import { TasksStoreService } from '../services/tasks-store.service';
import { reorderIds } from './kanban-logic';

type GroupBy = 'category' | 'status';

const STATUS_TODO = '__todo__';
const STATUS_DONE = '__done__';

interface KanbanColumn {
  id: string | null;
  name: string;
  colorHex: string | null;
}

@Component({
  selector: 'app-tasks-kanban-page',
  standalone: true,
  imports: [CommonModule, TasksTopBarComponent, IconComponent],
  templateUrl: './tasks-kanban.page.html',
  styleUrl: './tasks-kanban.page.css',
})
export class TasksKanbanPageComponent implements OnInit {
  groupBy: GroupBy = 'category';

  draggingId: string | null = null;
  dragOverColumn: string | null = null;
  dragOverTaskId: string | null = null;

  constructor(
    public store: TasksStoreService,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.store.reload();
    this.cdr.markForCheck();
  }

  columns(): KanbanColumn[] {
    if (this.groupBy === 'status') {
      return [
        { id: STATUS_TODO, name: 'A fazer', colorHex: null },
        { id: STATUS_DONE, name: 'Concluída', colorHex: null },
      ];
    }
    const categories: TaskCategory[] = this.store.categories();
    return [
      { id: null, name: 'Sem categoria', colorHex: null },
      ...categories.map((c) => ({ id: c.id, name: c.name, colorHex: c.colorHex })),
    ];
  }

  private columnOf(task: TaskItem): string | null {
    if (this.groupBy === 'status') return task.isCompleted ? STATUS_DONE : STATUS_TODO;
    return task.categoryId ?? null;
  }

  tasksFor(columnId: string | null): TaskItem[] {
    return this.store
      .activeTasks()
      .filter((t) => this.columnOf(t) === columnId)
      .sort((a, b) => a.position - b.position);
  }

  onDragStart(task: TaskItem, event: DragEvent): void {
    this.draggingId = task.id;
    event.dataTransfer?.setData('text/plain', task.id);
  }

  onDragEnd(): void {
    this.draggingId = null;
    this.dragOverColumn = null;
    this.dragOverTaskId = null;
  }

  onDragOverColumn(columnId: string | null, event: DragEvent): void {
    event.preventDefault();
    this.dragOverColumn = columnId ?? '__none__';
  }

  onDragOverCard(columnId: string | null, task: TaskItem, event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOverColumn = columnId ?? '__none__';
    this.dragOverTaskId = task.id;
  }

  async onDropColumn(columnId: string | null, event: DragEvent): Promise<void> {
    event.preventDefault();
    await this.drop(columnId, null);
  }

  async onDropCard(columnId: string | null, targetTask: TaskItem, event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    await this.drop(columnId, targetTask.id);
  }

  private async drop(columnId: string | null, targetTaskId: string | null): Promise<void> {
    this.dragOverColumn = null;
    this.dragOverTaskId = null;
    const id = this.draggingId;
    this.draggingId = null;
    if (!id) return;
    const task = this.store.activeTasks().find((t) => t.id === id);
    if (!task) return;

    const targetColumnIds = this.tasksFor(columnId).map((t) => t.id);
    const reordered = reorderIds(targetColumnIds, id, targetTaskId);

    const sameColumn = this.columnOf(task) === columnId;
    if (!sameColumn) {
      if (this.groupBy === 'status') {
        await this.store.setCompleted(task, columnId === STATUS_DONE);
      } else {
        await this.store.updateTask(task, { categoryId: columnId });
      }
    }
    await this.store.reorder(reordered);
    this.cdr.markForCheck();
  }

  isOverdue(task: TaskItem): boolean {
    return !!task.dueDate && !task.isCompleted && new Date(task.dueDate).getTime() < Date.now();
  }

  async toggleComplete(task: TaskItem, event: Event): Promise<void> {
    event.stopPropagation();
    await this.store.toggleComplete(task);
    this.cdr.markForCheck();
  }
}

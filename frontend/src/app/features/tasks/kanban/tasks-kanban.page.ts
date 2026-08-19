import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { IconComponent } from '../../../shared/icon';
import { TasksTopBarComponent } from '../components/tasks-top-bar.component';
import { TaskCategory, TaskItem } from '../models/task.model';
import { TasksStoreService } from '../services/tasks-store.service';

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
  draggingId: string | null = null;
  dragOverColumn: string | null = null;

  constructor(
    public store: TasksStoreService,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.store.reload();
    this.cdr.markForCheck();
  }

  columns(): KanbanColumn[] {
    const categories: TaskCategory[] = this.store.categories();
    return [
      { id: null, name: 'Sem categoria', colorHex: null },
      ...categories.map((c) => ({ id: c.id, name: c.name, colorHex: c.colorHex })),
    ];
  }

  tasksFor(columnId: string | null): TaskItem[] {
    return this.store
      .activeTasks()
      .filter((t) => !t.isCompleted && (t.categoryId ?? null) === columnId)
      .sort((a, b) => a.position - b.position);
  }

  onDragStart(task: TaskItem, event: DragEvent): void {
    this.draggingId = task.id;
    event.dataTransfer?.setData('text/plain', task.id);
  }

  onDragEnd(): void {
    this.draggingId = null;
    this.dragOverColumn = null;
  }

  onDragOverColumn(columnId: string | null, event: DragEvent): void {
    event.preventDefault();
    this.dragOverColumn = columnId ?? '__none__';
  }

  async onDropColumn(columnId: string | null, event: DragEvent): Promise<void> {
    event.preventDefault();
    this.dragOverColumn = null;
    const id = this.draggingId ?? event.dataTransfer?.getData('text/plain');
    this.draggingId = null;
    if (!id) return;
    const task = this.store.activeTasks().find((t) => t.id === id);
    if (!task || (task.categoryId ?? null) === columnId) return;
    await this.store.updateTask(task, { categoryId: columnId });
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

import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IconComponent } from '../../../shared/icon';
import { TasksTopBarComponent } from '../components/tasks-top-bar.component';
import { TaskFormComponent, TaskFormResult } from '../components/task-form.component';
import { TaskItem } from '../models/task.model';
import { TasksStoreService } from '../services/tasks-store.service';

type ViewFilter = 'all' | 'today' | 'overdue';
type SortMode = 'dueDate' | 'priority' | 'created';

const PRIORITY_WEIGHT: Record<TaskItem['priority'], number> = { High: 0, Medium: 1, Low: 2 };

@Component({
  selector: 'app-tasks-list-page',
  standalone: true,
  imports: [CommonModule, FormsModule, TasksTopBarComponent, IconComponent, TaskFormComponent],
  templateUrl: './tasks-list.page.html',
  styleUrl: './tasks-list.page.css',
})
export class TasksListPageComponent implements OnInit {
  viewFilter: ViewFilter = 'all';
  categoryFilter: string | null = null;
  sortMode: SortMode = 'dueDate';
  expandedId: string | null = null;

  showForm = false;
  formTask: TaskItem | null = null;

  constructor(
    public store: TasksStoreService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.store.reload();
    this.cdr.markForCheck();
  }

  visibleTasks(): TaskItem[] {
    let list = this.store.activeTasks();

    if (this.categoryFilter) list = list.filter((t) => t.categoryId === this.categoryFilter);

    if (this.viewFilter === 'today') {
      const today = new Date().toDateString();
      list = list.filter((t) => t.dueDate && new Date(t.dueDate).toDateString() === today && !t.isCompleted);
    } else if (this.viewFilter === 'overdue') {
      const now = Date.now();
      list = list.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < now && !t.isCompleted);
    }

    const sorted = [...list];
    switch (this.sortMode) {
      case 'dueDate':
        sorted.sort((a, b) => {
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return a.dueDate.localeCompare(b.dueDate);
        });
        break;
      case 'priority':
        sorted.sort((a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]);
        break;
      case 'created':
        sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        break;
    }
    return sorted;
  }

  isOverdue(task: TaskItem): boolean {
    return !!task.dueDate && !task.isCompleted && new Date(task.dueDate).getTime() < Date.now();
  }

  formatDueDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
      (d.getHours() || d.getMinutes() ? ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
  }

  subtaskProgress(task: TaskItem): string | null {
    if (task.subtasks.length === 0) return null;
    const done = task.subtasks.filter((s) => s.isCompleted).length;
    return `${done}/${task.subtasks.length}`;
  }

  toggleExpanded(task: TaskItem): void {
    this.expandedId = this.expandedId === task.id ? null : task.id;
  }

  async toggleComplete(task: TaskItem, event: Event): Promise<void> {
    event.stopPropagation();
    await this.store.toggleComplete(task);
    this.cdr.markForCheck();
  }

  async toggleSubtask(task: TaskItem, index: number, event: Event): Promise<void> {
    event.stopPropagation();
    await this.store.toggleSubtask(task, index);
    this.cdr.markForCheck();
  }

  openCreate(): void {
    this.formTask = null;
    this.showForm = true;
  }

  openEdit(task: TaskItem, event: Event): void {
    event.stopPropagation();
    this.formTask = task;
    this.showForm = true;
  }

  closeForm(): void {
    this.showForm = false;
    this.formTask = null;
  }

  async onSave(result: TaskFormResult): Promise<void> {
    if (this.formTask) {
      await this.store.updateTask(this.formTask, result);
    } else {
      await this.store.createTask(result);
    }
    this.closeForm();
    this.cdr.markForCheck();
  }

  async moveToTrash(task: TaskItem, event: Event): Promise<void> {
    event.stopPropagation();
    await this.store.moveToTrash(task);
    this.cdr.markForCheck();
  }

  startPomodoro(task: TaskItem, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/tasks/pomodoro'], { queryParams: { taskId: task.id } });
  }
}

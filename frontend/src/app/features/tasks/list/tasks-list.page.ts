import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IconComponent } from '../../../shared/icon';
import { TasksTopBarComponent } from '../components/tasks-top-bar.component';
import { TaskFormComponent, TaskFormResult } from '../components/task-form.component';
import { TaskDetailComponent } from '../components/task-detail.component';
import { TaskItem } from '../models/task.model';
import { TasksStoreService } from '../services/tasks-store.service';

type ViewFilter = 'all' | 'today' | 'overdue' | 'noDate';
type SortMode = 'dueDate' | 'priority' | 'created';
const NO_CATEGORY = '__none__';

const PRIORITY_WEIGHT: Record<TaskItem['priority'], number> = { High: 0, Medium: 1, Low: 2 };

@Component({
  selector: 'app-tasks-list-page',
  standalone: true,
  imports: [CommonModule, FormsModule, TasksTopBarComponent, IconComponent, TaskFormComponent, TaskDetailComponent],
  templateUrl: './tasks-list.page.html',
  styleUrl: './tasks-list.page.css',
})
export class TasksListPageComponent implements OnInit {
  readonly NO_CATEGORY = NO_CATEGORY;

  viewFilter: ViewFilter = 'all';
  categoryFilter: string | null = null;
  sortMode: SortMode = 'dueDate';
  expandedId: string | null = null;
  searchTerm = '';

  showForm = false;
  formTask: TaskItem | null = null;

  detailTask: TaskItem | null = null;

  selectionMode = false;
  selectedIds = new Set<string>();

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

    if (this.categoryFilter === NO_CATEGORY) list = list.filter((t) => !t.categoryId);
    else if (this.categoryFilter) list = list.filter((t) => t.categoryId === this.categoryFilter);

    if (this.viewFilter === 'today') {
      const today = new Date().toDateString();
      list = list.filter((t) => t.dueDate && new Date(t.dueDate).toDateString() === today && !t.isCompleted);
    } else if (this.viewFilter === 'overdue') {
      const now = Date.now();
      list = list.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < now && !t.isCompleted);
    } else if (this.viewFilter === 'noDate') {
      list = list.filter((t) => !t.dueDate);
    }

    const term = this.searchTerm.trim().toLowerCase();
    if (term) {
      list = list.filter(
        (t) => t.title.toLowerCase().includes(term) || (t.description ?? '').toLowerCase().includes(term),
      );
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
    if (this.selectionMode) {
      this.toggleSelected(task.id);
      return;
    }
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
    this.detailTask = null;
    this.formTask = task;
    this.showForm = true;
  }

  closeForm(): void {
    this.showForm = false;
    this.formTask = null;
  }

  openDetail(task: TaskItem, event: Event): void {
    event.stopPropagation();
    if (this.selectionMode) {
      this.toggleSelected(task.id);
      return;
    }
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

  async duplicateTask(task: TaskItem, event: Event): Promise<void> {
    event.stopPropagation();
    await this.store.duplicateTask(task);
    this.cdr.markForCheck();
  }

  startPomodoro(task: TaskItem, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/tasks/pomodoro'], { queryParams: { taskId: task.id } });
  }

  // --- Seleção / ações em massa ---

  toggleSelectionMode(): void {
    this.selectionMode = !this.selectionMode;
    this.selectedIds.clear();
    this.expandedId = null;
  }

  toggleSelected(id: string): void {
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
  }

  isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  selectAllVisible(): void {
    const visible = this.visibleTasks();
    const allSelected = visible.every((t) => this.selectedIds.has(t.id));
    if (allSelected) visible.forEach((t) => this.selectedIds.delete(t.id));
    else visible.forEach((t) => this.selectedIds.add(t.id));
  }

  private selectedTasks(): TaskItem[] {
    const byId = new Map(this.store.activeTasks().map((t) => [t.id, t]));
    return [...this.selectedIds].map((id) => byId.get(id)).filter((t): t is TaskItem => !!t);
  }

  async bulkComplete(isCompleted: boolean): Promise<void> {
    await this.store.bulkComplete(this.selectedTasks(), isCompleted);
    this.selectedIds.clear();
    this.cdr.markForCheck();
  }

  async bulkTrash(): Promise<void> {
    await this.store.bulkTrash(this.selectedTasks());
    this.selectedIds.clear();
    this.cdr.markForCheck();
  }

  async bulkSetCategory(categoryId: string): Promise<void> {
    await this.store.bulkSetCategory(this.selectedTasks(), categoryId || null);
    this.selectedIds.clear();
    this.cdr.markForCheck();
  }

  // --- Exportar / imprimir ---

  print(): void {
    window.print();
  }

  exportCsv(): void {
    const rows = [['Título', 'Descrição', 'Prazo', 'Prioridade', 'Categoria', 'Concluída']];
    for (const t of this.visibleTasks()) {
      rows.push([
        t.title,
        t.description ?? '',
        t.dueDate ? this.formatDueDate(t.dueDate) : '',
        t.priority,
        this.store.categoryFor(t)?.name ?? '',
        t.isCompleted ? 'Sim' : 'Não',
      ]);
    }
    const csv = rows.map((r) => r.map(csvEscape).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tarefas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

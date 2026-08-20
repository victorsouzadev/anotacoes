import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IconComponent } from '../../../shared/icon';
import { TasksTopBarComponent } from '../components/tasks-top-bar.component';
import { TaskFormComponent, TaskFormResult } from '../components/task-form.component';
import { TaskDetailComponent } from '../components/task-detail.component';
import { TaskItem } from '../models/task.model';
import { TasksStoreService, TaskStateSnapshot } from '../services/tasks-store.service';
import { TaskTemplate, TaskTemplatesService } from '../services/task-templates.service';
import { TaskNotificationsService } from '../services/task-notifications.service';
import { NO_CATEGORY, SortMode, ViewFilter, filterAndSortTasks, tasksToCsv } from './task-filters';

@Component({
  selector: 'app-tasks-list-page',
  standalone: true,
  imports: [CommonModule, FormsModule, TasksTopBarComponent, IconComponent, TaskFormComponent, TaskDetailComponent],
  templateUrl: './tasks-list.page.html',
  styleUrl: './tasks-list.page.css',
})
export class TasksListPageComponent implements OnInit, OnDestroy {
  readonly NO_CATEGORY = NO_CATEGORY;

  @ViewChild('searchInput') searchInputRef?: ElementRef<HTMLInputElement>;

  viewFilter: ViewFilter = 'all';
  categoryFilter: string | null = null;
  sortMode: SortMode = 'dueDate';
  expandedId: string | null = null;
  searchTerm = '';

  showForm = false;
  formTask: TaskItem | null = null;
  formTemplate: TaskTemplate | null = null;

  detailTask: TaskItem | null = null;

  selectionMode = false;
  selectedIds = new Set<string>();

  showTemplates = false;

  snackbarMessage: string | null = null;
  private pendingSnapshots: TaskStateSnapshot[] = [];
  private undoTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public store: TasksStoreService,
    public templatesService: TaskTemplatesService,
    public notifications: TaskNotificationsService,
    private router: Router,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.store.reload();
    this.notifications.start(() => this.store.activeTasks());
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    this.notifications.stop();
    if (this.undoTimer) clearTimeout(this.undoTimer);
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing = !!target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

    if (event.key === 'Escape') {
      if (this.showForm) this.closeForm();
      else if (this.detailTask) this.closeDetail();
      else if (this.showTemplates) this.showTemplates = false;
      return;
    }
    if (typing || event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === 'n' || event.key === 'N') {
      event.preventDefault();
      this.openCreate();
    } else if (event.key === '/') {
      event.preventDefault();
      this.searchInputRef?.nativeElement.focus();
    }
  }

  visibleTasks(): TaskItem[] {
    return filterAndSortTasks(this.store.activeTasks(), {
      categoryFilter: this.categoryFilter,
      viewFilter: this.viewFilter,
      searchTerm: this.searchTerm,
      sortMode: this.sortMode,
    });
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
    this.formTemplate = null;
    this.showForm = true;
  }

  openCreateFromTemplate(template: TaskTemplate): void {
    this.formTask = null;
    this.formTemplate = template;
    this.showForm = true;
    this.showTemplates = false;
  }

  removeTemplate(template: TaskTemplate, event: Event): void {
    event.stopPropagation();
    this.templatesService.remove(template.id);
  }

  async onSaveAsTemplate(result: TaskFormResult): Promise<void> {
    const name = window.prompt('Nome do modelo:', result.title);
    if (!name || !name.trim()) return;
    this.templatesService.save(name.trim(), result);
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
    this.formTemplate = null;
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
    const tasks = this.selectedTasks();
    if (tasks.length === 0) return;
    const snapshots = tasks.map((t) => this.store.snapshotState(t));
    await this.store.bulkComplete(tasks, isCompleted);
    this.selectedIds.clear();
    this.showUndo(`${tasks.length} tarefa(s) ${isCompleted ? 'concluída(s)' : 'reaberta(s)'}`, snapshots);
    this.cdr.markForCheck();
  }

  async bulkTrash(): Promise<void> {
    const tasks = this.selectedTasks();
    if (tasks.length === 0) return;
    const snapshots = tasks.map((t) => this.store.snapshotState(t));
    await this.store.bulkTrash(tasks);
    this.selectedIds.clear();
    this.showUndo(`${tasks.length} tarefa(s) movida(s) pra lixeira`, snapshots);
    this.cdr.markForCheck();
  }

  private showUndo(message: string, snapshots: TaskStateSnapshot[]): void {
    this.snackbarMessage = message;
    this.pendingSnapshots = snapshots;
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoTimer = setTimeout(() => {
      this.snackbarMessage = null;
      this.cdr.markForCheck();
    }, 8000);
  }

  async undoLastBulkAction(): Promise<void> {
    if (this.undoTimer) clearTimeout(this.undoTimer);
    const snapshots = this.pendingSnapshots;
    this.snackbarMessage = null;
    this.pendingSnapshots = [];
    await this.store.restoreState(snapshots);
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
    const csv = tasksToCsv(
      this.visibleTasks(),
      (t) => this.store.categoriesFor(t).map((c) => c.name).join(', '),
      (iso) => this.formatDueDate(iso),
    );
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tarefas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

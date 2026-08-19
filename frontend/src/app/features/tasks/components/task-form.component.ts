import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CATEGORY_COLORS, DecodedRecurrence, Priority, Subtask, TaskItem, decodeRecurrence, encodeRecurrence } from '../models/task.model';
import { TasksStoreService } from '../services/tasks-store.service';

export interface TaskFormResult {
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: Priority;
  categoryId: string | null;
  isRecurring: boolean;
  recurrenceRule: string | null;
  subtasks: Subtask[];
}

@Component({
  selector: 'app-task-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './task-form.component.html',
  styleUrl: './task-form.component.css',
})
export class TaskFormComponent implements OnChanges {
  @Input() task: TaskItem | null = null;
  @Output() save = new EventEmitter<TaskFormResult>();
  @Output() cancel = new EventEmitter<void>();

  title = '';
  description = '';
  dueDateLocal = ''; // valor de <input type="datetime-local">
  priority: Priority = 'Medium';
  categoryId: string | null = null;
  subtasks: Subtask[] = [];
  newSubtaskTitle = '';

  recurrenceKind: 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' = 'NONE';
  dailyInterval = 1;
  weeklyDays = new Set<string>();

  newCategoryName = '';
  newCategoryColor = CATEGORY_COLORS[0];
  showNewCategory = false;

  readonly colors = CATEGORY_COLORS;

  constructor(public store: TasksStoreService) {}

  ngOnChanges(): void {
    this.title = this.task?.title ?? '';
    this.description = this.task?.description ?? '';
    this.dueDateLocal = this.task?.dueDate ? toLocalInputValue(this.task.dueDate) : '';
    this.priority = this.task?.priority ?? 'Medium';
    this.categoryId = this.task?.categoryId ?? null;
    this.subtasks = this.task?.subtasks ? [...this.task.subtasks] : [];
    this.newSubtaskTitle = '';

    const decoded: DecodedRecurrence | null = this.task?.isRecurring
      ? decodeRecurrence(this.task.recurrenceRule)
      : null;
    this.recurrenceKind = decoded?.kind ?? 'NONE';
    this.dailyInterval = decoded?.intervalDays ?? 1;
    this.weeklyDays = new Set(decoded?.daysOfWeek ?? []);
  }

  toggleWeekday(day: string): void {
    if (this.weeklyDays.has(day)) this.weeklyDays.delete(day);
    else this.weeklyDays.add(day);
  }

  addSubtask(): void {
    const title = this.newSubtaskTitle.trim();
    if (!title) return;
    this.subtasks = [...this.subtasks, { title, isCompleted: false, position: this.subtasks.length }];
    this.newSubtaskTitle = '';
  }

  removeSubtask(index: number): void {
    this.subtasks = this.subtasks.filter((_, i) => i !== index).map((s, i) => ({ ...s, position: i }));
  }

  toggleSubtaskDraft(index: number): void {
    this.subtasks = this.subtasks.map((s, i) => (i === index ? { ...s, isCompleted: !s.isCompleted } : s));
  }

  async addCategory(): Promise<void> {
    const name = this.newCategoryName.trim();
    if (!name) return;
    const category = await this.store.createCategory(name, this.newCategoryColor);
    this.categoryId = category.id;
    this.newCategoryName = '';
    this.showNewCategory = false;
  }

  submit(): void {
    if (!this.title.trim()) return;
    let recurrenceRule: string | null = null;
    switch (this.recurrenceKind) {
      case 'DAILY':
        recurrenceRule = encodeRecurrence('DAILY', this.dailyInterval);
        break;
      case 'WEEKLY':
        recurrenceRule = encodeRecurrence('WEEKLY', [...this.weeklyDays].join(','));
        break;
      case 'MONTHLY':
        recurrenceRule = encodeRecurrence('MONTHLY');
        break;
    }
    const isRecurring = this.recurrenceKind !== 'NONE';

    this.save.emit({
      title: this.title,
      description: this.description.trim() || null,
      dueDate: this.dueDateLocal ? new Date(this.dueDateLocal).toISOString() : null,
      priority: this.priority,
      categoryId: this.categoryId,
      isRecurring: isRecurring && !!recurrenceRule,
      recurrenceRule,
      subtasks: this.subtasks,
    });
  }
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

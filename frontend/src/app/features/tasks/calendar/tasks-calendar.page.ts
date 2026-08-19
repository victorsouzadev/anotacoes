import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { IconComponent } from '../../../shared/icon';
import { TasksTopBarComponent } from '../components/tasks-top-bar.component';
import { TaskItem } from '../models/task.model';
import { TasksStoreService } from '../services/tasks-store.service';

interface CalendarDay {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  tasks: TaskItem[];
}

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MONTH_LABELS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

@Component({
  selector: 'app-tasks-calendar-page',
  standalone: true,
  imports: [CommonModule, TasksTopBarComponent, IconComponent],
  templateUrl: './tasks-calendar.page.html',
  styleUrl: './tasks-calendar.page.css',
})
export class TasksCalendarPageComponent implements OnInit {
  readonly weekdayLabels = WEEKDAY_LABELS;

  cursor = startOfMonth(new Date());
  selectedDay: Date | null = null;

  constructor(
    public store: TasksStoreService,
    private cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    await this.store.reload();
    this.cdr.markForCheck();
  }

  get monthLabel(): string {
    return `${MONTH_LABELS[this.cursor.getMonth()]} de ${this.cursor.getFullYear()}`;
  }

  prevMonth(): void {
    this.cursor = new Date(this.cursor.getFullYear(), this.cursor.getMonth() - 1, 1);
  }

  nextMonth(): void {
    this.cursor = new Date(this.cursor.getFullYear(), this.cursor.getMonth() + 1, 1);
  }

  goToday(): void {
    this.cursor = startOfMonth(new Date());
  }

  days(): CalendarDay[] {
    const tasks = this.store.activeTasks().filter((t) => t.dueDate);
    const firstOfMonth = new Date(this.cursor.getFullYear(), this.cursor.getMonth(), 1);
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - firstOfMonth.getDay());
    const today = new Date().toDateString();

    const result: CalendarDay[] = [];
    for (let i = 0; i < 42; i++) {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + i);
      const dayTasks = tasks.filter((t) => new Date(t.dueDate!).toDateString() === date.toDateString());
      dayTasks.sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
      result.push({
        date,
        inMonth: date.getMonth() === this.cursor.getMonth(),
        isToday: date.toDateString() === today,
        tasks: dayTasks,
      });
    }
    return result;
  }

  selectDay(day: CalendarDay): void {
    this.selectedDay = this.selectedDay?.toDateString() === day.date.toDateString() ? null : day.date;
  }

  formatSelectedDay(): string {
    if (!this.selectedDay) return '';
    return this.selectedDay.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  tasksForSelectedDay(): TaskItem[] {
    if (!this.selectedDay) return [];
    const key = this.selectedDay.toDateString();
    return this.store
      .activeTasks()
      .filter((t) => t.dueDate && new Date(t.dueDate).toDateString() === key)
      .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
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

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

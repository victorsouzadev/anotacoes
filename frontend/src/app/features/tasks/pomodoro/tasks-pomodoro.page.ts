import { FormsModule } from '@angular/forms';
import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TasksTopBarComponent } from '../components/tasks-top-bar.component';
import { TasksStoreService } from '../services/tasks-store.service';
import { PomodoroService } from '../services/pomodoro.service';
import { PomodoroTimerComponent } from './pomodoro-timer.component';

@Component({
  selector: 'app-tasks-pomodoro-page',
  standalone: true,
  imports: [FormsModule, TasksTopBarComponent, PomodoroTimerComponent],
  template: `
    <div class="page">
      <app-tasks-top-bar />
      <main class="content">
        <label class="task-picker">
          <span>Tarefa (opcional)</span>
          <select [ngModel]="pomodoro.selectedTaskId()" (ngModelChange)="pomodoro.setSelectedTask($event)">
            <option [ngValue]="null">Sem tarefa vinculada</option>
            @for (t of store.activeTasks(); track t.id) {
              <option [ngValue]="t.id">{{ t.title }}</option>
            }
          </select>
        </label>

        <app-pomodoro-timer />
      </main>
    </div>
  `,
  styles: [`
    .page { min-height: 100dvh; background: var(--bg); }
    .content { max-width: 480px; margin: 0 auto; padding: 24px 28px; display: flex; flex-direction: column; gap: 20px; align-items: stretch; }
    .task-picker { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text-muted); }
    .task-picker select { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; background: var(--surface); color: var(--text); font-size: 14px; }

    @media (max-width: 480px) {
      .content { padding: 16px; }
    }
  `],
})
export class TasksPomodoroPageComponent implements OnInit {
  constructor(
    public store: TasksStoreService,
    public pomodoro: PomodoroService,
    private route: ActivatedRoute,
  ) {}

  async ngOnInit(): Promise<void> {
    if (this.store.tasks().length === 0) await this.store.reload();
    const taskId = this.route.snapshot.queryParamMap.get('taskId');
    if (taskId) this.pomodoro.setSelectedTask(taskId);
  }
}

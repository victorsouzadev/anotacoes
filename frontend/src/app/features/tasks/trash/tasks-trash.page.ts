import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { IconComponent } from '../../../shared/icon';
import { TasksTopBarComponent } from '../components/tasks-top-bar.component';
import { TaskItem } from '../models/task.model';
import { TasksStoreService } from '../services/tasks-store.service';

@Component({
  selector: 'app-tasks-trash-page',
  standalone: true,
  imports: [TasksTopBarComponent, IconComponent],
  template: `
    <div class="page">
      <app-tasks-top-bar />
      <main class="content">
        <h2>Lixeira</h2>
        @if (store.loading()) {
          <p class="empty">Carregando…</p>
        } @else if (store.trashedTasks().length === 0) {
          <p class="empty">A lixeira está vazia.</p>
        } @else {
          <div class="list">
            @for (task of store.trashedTasks(); track task.id) {
              <div class="row">
                <div class="info">
                  <span class="title">{{ task.title }}</span>
                  <span class="meta">excluída em {{ formatDate(task.deletedAt!) }}</span>
                </div>
                <div class="actions">
                  <button (click)="restore(task)"><app-icon name="undo" [size]="14" /> Restaurar</button>
                  <button class="danger" (click)="deleteForever(task)"><app-icon name="delete" [size]="14" /> Excluir para sempre</button>
                </div>
              </div>
            }
          </div>
        }
      </main>
    </div>
  `,
  styles: [`
    .page { min-height: 100dvh; background: var(--bg); }
    .content { max-width: 700px; margin: 0 auto; padding: 24px 28px; }
    h2 { font-size: 16px; margin: 0 0 16px; }
    .empty { color: var(--text-muted); text-align: center; padding: 40px 0; }
    .list { display: flex; flex-direction: column; gap: 8px; }
    .row {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 12px 14px;
    }
    .info { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .title { font-size: 14px; font-weight: 500; text-decoration: line-through; color: var(--text-muted); }
    .meta { font-size: 11px; color: var(--text-muted); }
    .actions { display: flex; gap: 8px; flex-shrink: 0; }
    .actions button {
      display: flex; align-items: center; gap: 5px;
      border: 1px solid var(--border); background: var(--bg); color: var(--text);
      border-radius: var(--radius-sm); padding: 6px 10px; font-size: 12px; font-weight: 600;
    }
    .actions button:hover { border-color: var(--accent); color: var(--accent); }
    .actions button.danger:hover { border-color: var(--danger); color: var(--danger); }
    @media (max-width: 600px) {
      .content { padding: 16px; }
      .row { flex-direction: column; align-items: stretch; }
    }
  `],
})
export class TasksTrashPageComponent implements OnInit {
  constructor(public store: TasksStoreService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    if (this.store.tasks().length === 0) await this.store.reload();
    this.cdr.markForCheck();
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  async restore(task: TaskItem): Promise<void> {
    await this.store.restore(task);
    this.cdr.markForCheck();
  }

  async deleteForever(task: TaskItem): Promise<void> {
    if (!confirm(`Excluir "${task.title}" permanentemente? Esta ação não pode ser desfeita.`)) return;
    await this.store.deleteForever(task);
    this.cdr.markForCheck();
  }
}

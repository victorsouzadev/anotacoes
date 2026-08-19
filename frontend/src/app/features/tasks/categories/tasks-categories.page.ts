import { FormsModule } from '@angular/forms';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { IconComponent } from '../../../shared/icon';
import { TasksTopBarComponent } from '../components/tasks-top-bar.component';
import { CATEGORY_COLORS, TaskCategory } from '../models/task.model';
import { TasksStoreService } from '../services/tasks-store.service';

@Component({
  selector: 'app-tasks-categories-page',
  standalone: true,
  imports: [FormsModule, TasksTopBarComponent, IconComponent],
  template: `
    <div class="page">
      <app-tasks-top-bar />
      <main class="content">
        <h2>Categorias</h2>

        <div class="new-row">
          <input [(ngModel)]="newName" placeholder="Nova categoria" (keydown.enter)="create()" />
          <div class="color-picker">
            @for (color of colors; track color) {
              <button
                type="button"
                class="color-dot"
                [class.selected]="newColor === color"
                [style.background]="color"
                (click)="newColor = color"
              ></button>
            }
          </div>
          <button class="primary" (click)="create()">Criar</button>
        </div>

        @if (store.loading()) {
          <p class="empty">Carregando…</p>
        } @else if (store.categories().length === 0) {
          <p class="empty">Nenhuma categoria ainda.</p>
        } @else {
          <div class="list">
            @for (c of store.categories(); track c.id) {
              <div class="row">
                @if (editingId === c.id) {
                  <input class="name-input" [(ngModel)]="editingName" (keydown.enter)="commitRename(c)" (blur)="commitRename(c)" />
                  <div class="color-picker">
                    @for (color of colors; track color) {
                      <button
                        type="button"
                        class="color-dot"
                        [class.selected]="editingColor === color"
                        [style.background]="color"
                        (click)="editingColor = color"
                      ></button>
                    }
                  </div>
                } @else {
                  <span class="dot" [style.background]="c.colorHex"></span>
                  <span class="name">{{ c.name }}</span>
                  <span class="count">{{ taskCount(c) }} tarefa(s)</span>
                }
                <div class="actions">
                  @if (editingId === c.id) {
                    <button (click)="commitRename(c)"><app-icon name="check" [size]="14" /></button>
                  } @else {
                    <button (click)="startEdit(c)"><app-icon name="edit" [size]="14" /></button>
                  }
                  <button class="danger" (click)="remove(c)"><app-icon name="delete" [size]="14" /></button>
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
    .content { max-width: 600px; margin: 0 auto; padding: 24px 28px; }
    h2 { font-size: 16px; margin: 0 0 16px; }
    .empty { color: var(--text-muted); text-align: center; padding: 40px 0; }
    .new-row {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 12px; margin-bottom: 20px;
    }
    .new-row input { flex: 1; min-width: 140px; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; background: var(--bg); color: var(--text); font-size: 13px; }
    .color-picker { display: flex; gap: 5px; }
    .color-dot { width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent; }
    .color-dot.selected { border-color: var(--text); }
    .primary { border: none; background: var(--accent); color: #fff; border-radius: var(--radius-sm); padding: 8px 16px; font-size: 13px; font-weight: 600; }
    .primary:hover { background: var(--accent-dark); }
    .list { display: flex; flex-direction: column; gap: 8px; }
    .row {
      display: flex; align-items: center; gap: 10px;
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 10px 14px;
    }
    .dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
    .name { font-size: 14px; font-weight: 500; }
    .name-input { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 5px 8px; background: var(--bg); color: var(--text); font-size: 13px; }
    .count { font-size: 12px; color: var(--text-muted); margin-left: auto; }
    .actions { display: flex; gap: 2px; margin-left: 8px; }
    .actions button { border: none; background: none; padding: 6px; border-radius: 6px; color: var(--text-muted); display: flex; }
    .actions button:hover { background: var(--bg); color: var(--text); }
    .actions button.danger:hover { color: var(--danger); }
  `],
})
export class TasksCategoriesPageComponent implements OnInit {
  readonly colors = CATEGORY_COLORS;
  newName = '';
  newColor = CATEGORY_COLORS[0];
  editingId: string | null = null;
  editingName = '';
  editingColor = CATEGORY_COLORS[0];

  constructor(public store: TasksStoreService, private cdr: ChangeDetectorRef) {}

  async ngOnInit(): Promise<void> {
    if (this.store.tasks().length === 0) await this.store.reload();
    this.cdr.markForCheck();
  }

  taskCount(category: TaskCategory): number {
    return this.store.activeTasks().filter((t) => t.categoryId === category.id).length;
  }

  async create(): Promise<void> {
    const name = this.newName.trim();
    if (!name) return;
    await this.store.createCategory(name, this.newColor);
    this.newName = '';
    this.cdr.markForCheck();
  }

  startEdit(category: TaskCategory): void {
    this.editingId = category.id;
    this.editingName = category.name;
    this.editingColor = category.colorHex;
  }

  async commitRename(category: TaskCategory): Promise<void> {
    if (this.editingId !== category.id) return;
    this.editingId = null;
    const name = this.editingName.trim();
    if (!name) return;
    await this.store.renameCategory(category, name, this.editingColor);
    this.cdr.markForCheck();
  }

  async remove(category: TaskCategory): Promise<void> {
    if (!confirm(`Excluir a categoria "${category.name}"? As tarefas dela ficam sem categoria.`)) return;
    await this.store.deleteCategory(category);
    this.cdr.markForCheck();
  }
}

import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { KanbanLane, Subtask, TaskAttachment, TaskCategory, TaskComment, TaskItem, TaskItemWire } from '../models/task.model';

function toView(wire: TaskItemWire): TaskItem {
  let subtasks: Subtask[] = [];
  try {
    subtasks = JSON.parse(wire.subtasks) as Subtask[];
  } catch {
    subtasks = [];
  }
  return { ...wire, subtasks };
}

export interface TaskUpsertInput {
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: TaskItem['priority'];
  categoryId: string | null;
  kanbanLaneId: string | null;
  isRecurring: boolean;
  recurrenceRule: string | null;
  isCompleted: boolean;
  createdAt: string;
  completedAt: string | null;
  deletedAt: string | null;
  completedPomodoros: number;
  position: number;
  locationLat: number | null;
  locationLng: number | null;
  locationRadiusMeters: number | null;
  locationLabel: string | null;
  subtasks: Subtask[];
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class TasksService {
  constructor(private http: HttpClient) {}

  listCategories(): Promise<TaskCategory[]> {
    return firstValueFrom(this.http.get<TaskCategory[]>('/api/tasks/categories'));
  }

  upsertCategory(id: string, name: string, colorHex: string, updatedAt: string): Promise<TaskCategory> {
    return firstValueFrom(
      this.http.put<TaskCategory>(`/api/tasks/categories/${id}`, { name, colorHex, updatedAt }),
    );
  }

  deleteCategory(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/tasks/categories/${id}`));
  }

  listKanbanLanes(): Promise<KanbanLane[]> {
    return firstValueFrom(this.http.get<KanbanLane[]>('/api/tasks/kanban-lanes'));
  }

  upsertKanbanLane(id: string, name: string, colorHex: string, position: number, updatedAt: string): Promise<KanbanLane> {
    return firstValueFrom(
      this.http.put<KanbanLane>(`/api/tasks/kanban-lanes/${id}`, { name, colorHex, position, updatedAt }),
    );
  }

  deleteKanbanLane(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/tasks/kanban-lanes/${id}`));
  }

  async listTasks(): Promise<TaskItem[]> {
    const wire = await firstValueFrom(this.http.get<TaskItemWire[]>('/api/tasks/items'));
    return wire.map(toView);
  }

  async upsertTask(id: string, input: TaskUpsertInput): Promise<TaskItem> {
    const body = { ...input, subtasks: JSON.stringify(input.subtasks) };
    const wire = await firstValueFrom(this.http.put<TaskItemWire>(`/api/tasks/items/${id}`, body));
    return toView(wire);
  }

  deleteTaskForever(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/tasks/items/${id}`));
  }

  listComments(taskId: string): Promise<TaskComment[]> {
    return firstValueFrom(this.http.get<TaskComment[]>(`/api/tasks/items/${taskId}/comments`));
  }

  addComment(taskId: string, text: string): Promise<TaskComment> {
    return firstValueFrom(this.http.post<TaskComment>(`/api/tasks/items/${taskId}/comments`, { text }));
  }

  deleteComment(taskId: string, commentId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/tasks/items/${taskId}/comments/${commentId}`));
  }

  listAttachments(taskId: string): Promise<TaskAttachment[]> {
    return firstValueFrom(this.http.get<TaskAttachment[]>(`/api/tasks/items/${taskId}/attachments`));
  }

  addAttachment(taskId: string, fileName: string, contentType: string, dataBase64: string): Promise<TaskAttachment> {
    return firstValueFrom(
      this.http.post<TaskAttachment>(`/api/tasks/items/${taskId}/attachments`, { fileName, contentType, dataBase64 }),
    );
  }

  deleteAttachment(taskId: string, attachmentId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/tasks/items/${taskId}/attachments/${attachmentId}`));
  }

  downloadAttachment(taskId: string, attachmentId: string): Promise<Blob> {
    return firstValueFrom(
      this.http.get(`/api/tasks/items/${taskId}/attachments/${attachmentId}/content`, { responseType: 'blob' }),
    );
  }
}

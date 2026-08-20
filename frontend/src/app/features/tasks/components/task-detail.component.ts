import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnChanges, OnDestroy, OnInit, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../shared/icon';
import { activityDurationSeconds, decodeRecurrence, formatDuration, totalTimeSpent } from '../models/task.model';
import { TaskActivity, TaskAttachment, TaskComment, TaskItem } from '../models/task.model';
import { TasksStoreService } from '../services/tasks-store.service';
import { TaskActivitiesService } from '../services/task-activities.service';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function isImage(attachment: TaskAttachment): boolean {
  return attachment.contentType.startsWith('image/');
}

@Component({
  selector: 'app-task-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: './task-detail.component.html',
  styleUrl: './task-detail.component.css',
})
export class TaskDetailComponent implements OnChanges, OnInit, OnDestroy {
  @Input({ required: true }) task!: TaskItem;
  @Output() close = new EventEmitter<void>();
  @Output() edit = new EventEmitter<void>();

  comments: TaskComment[] = [];
  newCommentText = '';
  loadingComments = true;

  attachments: TaskAttachment[] = [];
  loadingAttachments = true;
  attachmentError = '';

  imagePreviews = new Map<string, string>();

  readonly formatDuration = formatDuration;

  /** Só serve pra forçar recomputo do tempo decorrido da atividade em andamento a cada segundo. */
  private nowTick = signal(Date.now());
  private tickInterval?: ReturnType<typeof setInterval>;

  constructor(public store: TasksStoreService, public activitiesService: TaskActivitiesService) {}

  ngOnInit(): void {
    this.tickInterval = setInterval(() => this.nowTick.set(Date.now()), 1000);
  }

  ngOnChanges(): void {
    this.comments = [];
    this.revokePreviews();
    this.attachments = [];
    this.attachmentError = '';
    this.loadComments();
    this.loadAttachments();
  }

  ngOnDestroy(): void {
    this.revokePreviews();
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  runningActivityForTask(): TaskActivity | null {
    const running = this.activitiesService.running();
    return running && running.taskId === this.task.id ? running : null;
  }

  finishedActivitiesForTask(): TaskActivity[] {
    return this.activitiesService.finished().filter((a) => a.taskId === this.task.id);
  }

  activityTimeSpentLabel(): string | null {
    const finished = this.finishedActivitiesForTask();
    if (finished.length === 0) return null;
    return formatDuration(finished.reduce((sum, a) => sum + activityDurationSeconds(a), 0));
  }

  activityElapsedLabel(activity: TaskActivity): string {
    this.nowTick();
    return formatDuration(activityDurationSeconds(activity));
  }

  durationOf(activity: TaskActivity): number {
    return activityDurationSeconds(activity);
  }

  startActivity(): void {
    this.activitiesService.start(this.task.title, this.task.id);
  }

  finishActivity(): void {
    const running = this.runningActivityForTask();
    if (running) this.activitiesService.finish(running.id);
  }

  private revokePreviews(): void {
    for (const url of this.imagePreviews.values()) URL.revokeObjectURL(url);
    this.imagePreviews = new Map();
  }

  isImage(attachment: TaskAttachment): boolean {
    return isImage(attachment);
  }

  imagePreviewUrl(attachment: TaskAttachment): string | null {
    return this.imagePreviews.get(attachment.id) ?? null;
  }

  private async loadImagePreview(attachment: TaskAttachment): Promise<void> {
    const blob = await this.store.downloadAttachment(this.task.id, attachment.id);
    const url = URL.createObjectURL(blob);
    this.imagePreviews.set(attachment.id, url);
  }

  timeSpentLabel(): string | null {
    if (this.task.completedPomodoros === 0) return null;
    return formatDuration(totalTimeSpent(this.task.completedPomodoros));
  }

  private async loadComments(): Promise<void> {
    this.loadingComments = true;
    try {
      this.comments = await this.store.listComments(this.task.id);
    } finally {
      this.loadingComments = false;
    }
  }

  private async loadAttachments(): Promise<void> {
    this.loadingAttachments = true;
    try {
      this.attachments = await this.store.listAttachments(this.task.id);
      await Promise.all(this.attachments.filter(isImage).map((a) => this.loadImagePreview(a)));
    } finally {
      this.loadingAttachments = false;
    }
  }

  recurrenceLabel(): string | null {
    const decoded = this.task.isRecurring ? decodeRecurrence(this.task.recurrenceRule) : null;
    if (!decoded) return null;
    if (decoded.kind === 'DAILY') return `A cada ${decoded.intervalDays ?? 1} dia(s)`;
    if (decoded.kind === 'WEEKLY') return `Semanalmente (${(decoded.daysOfWeek ?? []).join(', ') || '—'})`;
    return 'Mensalmente';
  }

  async toggleSubtask(index: number): Promise<void> {
    await this.store.toggleSubtask(this.task, index);
  }

  async addComment(): Promise<void> {
    const text = this.newCommentText.trim();
    if (!text) return;
    const comment = await this.store.addComment(this.task.id, text);
    this.comments = [...this.comments, comment];
    this.newCommentText = '';
  }

  async removeComment(comment: TaskComment): Promise<void> {
    await this.store.deleteComment(this.task.id, comment.id);
    this.comments = this.comments.filter((c) => c.id !== comment.id);
  }

  async onAttachmentSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.attachmentError = '';
    if (file.size > MAX_ATTACHMENT_BYTES) {
      this.attachmentError = 'Arquivo deve ter até 5MB.';
      return;
    }
    const dataBase64 = await fileToBase64(file);
    const attachment = await this.store.addAttachment(this.task.id, file.name, file.type, dataBase64);
    this.attachments = [...this.attachments, attachment];
    if (isImage(attachment)) await this.loadImagePreview(attachment);
  }

  async removeAttachment(attachment: TaskAttachment): Promise<void> {
    await this.store.deleteAttachment(this.task.id, attachment.id);
    this.attachments = this.attachments.filter((a) => a.id !== attachment.id);
    const preview = this.imagePreviews.get(attachment.id);
    if (preview) {
      URL.revokeObjectURL(preview);
      this.imagePreviews.delete(attachment.id);
    }
  }

  async downloadAttachment(attachment: TaskAttachment): Promise<void> {
    const blob = await this.store.downloadAttachment(this.task.id, attachment.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = attachment.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }

  formatBytes(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  formatDateTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
      ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

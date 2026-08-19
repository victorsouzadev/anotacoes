import { Component } from '@angular/core';
import { TasksTopBarComponent } from '../components/tasks-top-bar.component';

@Component({
  selector: 'app-tasks-help-page',
  standalone: true,
  imports: [TasksTopBarComponent],
  templateUrl: './tasks-help.page.html',
  styleUrl: './tasks-help.page.css',
})
export class TasksHelpPageComponent {}

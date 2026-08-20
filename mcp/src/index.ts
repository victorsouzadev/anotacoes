#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as api from './tasksApi.js';
import type { TaskItem } from './tasksApi.js';
import { normalizePriority } from './priority.js';
import { findCategoryByName, findLaneByName, findTaskMatch } from './taskMatch.js';
import { searchTasks } from './taskSearch.js';

// `fetch` global só existe a partir do Node 18. Sem essa checagem, a primeira tool chamada falha
// com "fetch is not defined" — mensagem que não indica a causa real (Node do cliente MCP é antigo).
if (typeof fetch === 'undefined') {
  console.error(
    `[anotacoes-tasks] Node ${process.version} não tem fetch global (precisa de Node 18+). ` +
      'Aponte o "command" do servidor MCP (claude_desktop_config.json ou equivalente) para um ' +
      'Node 18 ou mais recente e reinicie o cliente MCP.',
  );
  process.exit(1);
}

const server = new McpServer({
  name: 'anotacoes-tasks',
  version: '2.2.0',
});

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function errorText(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: message }], isError: true as const };
}

// Toda tool passa por aqui — garante que uma falha (rede, HTTP, validação) volta como
// resultado de erro do MCP em vez de derrubar o processo do servidor.
function safe<Args extends unknown[]>(handler: (...args: Args) => Promise<ReturnType<typeof text>>) {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      return errorText(err);
    }
  };
}

function summarize(t: TaskItem) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    dueDate: t.dueDate,
    priority: t.priority,
    categoryIds: t.categoryIds,
    kanbanLaneId: t.kanbanLaneId,
    isCompleted: t.isCompleted,
    isRecurring: t.isRecurring,
    deletedAt: t.deletedAt,
  };
}

// Aceita uma ou várias categorias separadas por vírgula, criando automaticamente as que ainda
// não existem — mesma resolução de nome-ou-cria usada para raia do Kanban.
async function resolveCategoryIds(categoryNames: string | undefined): Promise<string[]> {
  const names = (categoryNames ?? '').split(',').map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return [];
  const categories = await api.listCategories();
  const ids: string[] = [];
  for (const name of names) {
    const existing = findCategoryByName(categories, name);
    if (existing) {
      ids.push(existing.id);
    } else {
      const created = await api.createCategory(name);
      categories.push(created);
      ids.push(created.id);
    }
  }
  return [...new Set(ids)];
}

async function resolveLaneId(laneName: string | undefined): Promise<string | null> {
  if (!laneName?.trim()) return null;
  const trimmed = laneName.trim();
  const lanes = await api.listKanbanLanes();
  const existing = findLaneByName(lanes, trimmed);
  if (existing) return existing.id;
  const created = await api.createKanbanLane(trimmed);
  return created.id;
}

server.tool(
  'add_task',
  'Cria uma nova tarefa no hub pessoal (ferramenta Tarefas). Use para anotar algo que o usuário pediu para lembrar ou fazer.',
  {
    title: z.string().min(1).max(300).describe('Título curto da tarefa.'),
    description: z.string().max(5000).optional().describe('Detalhes adicionais, opcional.'),
    dueDate: z
      .string()
      .datetime()
      .optional()
      .describe('Prazo/data de vencimento em ISO 8601 UTC (ex.: 2026-08-20T18:00:00.000Z), opcional.'),
    priority: z
      .string()
      .optional()
      .describe('Prioridade: low/medium/high ou baixa/média/alta. Padrão: media.'),
    categories: z.string().max(300).optional().describe('Uma ou mais categorias, separadas por vírgula. Criadas automaticamente se não existirem.'),
  },
  safe(async ({ title, description, dueDate, priority, categories }) => {
    const categoryIds = await resolveCategoryIds(categories);
    const task = await api.createTask({
      title,
      description: description ?? null,
      dueDate: dueDate ?? null,
      priority: normalizePriority(priority),
      categoryIds,
    });
    return text({ created: true, task: summarize(task) });
  }),
);

server.tool(
  'list_tasks',
  'Lista as tarefas do usuário. Por padrão retorna só as pendentes (não concluídas, não excluídas).',
  {
    includeCompleted: z.boolean().optional().describe('Inclui tarefas já concluídas. Padrão: false.'),
    includeDeleted: z.boolean().optional().describe('Inclui tarefas na lixeira. Padrão: false.'),
  },
  safe(async ({ includeCompleted, includeDeleted }) => {
    const all = await api.listTasks();
    const filtered = all.filter(
      (t) => (includeDeleted || !t.deletedAt) && (includeCompleted || !t.isCompleted),
    );
    return text(filtered.map(summarize));
  }),
);

server.tool(
  'search_tasks',
  'Busca tarefas por texto (título/descrição) e/ou filtros de categoria, prioridade e prazo. Mais flexível que list_tasks para perguntas como "o que vence essa semana" ou "tarefas urgentes de trabalho".',
  {
    query: z.string().max(200).optional().describe('Texto buscado em título e descrição.'),
    category: z.string().max(100).optional().describe('Nome exato de uma categoria existente.'),
    priority: z.string().optional().describe('Prioridade: low/medium/high ou baixa/média/alta.'),
    dueBefore: z.string().datetime().optional().describe('Só tarefas com prazo antes deste ISO 8601 UTC.'),
    dueAfter: z.string().datetime().optional().describe('Só tarefas com prazo depois deste ISO 8601 UTC.'),
    includeCompleted: z.boolean().optional().describe('Inclui tarefas já concluídas. Padrão: false.'),
    includeDeleted: z.boolean().optional().describe('Inclui tarefas na lixeira. Padrão: false.'),
  },
  safe(async ({ query, category, priority, dueBefore, dueAfter, includeCompleted, includeDeleted }) => {
    const [tasks, categories] = await Promise.all([api.listTasks(), api.listCategories()]);
    const result = searchTasks(tasks, categories, {
      query,
      categoryName: category,
      priority: priority ? normalizePriority(priority) : undefined,
      dueBefore,
      dueAfter,
      includeCompleted,
      includeDeleted,
    });
    return text(result.map(summarize));
  }),
);

server.tool(
  'get_task',
  'Retorna os detalhes completos de uma tarefa (incluindo subtarefas e comentários), pelo id ou por um trecho do título.',
  {
    idOrTitle: z.string().min(1).describe('Id exato da tarefa, ou trecho do título para buscar.'),
  },
  safe(async ({ idOrTitle }) => {
    const all = await api.listTasks();
    const match = findTaskMatch(all, idOrTitle, (t) => !t.deletedAt);
    if (!match.task) return text({ found: false, error: match.error, candidates: match.candidates });

    const comments = await api.listComments(match.task.id);
    let subtasks: unknown = [];
    try {
      subtasks = JSON.parse(match.task.subtasks);
    } catch {
      subtasks = [];
    }
    return text({ found: true, task: { ...summarize(match.task), subtasks }, comments });
  }),
);

server.tool(
  'list_categories',
  'Lista as categorias de tarefas existentes do usuário.',
  {},
  safe(async () => text(await api.listCategories())),
);

server.tool(
  'rename_category',
  'Renomeia uma categoria de tarefas existente.',
  {
    name: z.string().min(1).max(100).describe('Nome atual da categoria.'),
    newName: z.string().min(1).max(100).describe('Novo nome.'),
  },
  safe(async ({ name, newName }) => {
    const categories = await api.listCategories();
    const category = findCategoryByName(categories, name);
    if (!category) return text({ renamed: false, error: `Categoria "${name}" não encontrada.` });
    const updated = await api.renameCategory(category, newName);
    return text({ renamed: true, category: updated });
  }),
);

server.tool(
  'delete_category',
  'Apaga uma categoria de tarefas. As tarefas que estavam nela ficam sem categoria (não são apagadas).',
  {
    name: z.string().min(1).max(100).describe('Nome da categoria a apagar.'),
  },
  safe(async ({ name }) => {
    const categories = await api.listCategories();
    const category = findCategoryByName(categories, name);
    if (!category) return text({ deleted: false, error: `Categoria "${name}" não encontrada.` });
    await api.deleteCategory(category.id);
    return text({ deleted: true, name });
  }),
);

server.tool(
  'list_kanban_lanes',
  'Lista as raias (colunas) do quadro Kanban do usuário, em ordem. Raia é independente de categoria — é a organização própria do board Kanban.',
  {},
  safe(async () => text(await api.listKanbanLanes())),
);

server.tool(
  'add_kanban_lane',
  'Cria uma nova raia (coluna) no Kanban, no fim da ordem atual.',
  {
    name: z.string().min(1).max(100).describe('Nome da raia (ex.: "A fazer", "Em andamento", "Feito").'),
  },
  safe(async ({ name }) => {
    const lane = await api.createKanbanLane(name);
    return text({ created: true, lane });
  }),
);

server.tool(
  'rename_kanban_lane',
  'Renomeia uma raia do Kanban existente.',
  {
    name: z.string().min(1).max(100).describe('Nome atual da raia.'),
    newName: z.string().min(1).max(100).describe('Novo nome.'),
  },
  safe(async ({ name, newName }) => {
    const lanes = await api.listKanbanLanes();
    const lane = findLaneByName(lanes, name);
    if (!lane) return text({ renamed: false, error: `Raia "${name}" não encontrada.` });
    const updated = await api.renameKanbanLane(lane, newName);
    return text({ renamed: true, lane: updated });
  }),
);

server.tool(
  'delete_kanban_lane',
  'Apaga uma raia do Kanban. As tarefas que estavam nela ficam sem raia (não são apagadas).',
  {
    name: z.string().min(1).max(100).describe('Nome da raia a apagar.'),
  },
  safe(async ({ name }) => {
    const lanes = await api.listKanbanLanes();
    const lane = findLaneByName(lanes, name);
    if (!lane) return text({ deleted: false, error: `Raia "${name}" não encontrada.` });
    await api.deleteKanbanLane(lane.id);
    return text({ deleted: true, name });
  }),
);

server.tool(
  'move_task_to_lane',
  'Move uma tarefa pra uma raia do Kanban (criada automaticamente se não existir), pelo id ou por um trecho do título.',
  {
    idOrTitle: z.string().min(1).describe('Id exato da tarefa, ou trecho do título para buscar.'),
    lane: z.string().max(100).optional().describe('Nome da raia de destino. Se omitido, a tarefa fica sem raia.'),
  },
  safe(async ({ idOrTitle, lane }) => {
    const all = await api.listTasks();
    const match = findTaskMatch(all, idOrTitle, (t) => !t.deletedAt);
    if (!match.task) return text({ moved: false, error: match.error, candidates: match.candidates });

    const kanbanLaneId = await resolveLaneId(lane);
    const updated = await api.updateTask(match.task, { kanbanLaneId });
    return text({ moved: true, task: summarize(updated) });
  }),
);

server.tool(
  'complete_task',
  'Marca uma tarefa como concluída, pelo id ou por um trecho do título (busca aproximada entre as pendentes).',
  {
    idOrTitle: z.string().min(1).describe('Id exato da tarefa, ou trecho do título para buscar entre as pendentes.'),
  },
  safe(async ({ idOrTitle }) => {
    const all = await api.listTasks();
    const match = findTaskMatch(all, idOrTitle, (t) => !t.deletedAt && !t.isCompleted);
    if (!match.task) return text({ completed: false, error: match.error, candidates: match.candidates });

    const updated = await api.updateTask(match.task, {
      isCompleted: true,
      completedAt: new Date().toISOString(),
    });
    return text({ completed: true, task: summarize(updated) });
  }),
);

server.tool(
  'reopen_task',
  'Reabre uma tarefa já concluída (desfaz complete_task), pelo id ou por um trecho do título.',
  {
    idOrTitle: z.string().min(1).describe('Id exato da tarefa, ou trecho do título para buscar entre as concluídas.'),
  },
  safe(async ({ idOrTitle }) => {
    const all = await api.listTasks();
    const match = findTaskMatch(all, idOrTitle, (t) => !t.deletedAt && t.isCompleted);
    if (!match.task) return text({ reopened: false, error: match.error, candidates: match.candidates });

    const updated = await api.updateTask(match.task, { isCompleted: false, completedAt: null });
    return text({ reopened: true, task: summarize(updated) });
  }),
);

server.tool(
  'update_task',
  'Edita os campos de uma tarefa existente (só os campos informados são alterados).',
  {
    idOrTitle: z.string().min(1).describe('Id exato da tarefa, ou trecho do título para buscar entre as pendentes.'),
    title: z.string().min(1).max(300).optional().describe('Novo título.'),
    description: z.string().max(5000).optional().describe('Nova descrição.'),
    dueDate: z.string().datetime().optional().describe('Novo prazo, em ISO 8601 UTC.'),
    clearDueDate: z.boolean().optional().describe('Remove o prazo atual (ignora `dueDate` se true).'),
    priority: z.string().optional().describe('Nova prioridade: low/medium/high ou baixa/média/alta.'),
    categories: z.string().max(300).optional().describe('Novas categorias, separadas por vírgula (substitui as atuais; criadas se não existirem).'),
    clearCategories: z.boolean().optional().describe('Remove todas as categorias da tarefa (ignora `categories` se true).'),
    lane: z.string().max(100).optional().describe('Nome da raia do Kanban (criada se não existir). Raia é independente de categoria.'),
    clearLane: z.boolean().optional().describe('Remove a tarefa de qualquer raia do Kanban (ignora `lane` se true).'),
  },
  safe(async ({ idOrTitle, title, description, dueDate, clearDueDate, priority, categories, clearCategories, lane, clearLane }) => {
    const all = await api.listTasks();
    const match = findTaskMatch(all, idOrTitle, (t) => !t.deletedAt);
    if (!match.task) return text({ updated: false, error: match.error, candidates: match.candidates });

    const changes: Partial<TaskItem> = {};
    if (title !== undefined) changes.title = title;
    if (description !== undefined) changes.description = description;
    if (clearDueDate) changes.dueDate = null;
    else if (dueDate !== undefined) changes.dueDate = dueDate;
    if (priority !== undefined) changes.priority = normalizePriority(priority);
    if (clearCategories) changes.categoryIds = [];
    else if (categories !== undefined) changes.categoryIds = await resolveCategoryIds(categories);
    if (clearLane) changes.kanbanLaneId = null;
    else if (lane !== undefined) changes.kanbanLaneId = await resolveLaneId(lane);

    const updated = await api.updateTask(match.task, changes);
    return text({ updated: true, task: summarize(updated) });
  }),
);

server.tool(
  'delete_task',
  'Move uma tarefa para a lixeira (reversível com restore_task), pelo id ou por um trecho do título.',
  {
    idOrTitle: z.string().min(1).describe('Id exato da tarefa, ou trecho do título para buscar entre as ativas.'),
  },
  safe(async ({ idOrTitle }) => {
    const all = await api.listTasks();
    const match = findTaskMatch(all, idOrTitle, (t) => !t.deletedAt);
    if (!match.task) return text({ deleted: false, error: match.error, candidates: match.candidates });

    const updated = await api.moveToTrash(match.task);
    return text({ deleted: true, task: summarize(updated) });
  }),
);

server.tool(
  'restore_task',
  'Restaura uma tarefa da lixeira, pelo id ou por um trecho do título.',
  {
    idOrTitle: z.string().min(1).describe('Id exato da tarefa, ou trecho do título para buscar na lixeira.'),
  },
  safe(async ({ idOrTitle }) => {
    const all = await api.listTasks();
    const match = findTaskMatch(all, idOrTitle, (t) => !!t.deletedAt);
    if (!match.task) return text({ restored: false, error: match.error, candidates: match.candidates });

    const updated = await api.restoreTask(match.task);
    return text({ restored: true, task: summarize(updated) });
  }),
);

server.tool(
  'add_comment',
  'Adiciona um comentário a uma tarefa existente, pelo id ou por um trecho do título.',
  {
    idOrTitle: z.string().min(1).describe('Id exato da tarefa, ou trecho do título para buscar.'),
    text: z.string().min(1).max(2000).describe('Texto do comentário.'),
  },
  safe(async ({ idOrTitle, text: commentText }) => {
    const all = await api.listTasks();
    const match = findTaskMatch(all, idOrTitle, (t) => !t.deletedAt);
    if (!match.task) return text({ added: false, error: match.error, candidates: match.candidates });

    const comment = await api.addComment(match.task.id, commentText);
    return text({ added: true, comment });
  }),
);

server.tool(
  'list_comments',
  'Lista os comentários de uma tarefa, pelo id ou por um trecho do título.',
  {
    idOrTitle: z.string().min(1).describe('Id exato da tarefa, ou trecho do título para buscar.'),
  },
  safe(async ({ idOrTitle }) => {
    const all = await api.listTasks();
    const match = findTaskMatch(all, idOrTitle, (t) => !t.deletedAt);
    if (!match.task) return text({ found: false, error: match.error, candidates: match.candidates });

    const comments = await api.listComments(match.task.id);
    return text(comments);
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);

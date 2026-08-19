#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as api from './tasksApi.js';
import { normalizePriority } from './priority.js';

const server = new McpServer({
  name: 'anotacoes-tasks',
  version: '1.0.0',
});

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

async function resolveCategoryId(categoryName: string | undefined): Promise<string | null> {
  if (!categoryName?.trim()) return null;
  const trimmed = categoryName.trim();
  const categories = await api.listCategories();
  const existing = categories.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing.id;
  const created = await api.createCategory(trimmed);
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
    category: z.string().max(100).optional().describe('Nome da categoria. Criada automaticamente se não existir.'),
  },
  async ({ title, description, dueDate, priority, category }) => {
    const categoryId = await resolveCategoryId(category);
    const task = await api.createTask({
      title,
      description: description ?? null,
      dueDate: dueDate ?? null,
      priority: normalizePriority(priority),
      categoryId,
    });
    return text({ created: true, task });
  },
);

server.tool(
  'list_tasks',
  'Lista as tarefas do usuário. Por padrão retorna só as pendentes (não concluídas, não excluídas).',
  {
    includeCompleted: z.boolean().optional().describe('Inclui tarefas já concluídas. Padrão: false.'),
    includeDeleted: z.boolean().optional().describe('Inclui tarefas na lixeira. Padrão: false.'),
  },
  async ({ includeCompleted, includeDeleted }) => {
    const all = await api.listTasks();
    const filtered = all.filter(
      (t) => (includeDeleted || !t.deletedAt) && (includeCompleted || !t.isCompleted),
    );
    return text(
      filtered.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        dueDate: t.dueDate,
        priority: t.priority,
        categoryId: t.categoryId,
        isCompleted: t.isCompleted,
      })),
    );
  },
);

server.tool(
  'list_categories',
  'Lista as categorias de tarefas existentes do usuário.',
  {},
  async () => text(await api.listCategories()),
);

server.tool(
  'complete_task',
  'Marca uma tarefa como concluída, pelo id ou por um trecho do título (busca aproximada entre as pendentes).',
  {
    idOrTitle: z.string().min(1).describe('Id exato da tarefa, ou trecho do título para buscar entre as pendentes.'),
  },
  async ({ idOrTitle }) => {
    const all = await api.listTasks();
    const pending = all.filter((t) => !t.deletedAt && !t.isCompleted);

    let match = all.find((t) => t.id === idOrTitle);
    if (!match) {
      const needle = idOrTitle.trim().toLowerCase();
      const matches = pending.filter((t) => t.title.toLowerCase().includes(needle));
      if (matches.length === 0) {
        return text({ completed: false, error: `Nenhuma tarefa pendente encontrada para "${idOrTitle}".` });
      }
      if (matches.length > 1) {
        return text({
          completed: false,
          error: `Mais de uma tarefa pendente corresponde a "${idOrTitle}". Seja mais específico ou use o id.`,
          candidates: matches.map((t) => ({ id: t.id, title: t.title })),
        });
      }
      match = matches[0];
    }
    if (match.isCompleted) {
      return text({ completed: false, error: 'Essa tarefa já estava concluída.' });
    }

    const updated = await api.updateTask(match, {
      isCompleted: true,
      completedAt: new Date().toISOString(),
    });
    return text({ completed: true, task: updated });
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);

namespace Notas.Api.Data;

public enum TaskPriority
{
    Low,
    Medium,
    High
}

public class TaskCategory
{
    // Id é UUID gerado no cliente (mesma estratégia de sync idempotente das notas).
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Name { get; set; } = "";
    public string ColorHex { get; set; } = "";
    public DateTime UpdatedAt { get; set; }
}

// Projeto/quadro Kanban criado pelo usuário. Cada projeto tem suas próprias raias e sua própria
// lista de tarefas participantes (via TaskProjectMembership) — nada é puxado automaticamente.
public class TaskProject
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Name { get; set; } = "";
    public string ColorHex { get; set; } = "";
    public int Position { get; set; }
    public DateTime UpdatedAt { get; set; }
}

// Raia do quadro Kanban de um projeto — independente de categoria (o usuário organiza o quadro do
// jeito que quiser, ex.: "A fazer"/"Em andamento"/"Feito" ou qualquer fluxo próprio).
public class KanbanLane
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string ProjectId { get; set; } = "";
    public string Name { get; set; } = "";
    public string ColorHex { get; set; } = "";
    public int Position { get; set; }
    public DateTime UpdatedAt { get; set; }
}

// Vínculo N:N entre tarefa e projeto. Guarda raia/posição próprias desse vínculo, já que a mesma
// tarefa pode estar em vários projetos simultaneamente, cada um com seu próprio quadro.
public class TaskProjectMembership
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string TaskId { get; set; } = "";
    public string ProjectId { get; set; } = "";
    public string? KanbanLaneId { get; set; }
    public int Position { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class TaskItem
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public DateTime? DueDate { get; set; }
    public TaskPriority Priority { get; set; } = TaskPriority.Medium;
    // JSON opaco (array de ids de TaskCategory) — mesma estratégia do campo Subtasks: o backend só
    // valida contra as categorias existentes do usuário no upsert, não modela como FK/join table.
    public string CategoryIds { get; set; } = "[]";
    public bool IsRecurring { get; set; }
    public string? RecurrenceRule { get; set; }
    public bool IsCompleted { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    // Tombstone de sync — também é a "lixeira" da ferramenta (mesmo campo, mesmo uso).
    public DateTime? DeletedAt { get; set; }
    public int CompletedPomodoros { get; set; }
    public int Position { get; set; }
    public double? LocationLat { get; set; }
    public double? LocationLng { get; set; }
    public float? LocationRadiusMeters { get; set; }
    public string? LocationLabel { get; set; }
    // JSON opaco (array de subtarefas) — o backend não conhece a estrutura interna, só guarda e
    // devolve o blob, igual ao campo Elements das notas.
    public string Subtasks { get; set; } = "[]";
    // HTML sanitizado das anotações gerais da tarefa — blob opaco pro backend, igual a Subtasks.
    // As imagens vivem como TaskAttachment e são referenciadas por data-attachment-id.
    public string? Notes { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class TaskComment
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string TaskId { get; set; } = "";
    public string Text { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

public class TaskAttachment
{
    public string Id { get; set; } = "";
    public string UserId { get; set; } = "";
    public string TaskId { get; set; } = "";
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "application/octet-stream";
    public int SizeBytes { get; set; }
    // Conteúdo em base64 — escala pessoal, sem storage externo (mesmo raciocínio do SQLite único).
    public string DataBase64 { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}

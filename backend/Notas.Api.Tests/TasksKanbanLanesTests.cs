using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Notas.Api.Tests;

public class TasksKanbanLanesTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private readonly TasksApiFactory _factory;
    private HttpClient _client = null!;

    public TasksKanbanLanesTests(TasksApiFactory factory)
    {
        _factory = factory;
    }

    public async Task InitializeAsync()
    {
        _client = _factory.CreateClient();
        var token = await RegisterAndGetToken();
        _client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
    }

    public Task DisposeAsync()
    {
        _client.Dispose();
        return Task.CompletedTask;
    }

    private async Task<string> RegisterAndGetToken()
    {
        var email = $"test_{Guid.NewGuid():N}@example.com";
        var res = await _factory.CreateClient().PostAsJsonAsync("/api/auth/register", new { email, password = "Sup3rSecret!" });
        res.EnsureSuccessStatusCode();
        var body = await res.Content.ReadFromJsonAsync<JsonElement>();
        return body.GetProperty("accessToken").GetString()!;
    }

    private static object TaskPayload(string title, DateTime updatedAt, string? kanbanLaneId = null) => new
    {
        title,
        description = (string?)null,
        dueDate = (DateTime?)null,
        priority = "Medium",
        categoryId = (string?)null,
        kanbanLaneId,
        isRecurring = false,
        recurrenceRule = (string?)null,
        isCompleted = false,
        createdAt = updatedAt,
        completedAt = (DateTime?)null,
        deletedAt = (DateTime?)null,
        completedPomodoros = 0,
        position = 0,
        locationLat = (double?)null,
        locationLng = (double?)null,
        locationRadiusMeters = (float?)null,
        locationLabel = (string?)null,
        subtasks = "[]",
        updatedAt,
    };

    private async Task<string> CreateLaneAsync(string name, int position = 0)
    {
        var id = Guid.NewGuid().ToString();
        var res = await _client.PutAsJsonAsync($"/api/tasks/kanban-lanes/{id}", new
        {
            name,
            colorHex = "#2563eb",
            position,
            updatedAt = DateTime.UtcNow,
        });
        res.EnsureSuccessStatusCode();
        return id;
    }

    [Fact]
    public async Task CreateLane_ThenList_ReturnsItOrderedByPosition()
    {
        var idB = await CreateLaneAsync("B", position: 1);
        var idA = await CreateLaneAsync("A", position: 0);

        var listRes = await _client.GetAsync("/api/tasks/kanban-lanes");
        var list = await listRes.Content.ReadFromJsonAsync<JsonElement>();
        var ids = list.EnumerateArray().Select(l => l.GetProperty("id").GetString()).ToList();

        Assert.Equal(new[] { idA, idB }, ids);
    }

    [Fact]
    public async Task CreateLane_EmptyName_ReturnsBadRequest()
    {
        var id = Guid.NewGuid().ToString();
        var res = await _client.PutAsJsonAsync($"/api/tasks/kanban-lanes/{id}", new
        {
            name = "   ",
            colorHex = "#2563eb",
            position = 0,
            updatedAt = DateTime.UtcNow,
        });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task AssignTaskToLane_ThenDeleteLane_ClearsKanbanLaneIdOnTask()
    {
        var laneId = await CreateLaneAsync("Em andamento");
        var taskId = Guid.NewGuid().ToString();
        await _client.PutAsJsonAsync($"/api/tasks/items/{taskId}", TaskPayload("Tarefa", DateTime.UtcNow, laneId));

        var before = await (await _client.GetAsync("/api/tasks/items")).Content.ReadFromJsonAsync<JsonElement>();
        var beforeTask = before.EnumerateArray().First(t => t.GetProperty("id").GetString() == taskId);
        Assert.Equal(laneId, beforeTask.GetProperty("kanbanLaneId").GetString());

        var deleteRes = await _client.DeleteAsync($"/api/tasks/kanban-lanes/{laneId}");
        Assert.Equal(HttpStatusCode.NoContent, deleteRes.StatusCode);

        var after = await (await _client.GetAsync("/api/tasks/items")).Content.ReadFromJsonAsync<JsonElement>();
        var afterTask = after.EnumerateArray().First(t => t.GetProperty("id").GetString() == taskId);
        Assert.Equal(JsonValueKind.Null, afterTask.GetProperty("kanbanLaneId").ValueKind);
    }

    [Fact]
    public async Task CreateTask_WithKanbanLaneFromAnotherUser_IsIgnored()
    {
        var otherClient = _factory.CreateClient();
        var otherToken = await RegisterAndGetToken();
        otherClient.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", otherToken);

        var foreignLaneId = Guid.NewGuid().ToString();
        await otherClient.PutAsJsonAsync($"/api/tasks/kanban-lanes/{foreignLaneId}", new
        {
            name = "Raia de outro usuário",
            colorHex = "#000000",
            position = 0,
            updatedAt = DateTime.UtcNow,
        });

        var taskId = Guid.NewGuid().ToString();
        var res = await _client.PutAsJsonAsync($"/api/tasks/items/{taskId}", TaskPayload("Tarefa", DateTime.UtcNow, foreignLaneId));
        var created = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(JsonValueKind.Null, created.GetProperty("kanbanLaneId").ValueKind);
    }

    [Fact]
    public async Task Lanes_FromAnotherUser_AreNotVisibleOrDeletable()
    {
        var laneId = await CreateLaneAsync("Minha raia");

        var otherClient = _factory.CreateClient();
        var otherToken = await RegisterAndGetToken();
        otherClient.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", otherToken);

        var listRes = await otherClient.GetAsync("/api/tasks/kanban-lanes");
        var list = await listRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.DoesNotContain(list.EnumerateArray(), l => l.GetProperty("id").GetString() == laneId);

        var deleteRes = await otherClient.DeleteAsync($"/api/tasks/kanban-lanes/{laneId}");
        Assert.Equal(HttpStatusCode.NotFound, deleteRes.StatusCode);
    }

    [Fact]
    public async Task RenameLane_UpdatesNameAndPosition()
    {
        var laneId = await CreateLaneAsync("Nome original", position: 0);

        var renameRes = await _client.PutAsJsonAsync($"/api/tasks/kanban-lanes/{laneId}", new
        {
            name = "Nome novo",
            colorHex = "#16a34a",
            position = 2,
            updatedAt = DateTime.UtcNow.AddMinutes(1),
        });
        var renamed = await renameRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Nome novo", renamed.GetProperty("name").GetString());
        Assert.Equal(2, renamed.GetProperty("position").GetInt32());
    }
}

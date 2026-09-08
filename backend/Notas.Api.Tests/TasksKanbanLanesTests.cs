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

    private static object TaskPayload(string title, DateTime updatedAt) => new
    {
        title,
        description = (string?)null,
        dueDate = (DateTime?)null,
        priority = "Medium",
        categoryIds = Array.Empty<string>(),
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

    private async Task<string> CreateTaskAsync(HttpClient client, string title)
    {
        var id = Guid.NewGuid().ToString();
        var res = await client.PutAsJsonAsync($"/api/tasks/items/{id}", TaskPayload(title, DateTime.UtcNow));
        res.EnsureSuccessStatusCode();
        return id;
    }

    private async Task<string> CreateProjectAsync(HttpClient client, string name = "Projeto")
    {
        var id = Guid.NewGuid().ToString();
        var res = await client.PutAsJsonAsync($"/api/tasks/projects/{id}", new
        {
            name,
            colorHex = "#2563eb",
            position = 0,
            updatedAt = DateTime.UtcNow,
        });
        res.EnsureSuccessStatusCode();
        return id;
    }

    private async Task<string> CreateLaneAsync(string projectId, string name, int position = 0, HttpClient? client = null)
    {
        var id = Guid.NewGuid().ToString();
        var res = await (client ?? _client).PutAsJsonAsync($"/api/tasks/kanban-lanes/{id}", new
        {
            projectId,
            name,
            colorHex = "#2563eb",
            position,
            updatedAt = DateTime.UtcNow,
        });
        res.EnsureSuccessStatusCode();
        return id;
    }

    private async Task<HttpResponseMessage> UpsertMembershipAsync(
        string taskId, string projectId, string? kanbanLaneId = null, int position = 0, HttpClient? client = null)
    {
        var id = Guid.NewGuid().ToString();
        return await (client ?? _client).PutAsJsonAsync($"/api/tasks/project-memberships/{id}", new
        {
            taskId,
            projectId,
            kanbanLaneId,
            position,
            updatedAt = DateTime.UtcNow,
        });
    }

    [Fact]
    public async Task CreateLane_ThenList_ReturnsItOrderedByPosition()
    {
        var projectId = await CreateProjectAsync(_client);
        var idB = await CreateLaneAsync(projectId, "B", position: 1);
        var idA = await CreateLaneAsync(projectId, "A", position: 0);

        var listRes = await _client.GetAsync("/api/tasks/kanban-lanes");
        var list = await listRes.Content.ReadFromJsonAsync<JsonElement>();
        var ids = list.EnumerateArray().Select(l => l.GetProperty("id").GetString()).ToList();

        Assert.Equal(new[] { idA, idB }, ids);
    }

    [Fact]
    public async Task CreateLane_EmptyName_ReturnsBadRequest()
    {
        var projectId = await CreateProjectAsync(_client);
        var id = Guid.NewGuid().ToString();
        var res = await _client.PutAsJsonAsync($"/api/tasks/kanban-lanes/{id}", new
        {
            projectId,
            name = "   ",
            colorHex = "#2563eb",
            position = 0,
            updatedAt = DateTime.UtcNow,
        });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task CreateLane_WithInvalidProject_ReturnsBadRequest()
    {
        var id = Guid.NewGuid().ToString();
        var res = await _client.PutAsJsonAsync($"/api/tasks/kanban-lanes/{id}", new
        {
            projectId = Guid.NewGuid().ToString(),
            name = "Raia",
            colorHex = "#2563eb",
            position = 0,
            updatedAt = DateTime.UtcNow,
        });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task AssignTaskToLane_ThenDeleteLane_ClearsLaneOnMembership()
    {
        var projectId = await CreateProjectAsync(_client);
        var laneId = await CreateLaneAsync(projectId, "Em andamento");
        var taskId = await CreateTaskAsync(_client, "Tarefa");

        var membershipRes = await UpsertMembershipAsync(taskId, projectId, laneId);
        membershipRes.EnsureSuccessStatusCode();
        var membership = await membershipRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(laneId, membership.GetProperty("kanbanLaneId").GetString());

        var deleteRes = await _client.DeleteAsync($"/api/tasks/kanban-lanes/{laneId}");
        Assert.Equal(HttpStatusCode.NoContent, deleteRes.StatusCode);

        var after = await (await _client.GetAsync("/api/tasks/project-memberships")).Content.ReadFromJsonAsync<JsonElement>();
        var afterMembership = after.EnumerateArray().First(m => m.GetProperty("taskId").GetString() == taskId);
        Assert.Equal(JsonValueKind.Null, afterMembership.GetProperty("kanbanLaneId").ValueKind);
    }

    [Fact]
    public async Task CreateMembership_WithKanbanLaneFromAnotherProject_IsIgnored()
    {
        var projectId = await CreateProjectAsync(_client);
        var otherProjectId = await CreateProjectAsync(_client, "Outro projeto");
        var foreignLaneId = await CreateLaneAsync(otherProjectId, "Raia de outro projeto");
        var taskId = await CreateTaskAsync(_client, "Tarefa");

        var res = await UpsertMembershipAsync(taskId, projectId, foreignLaneId);
        res.EnsureSuccessStatusCode();
        var membership = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal(JsonValueKind.Null, membership.GetProperty("kanbanLaneId").ValueKind);
    }

    [Fact]
    public async Task CreateMembership_Twice_ForSameTaskAndProject_ReturnsConflict()
    {
        var projectId = await CreateProjectAsync(_client);
        var taskId = await CreateTaskAsync(_client, "Tarefa");

        var first = await UpsertMembershipAsync(taskId, projectId);
        first.EnsureSuccessStatusCode();

        var second = await UpsertMembershipAsync(taskId, projectId);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task DeleteProject_CascadesLanesAndMemberships_ButKeepsTask()
    {
        var projectId = await CreateProjectAsync(_client);
        var laneId = await CreateLaneAsync(projectId, "Raia");
        var taskId = await CreateTaskAsync(_client, "Tarefa");
        (await UpsertMembershipAsync(taskId, projectId, laneId)).EnsureSuccessStatusCode();

        var deleteRes = await _client.DeleteAsync($"/api/tasks/projects/{projectId}");
        Assert.Equal(HttpStatusCode.NoContent, deleteRes.StatusCode);

        var lanes = await (await _client.GetAsync("/api/tasks/kanban-lanes")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.DoesNotContain(lanes.EnumerateArray(), l => l.GetProperty("id").GetString() == laneId);

        var memberships = await (await _client.GetAsync("/api/tasks/project-memberships")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.DoesNotContain(memberships.EnumerateArray(), m => m.GetProperty("projectId").GetString() == projectId);

        var tasks = await (await _client.GetAsync("/api/tasks/items")).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains(tasks.EnumerateArray(), t => t.GetProperty("id").GetString() == taskId);
    }

    [Fact]
    public async Task Lanes_FromAnotherUser_AreNotVisibleOrDeletable()
    {
        var projectId = await CreateProjectAsync(_client);
        var laneId = await CreateLaneAsync(projectId, "Minha raia");

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
        var projectId = await CreateProjectAsync(_client);
        var laneId = await CreateLaneAsync(projectId, "Nome original", position: 0);

        var renameRes = await _client.PutAsJsonAsync($"/api/tasks/kanban-lanes/{laneId}", new
        {
            projectId,
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

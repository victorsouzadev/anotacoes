using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Notas.Api.Tests;

public class TasksCoreTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private readonly TasksApiFactory _factory;
    private HttpClient _client = null!;

    public TasksCoreTests(TasksApiFactory factory)
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

    private static object TaskPayload(string title, DateTime updatedAt, string? categoryId = null, bool isCompleted = false) => new
    {
        title,
        description = (string?)null,
        dueDate = (DateTime?)null,
        priority = "Medium",
        categoryIds = categoryId is null ? Array.Empty<string>() : new[] { categoryId },
        isRecurring = false,
        recurrenceRule = (string?)null,
        isCompleted,
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

    [Fact]
    public async Task CreateTask_ThenGetList_ReturnsIt()
    {
        var id = Guid.NewGuid().ToString();
        var res = await _client.PutAsJsonAsync($"/api/tasks/items/{id}", TaskPayload("Comprar pão", DateTime.UtcNow));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);

        var listRes = await _client.GetAsync("/api/tasks/items");
        var list = await listRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Contains(list.EnumerateArray(), t => t.GetProperty("id").GetString() == id);
    }

    [Fact]
    public async Task CreateTask_EmptyTitle_ReturnsBadRequest()
    {
        var id = Guid.NewGuid().ToString();
        var res = await _client.PutAsJsonAsync($"/api/tasks/items/{id}", TaskPayload("   ", DateTime.UtcNow));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task UpdateTask_WithOlderUpdatedAt_IsIgnored_LastWriteWins()
    {
        var id = Guid.NewGuid().ToString();
        var t0 = DateTime.UtcNow;

        await _client.PutAsJsonAsync($"/api/tasks/items/{id}", TaskPayload("Título original", t0));
        await _client.PutAsJsonAsync($"/api/tasks/items/{id}", TaskPayload("Título novo", t0.AddMinutes(5)));

        // Update "atrasado" (updatedAt mais antigo que o já salvo) não deve sobrescrever.
        var staleRes = await _client.PutAsJsonAsync($"/api/tasks/items/{id}", TaskPayload("Título atrasado", t0.AddMinutes(1)));
        var stale = await staleRes.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Equal("Título novo", stale.GetProperty("title").GetString());
    }

    [Fact]
    public async Task DeleteTaskForever_RemovesFromList()
    {
        var id = Guid.NewGuid().ToString();
        await _client.PutAsJsonAsync($"/api/tasks/items/{id}", TaskPayload("Vai sumir", DateTime.UtcNow));

        var deleteRes = await _client.DeleteAsync($"/api/tasks/items/{id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteRes.StatusCode);

        var listRes = await _client.GetAsync("/api/tasks/items");
        var list = await listRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.DoesNotContain(list.EnumerateArray(), t => t.GetProperty("id").GetString() == id);
    }

    [Fact]
    public async Task Tasks_FromAnotherUser_AreNotVisible()
    {
        var id = Guid.NewGuid().ToString();
        await _client.PutAsJsonAsync($"/api/tasks/items/{id}", TaskPayload("Minha tarefa", DateTime.UtcNow));

        var otherClient = _factory.CreateClient();
        var otherToken = await RegisterAndGetToken();
        otherClient.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", otherToken);

        var listRes = await otherClient.GetAsync("/api/tasks/items");
        var list = await listRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.DoesNotContain(list.EnumerateArray(), t => t.GetProperty("id").GetString() == id);

        var deleteRes = await otherClient.DeleteAsync($"/api/tasks/items/{id}");
        Assert.Equal(HttpStatusCode.NotFound, deleteRes.StatusCode);
    }

    [Fact]
    public async Task CreateCategory_ThenAssignToTask_ThenDeleteCategory_ClearsCategoryOnTask()
    {
        var categoryId = Guid.NewGuid().ToString();
        var catRes = await _client.PutAsJsonAsync($"/api/tasks/categories/{categoryId}", new
        {
            name = "Trabalho",
            colorHex = "#2563eb",
            updatedAt = DateTime.UtcNow,
        });
        Assert.Equal(HttpStatusCode.OK, catRes.StatusCode);

        var taskId = Guid.NewGuid().ToString();
        await _client.PutAsJsonAsync($"/api/tasks/items/{taskId}", TaskPayload("Tarefa categorizada", DateTime.UtcNow, categoryId));

        var beforeDelete = await (await _client.GetAsync("/api/tasks/items")).Content.ReadFromJsonAsync<JsonElement>();
        var beforeTask = beforeDelete.EnumerateArray().First(t => t.GetProperty("id").GetString() == taskId);
        Assert.Equal(new[] { categoryId }, beforeTask.GetProperty("categoryIds").EnumerateArray().Select(e => e.GetString()));

        var deleteRes = await _client.DeleteAsync($"/api/tasks/categories/{categoryId}");
        Assert.Equal(HttpStatusCode.NoContent, deleteRes.StatusCode);

        var afterDelete = await (await _client.GetAsync("/api/tasks/items")).Content.ReadFromJsonAsync<JsonElement>();
        var afterTask = afterDelete.EnumerateArray().First(t => t.GetProperty("id").GetString() == taskId);
        Assert.Empty(afterTask.GetProperty("categoryIds").EnumerateArray());
    }

    [Fact]
    public async Task CreateTask_WithCategoryFromAnotherUser_IsIgnored()
    {
        var otherClient = _factory.CreateClient();
        var otherToken = await RegisterAndGetToken();
        otherClient.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", otherToken);

        var foreignCategoryId = Guid.NewGuid().ToString();
        await otherClient.PutAsJsonAsync($"/api/tasks/categories/{foreignCategoryId}", new
        {
            name = "Categoria de outro usuário",
            colorHex = "#000000",
            updatedAt = DateTime.UtcNow,
        });

        var taskId = Guid.NewGuid().ToString();
        var res = await _client.PutAsJsonAsync($"/api/tasks/items/{taskId}", TaskPayload("Tarefa", DateTime.UtcNow, foreignCategoryId));
        var created = await res.Content.ReadFromJsonAsync<JsonElement>();

        Assert.Empty(created.GetProperty("categoryIds").EnumerateArray());
    }

    [Fact]
    public async Task CreateTask_WithMultipleCategories_KeepsOnlyValidOwnedOnes()
    {
        var catA = Guid.NewGuid().ToString();
        var catB = Guid.NewGuid().ToString();
        await _client.PutAsJsonAsync($"/api/tasks/categories/{catA}", new { name = "A", colorHex = "#111111", updatedAt = DateTime.UtcNow });
        await _client.PutAsJsonAsync($"/api/tasks/categories/{catB}", new { name = "B", colorHex = "#222222", updatedAt = DateTime.UtcNow });

        var foreignCategoryId = Guid.NewGuid().ToString();
        var taskId = Guid.NewGuid().ToString();
        var res = await _client.PutAsJsonAsync($"/api/tasks/items/{taskId}", new
        {
            title = "Multi",
            description = (string?)null,
            dueDate = (DateTime?)null,
            priority = "Medium",
            categoryIds = new[] { catA, catB, foreignCategoryId },
            isRecurring = false,
            recurrenceRule = (string?)null,
            isCompleted = false,
            createdAt = DateTime.UtcNow,
            completedAt = (DateTime?)null,
            deletedAt = (DateTime?)null,
            completedPomodoros = 0,
            position = 0,
            locationLat = (double?)null,
            locationLng = (double?)null,
            locationRadiusMeters = (float?)null,
            locationLabel = (string?)null,
            subtasks = "[]",
            updatedAt = DateTime.UtcNow,
        });
        var created = await res.Content.ReadFromJsonAsync<JsonElement>();

        var ids = created.GetProperty("categoryIds").EnumerateArray().Select(e => e.GetString()).ToList();
        Assert.Equal(2, ids.Count);
        Assert.Contains(catA, ids);
        Assert.Contains(catB, ids);
        Assert.DoesNotContain(foreignCategoryId, ids);
    }

    [Fact]
    public async Task RenameCategory_UpdatesName()
    {
        var categoryId = Guid.NewGuid().ToString();
        await _client.PutAsJsonAsync($"/api/tasks/categories/{categoryId}", new
        {
            name = "Nome original",
            colorHex = "#2563eb",
            updatedAt = DateTime.UtcNow,
        });

        var renameRes = await _client.PutAsJsonAsync($"/api/tasks/categories/{categoryId}", new
        {
            name = "Nome novo",
            colorHex = "#2563eb",
            updatedAt = DateTime.UtcNow.AddMinutes(1),
        });
        var renamed = await renameRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("Nome novo", renamed.GetProperty("name").GetString());
    }
}

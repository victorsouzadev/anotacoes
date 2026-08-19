using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Notas.Api.Tests;

public class TasksCommentsAndAttachmentsTests : IClassFixture<TasksApiFactory>, IAsyncLifetime
{
    private readonly TasksApiFactory _factory;
    private HttpClient _client = null!;

    public TasksCommentsAndAttachmentsTests(TasksApiFactory factory)
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

    private async Task<string> CreateTaskAsync()
    {
        var id = Guid.NewGuid().ToString();
        var now = DateTime.UtcNow;
        var req = new
        {
            title = "Tarefa de teste",
            description = (string?)null,
            dueDate = (DateTime?)null,
            priority = "Medium",
            categoryId = (string?)null,
            isRecurring = false,
            recurrenceRule = (string?)null,
            isCompleted = false,
            createdAt = now,
            completedAt = (DateTime?)null,
            deletedAt = (DateTime?)null,
            completedPomodoros = 0,
            position = 0,
            locationLat = (double?)null,
            locationLng = (double?)null,
            locationRadiusMeters = (float?)null,
            locationLabel = (string?)null,
            subtasks = "[]",
            updatedAt = now,
        };
        var res = await _client.PutAsJsonAsync($"/api/tasks/items/{id}", req);
        res.EnsureSuccessStatusCode();
        return id;
    }

    [Fact]
    public async Task AddComment_ThenList_ReturnsIt()
    {
        var taskId = await CreateTaskAsync();

        var addRes = await _client.PostAsJsonAsync($"/api/tasks/items/{taskId}/comments", new { text = "Primeiro comentário" });
        Assert.Equal(HttpStatusCode.OK, addRes.StatusCode);
        var added = await addRes.Content.ReadFromJsonAsync<JsonElement>();
        var commentId = added.GetProperty("id").GetString();
        Assert.Equal("Primeiro comentário", added.GetProperty("text").GetString());

        var listRes = await _client.GetAsync($"/api/tasks/items/{taskId}/comments");
        var list = await listRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(1, list.GetArrayLength());
        Assert.Equal(commentId, list[0].GetProperty("id").GetString());
    }

    [Fact]
    public async Task AddComment_EmptyText_ReturnsBadRequest()
    {
        var taskId = await CreateTaskAsync();
        var res = await _client.PostAsJsonAsync($"/api/tasks/items/{taskId}/comments", new { text = "   " });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task DeleteComment_RemovesIt()
    {
        var taskId = await CreateTaskAsync();
        var addRes = await _client.PostAsJsonAsync($"/api/tasks/items/{taskId}/comments", new { text = "Vai sumir" });
        var added = await addRes.Content.ReadFromJsonAsync<JsonElement>();
        var commentId = added.GetProperty("id").GetString();

        var deleteRes = await _client.DeleteAsync($"/api/tasks/items/{taskId}/comments/{commentId}");
        Assert.Equal(HttpStatusCode.NoContent, deleteRes.StatusCode);

        var listRes = await _client.GetAsync($"/api/tasks/items/{taskId}/comments");
        var list = await listRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, list.GetArrayLength());
    }

    [Fact]
    public async Task Comments_OnTaskFromAnotherUser_ReturnsNotFound()
    {
        var taskId = await CreateTaskAsync();

        var otherClient = _factory.CreateClient();
        var otherToken = await RegisterAndGetToken();
        otherClient.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", otherToken);

        var res = await otherClient.GetAsync($"/api/tasks/items/{taskId}/comments");
        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
    }

    [Fact]
    public async Task AddAttachment_ThenDownload_RoundTripsContent()
    {
        var taskId = await CreateTaskAsync();
        var bytes = System.Text.Encoding.UTF8.GetBytes("conteudo do arquivo teste");
        var base64 = Convert.ToBase64String(bytes);

        var addRes = await _client.PostAsJsonAsync($"/api/tasks/items/{taskId}/attachments", new
        {
            fileName = "nota.txt",
            contentType = "text/plain",
            dataBase64 = base64,
        });
        Assert.Equal(HttpStatusCode.OK, addRes.StatusCode);
        var added = await addRes.Content.ReadFromJsonAsync<JsonElement>();
        var attachmentId = added.GetProperty("id").GetString();
        Assert.Equal(bytes.Length, added.GetProperty("sizeBytes").GetInt32());

        var downloadRes = await _client.GetAsync($"/api/tasks/items/{taskId}/attachments/{attachmentId}/content");
        Assert.Equal(HttpStatusCode.OK, downloadRes.StatusCode);
        var downloaded = await downloadRes.Content.ReadAsByteArrayAsync();
        Assert.Equal(bytes, downloaded);
    }

    [Fact]
    public async Task AddAttachment_OverSizeLimit_ReturnsBadRequest()
    {
        var taskId = await CreateTaskAsync();
        var bytes = new byte[6 * 1024 * 1024];
        var base64 = Convert.ToBase64String(bytes);

        var res = await _client.PostAsJsonAsync($"/api/tasks/items/{taskId}/attachments", new
        {
            fileName = "grande.bin",
            contentType = "application/octet-stream",
            dataBase64 = base64,
        });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task DeleteAttachment_RemovesIt()
    {
        var taskId = await CreateTaskAsync();
        var base64 = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("x"));
        var addRes = await _client.PostAsJsonAsync($"/api/tasks/items/{taskId}/attachments", new
        {
            fileName = "a.txt",
            contentType = "text/plain",
            dataBase64 = base64,
        });
        var added = await addRes.Content.ReadFromJsonAsync<JsonElement>();
        var attachmentId = added.GetProperty("id").GetString();

        var deleteRes = await _client.DeleteAsync($"/api/tasks/items/{taskId}/attachments/{attachmentId}");
        Assert.Equal(HttpStatusCode.NoContent, deleteRes.StatusCode);

        var listRes = await _client.GetAsync($"/api/tasks/items/{taskId}/attachments");
        var list = await listRes.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(0, list.GetArrayLength());
    }

    [Fact]
    public async Task Endpoints_WithoutAuth_ReturnUnauthorized()
    {
        var anonymous = _factory.CreateClient();
        var res = await anonymous.GetAsync("/api/tasks/items/some-id/comments");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }
}

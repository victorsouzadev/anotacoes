namespace Notas.Api.Dtos;

public record RegisterRequest(string Email, string Password);
public record LoginRequest(string Email, string Password);
public record RefreshRequest(string RefreshToken);
public record AuthResponse(string AccessToken, string RefreshToken, UserDto User);
public record UserDto(string Id, string Email);

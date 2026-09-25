using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace EditorImagens.Desktop;

/// <summary>Liga os arquivos .edimg ao programa (duplo clique no Explorer abre
/// no editor). Por usuário, em HKCU: não pede administrador.</summary>
public static class Associacao
{
    private const string Extensao = ".edimg";
    private const string Tipo = "EditorImagens.Projeto";

    public static void Registrar()
    {
        var exe = Environment.ProcessPath;
        if (exe is null) return;
        try
        {
            using (var ext = Registry.CurrentUser.CreateSubKey($@"Software\Classes\{Extensao}"))
            {
                ext.SetValue("", Tipo);
                ext.SetValue("Content Type", "application/x-editor-imagens");
            }
            using (var tipo = Registry.CurrentUser.CreateSubKey($@"Software\Classes\{Tipo}"))
            {
                tipo.SetValue("", "Projeto do Editor de Imagens");
                using var icone = tipo.CreateSubKey("DefaultIcon");
                icone.SetValue("", $"\"{exe}\",0");
                using var cmd = tipo.CreateSubKey(@"shell\open\command");
                cmd.SetValue("", $"\"{exe}\" \"%1\"");
            }
            Avisar();
        }
        catch (UnauthorizedAccessException)
        {
            // política da máquina bloqueia: o programa funciona igual, só sem o duplo clique
        }
    }

    public static void Remover()
    {
        try
        {
            Registry.CurrentUser.DeleteSubKeyTree($@"Software\Classes\{Extensao}", false);
            Registry.CurrentUser.DeleteSubKeyTree($@"Software\Classes\{Tipo}", false);
            Avisar();
        }
        catch (UnauthorizedAccessException) { }
    }

    [DllImport("shell32.dll")]
    private static extern void SHChangeNotify(int eventId, uint flags, IntPtr item1, IntPtr item2);

    private static void Avisar() => SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);
}

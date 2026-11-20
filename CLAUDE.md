# notas-vps — instruções para o Claude

Leia `README.md` (visão geral, stack, estrutura) e `.specify/memory/constitution.md`
(princípios do projeto) antes de mudanças grandes.

## Spec Kit (desenvolvimento guiado por spec)

Este repositório usa o [Spec Kit](https://github.com/github/spec-kit). Para feature nova ou
mudança relevante, siga as skills nesta ordem:

1. `/speckit-specify <descrição>` — cria `specs/NNN-feature/spec.md` (o quê e por quê)
2. `/speckit-clarify` (opcional) — tira ambiguidades da spec
3. `/speckit-plan <stack/restrições>` — `plan.md`, `research.md`, `data-model.md`, `contracts/`
4. `/speckit-tasks` — `tasks.md` em ordem de dependência
5. `/speckit-analyze` (opcional) — consistência entre spec, plano e tarefas
6. `/speckit-implement` — executa as tarefas

As specs 001–014 em `specs/` são retroativas (o que já existe, por ferramenta), as 015–028 já foram
implementadas e as 029–035 planejam a divisão em núcleo + plug-ins com banco compartilhado e a 036 a cópia do backup fora da VPS, que vem antes delas (ver a ordem
em `specs/README.md`). Leia a spec da
ferramenta antes de mudá-la. Correções pequenas não precisam de spec. O Spec Kit **não cria branch** aqui: trabalhe na
branch da sessão. A feature ativa fica em `.specify/feature.json` (local, fora do git).

## Idioma

Tudo em português do Brasil: specs, planos, tarefas, checklists, interface, documentação e
mensagens de commit (`<Ferramenta>: <o que mudou>`). Os templates do Spec Kit estão em inglês;
preencha as seções em pt-BR mantendo os títulos que os scripts procuram.

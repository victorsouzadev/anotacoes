# Research: Busca semântica

- **Provedor**: **Decision** `/v1/embeddings` compatível com OpenAI, `text-embedding-3-small` (1536 dimensões), chave da OpenAI já usada na transcrição (`TranscriptionSettings`) ou `CEREBRO_EMBEDDINGS_API_KEY`. **Rationale**: a Anthropic não oferece embeddings; a chave OpenAI já existe no fluxo. **Alternatives**: modelo local ONNX (rejeitado: peso e CPU na VPS); Voyage (rejeitado: mais uma conta/chave).
- **Armazenamento**: **Decision** tabela `chunk_vectors(chunk_id, model, text_hash, vec BLOB)` no mesmo SQLite do índice, vetor em float32. **Rationale**: recriável; sem extensão nativa (`sqlite-vec` exigiria binário).
- **Busca**: **Decision** carregar vetores em memória (20 mil × 1536 × 4 B ≈ 120 MB no limite; 5 mil típicos ≈ 30 MB) e cosseno por força bruta; RRF com k=60 entre FTS5 e vetores (top 50 de cada).
- **Custo**: indexação inicial ≈ tokens do vault × preço do modelo; a tela mostra a estimativa com base no total de caracteres ÷ 4.

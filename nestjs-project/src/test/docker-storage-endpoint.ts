/**
 * Testes dentro da rede Compose falam com o MinIO pelo nome do serviço.
 * URLs pré-assinadas incluem o host na assinatura SigV4 — não dá para
 * reescrever localhost→minio depois da assinatura. Quando o endpoint
 * interno já aponta para `minio`, a URL pública dos testes deve ser a mesma.
 */
if (process.env.STORAGE_ENDPOINT?.includes('minio')) {
  process.env.STORAGE_PUBLIC_ENDPOINT = process.env.STORAGE_ENDPOINT;
}

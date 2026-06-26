import * as Minio from 'minio';

const useSSL = process.env.MINIO_USE_SSL === 'true';

// Inicializar cliente do MinIO de forma preguiçosa para evitar falhas se as variáveis não estiverem configuradas
let minioClient: Minio.Client | null = null;

export function getMinioClient(): Minio.Client | null {
  if (minioClient) return minioClient;

  const endPoint = process.env.MINIO_ENDPOINT;
  const accessKey = process.env.MINIO_ACCESS_KEY;
  const secretKey = process.env.MINIO_SECRET_KEY;

  if (!endPoint || !accessKey || !secretKey) {
    console.log('MinIO não configurado. Integração desativada.');
    return null;
  }

  const port = process.env.MINIO_PORT ? parseInt(process.env.MINIO_PORT) : (useSSL ? 443 : 80);

  minioClient = new Minio.Client({
    endPoint,
    port,
    useSSL,
    accessKey,
    secretKey
  });

  return minioClient;
}

export async function ensureBucketExists(bucketName: string): Promise<boolean> {
  const client = getMinioClient();
  if (!client) return false;

  try {
    const exists = await client.bucketExists(bucketName);
    if (!exists) {
      await client.makeBucket(bucketName, 'us-east-1');
      console.log(`Bucket '${bucketName}' criado com sucesso no MinIO.`);
    }
    return true;
  } catch (err) {
    console.error(`Erro ao verificar/criar bucket '${bucketName}' no MinIO:`, err);
    return false;
  }
}

/**
 * Gera um arquivo ZPL e faz o upload para o MinIO
 * @returns URL pública do arquivo ou null se falhar/desativado
 */
export async function uploadZplToMinio(data: any): Promise<string | null> {
  const client = getMinioClient();
  if (!client) return null;

  try {
    const bucketName = process.env.MINIO_BUCKET || 'reimpressao-zpl';
    const isBucketReady = await ensureBucketExists(bucketName);
    if (!isBucketReady) return null;

    // Gerar o conteúdo do ZPL
    const zplContent = `^XA
^FX --- DADOS DA ONU ---
^CF0,30
^FO50,50^FDFabricante: ${data.fabricante || 'N/A'}^FS
^FO50,90^FDModelo: ${data.modelo || 'N/A'}^FS
^FO50,130^FDGPON: ${data.gpon_sn || 'N/A'}^FS
^FO50,170^FDMAC: ${data.mac || 'N/A'}^FS
^FO50,210^FDSSID: ${data.wifi_ssid || 'N/A'}^FS
^FO50,250^FDSSID 5G: ${data.wifi_ssid_5g || 'N/A'}^FS
^FO50,290^FDSenha Wi-Fi: ${data.wifi_key || 'N/A'}^FS
^XZ`;

    const buffer = Buffer.from(zplContent, 'utf-8');
    // Nome do arquivo baseado no GPON/MAC e timestamp
    const identifier = (data.gpon_sn || data.mac || 'label').replace(/[^A-Za-z0-9_-]/g, '');
    const fileName = `${identifier}_${Date.now()}.zpl.txt`;

    await client.putObject(bucketName, fileName, buffer, buffer.length, {
      'Content-Type': 'text/plain'
    });

    console.log(`Arquivo ZPL ${fileName} enviado com sucesso para o MinIO.`);

    // Construir a URL de acesso
    const endPoint = process.env.MINIO_ENDPOINT;
    const protocol = useSSL ? 'https' : 'http';
    const portString = process.env.MINIO_PORT && !['80', '443'].includes(process.env.MINIO_PORT) 
      ? `:${process.env.MINIO_PORT}` 
      : '';
    
    // Se o MinIO possuir uma URL externa customizada configurada (para CDN/Proxy/Domínio diferente)
    const externalUrl = process.env.MINIO_EXTERNAL_URL || process.env.MINIO_PUBLIC_URL;
    if (externalUrl) {
      return `${externalUrl}/${bucketName}/${fileName}`;
    }

    return `${protocol}://${endPoint}${portString}/${bucketName}/${fileName}`;
  } catch (err) {
    console.error('Erro ao realizar upload do ZPL para o MinIO:', err);
    return null;
  }
}

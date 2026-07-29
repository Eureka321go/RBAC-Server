import ReactNativeBlobUtil from 'react-native-blob-util';
import { Dirs, FileSystem } from 'react-native-file-access';
import type { MediaBinaryPort, PickedMedia } from '@im/sdk-core';

const UPLOAD_DIR = `${Dirs.DocumentDir}/im-media-uploads`;
const DOWNLOAD_DIR = `${Dirs.CacheDir}/im-media-downloads`;

function basename(filename: string): string {
  const normalized = filename.replace(/\\/g, '/');
  const leaf = normalized.slice(normalized.lastIndexOf('/') + 1)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return (leaf || 'file').slice(-180);
}

async function ensureDir(path: string): Promise<void> {
  if (!(await FileSystem.exists(path))) await FileSystem.mkdir(path);
}

function responseHeader(headers: unknown, name: string): string | null {
  if (headers == null || typeof headers !== 'object') return null;
  const entry = Object.entries(headers as Record<string, unknown>)
    .find(([key]) => key.toLowerCase() === name.toLowerCase());
  return typeof entry?.[1] === 'string' ? entry[1] : null;
}

export class RnMediaBinary implements MediaBinaryPort {
  async persist(source: PickedMedia, taskId: string): Promise<PickedMedia> {
    await ensureDir(UPLOAD_DIR);
    const target = `${UPLOAD_DIR}/${taskId}-${basename(source.filename)}`;
    await FileSystem.cp(source.uri, target);
    const stat = await FileSystem.stat(target);
    return { ...source, uri: target, filename: basename(source.filename), size: stat.size };
  }

  exists(uri: string): Promise<boolean> {
    return FileSystem.exists(uri);
  }

  readChunkBase64(uri: string, offset: number, length: number): Promise<string> {
    return FileSystem.readFileChunk(uri, offset, length, 'base64');
  }

  async putBase64(
    url: string,
    base64: string,
    contentType: string,
    contentLength: number,
  ): Promise<{ eTag: string | null }> {
    const response = await ReactNativeBlobUtil.fetch('PUT', url, {
      // ;BASE64 只告诉原生桥解码；库发出请求前会移除该后缀，保持 S3 签名中的 MIME 不变。
      'Content-Type': `${contentType};BASE64`,
      'Content-Length': String(contentLength),
      'Cache-Control': 'no-store',
    }, base64);
    const info = response.info();
    if (info.status < 200 || info.status >= 300) {
      throw new Error(`UPLOAD_HTTP_${info.status}`);
    }
    return { eTag: responseHeader(info.headers, 'etag') };
  }

  async download(
    url: string,
    filename: string,
    onProgress: (done: number, total: number) => void,
  ): Promise<string> {
    await ensureDir(DOWNLOAD_DIR);
    const target = `${DOWNLOAD_DIR}/${Date.now()}-${basename(filename)}`;
    const result = await FileSystem.fetch(
      url,
      { method: 'GET', path: target },
      (bytesRead, contentLength) => onProgress(bytesRead, contentLength),
    );
    if (!result.ok) {
      await FileSystem.unlink(target).catch(() => {});
      throw new Error(`DOWNLOAD_HTTP_${result.status}`);
    }
    return target;
  }

  async remove(uri: string): Promise<void> {
    if (await FileSystem.exists(uri)) await FileSystem.unlink(uri);
  }
}

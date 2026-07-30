import FileViewer from 'react-native-file-viewer';
import type { MediaOpenPort } from '@im/sdk-core';

export class RnMediaOpener implements MediaOpenPort {
  async open(uri: string): Promise<void> {
    const path = uri.startsWith('file://') ? decodeURIComponent(uri.slice(7)) : uri;
    try {
      await FileViewer.open(path, { showOpenWithDialog: true, showAppsSuggestions: true });
    } catch {
      throw new Error('NO_FILE_HANDLER');
    }
  }
}

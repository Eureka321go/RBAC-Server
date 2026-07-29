import {
  launchCamera,
  launchImageLibrary,
  type Asset,
} from 'react-native-image-picker';
import {
  errorCodes,
  isErrorWithCode,
  pick,
} from '@react-native-documents/picker';
import type { MediaPicker, PickedMedia } from '@im/sdk-core';

const IMAGE_OPTIONS = {
  mediaType: 'photo' as const,
  maxWidth: 2048,
  maxHeight: 2048,
  quality: 0.8 as const,
  selectionLimit: 1,
  assetRepresentationMode: 'compatible' as const,
};

function imageOf(asset: Asset | undefined): PickedMedia {
  if (asset?.uri == null || asset.uri === '' || asset.fileSize == null || asset.fileSize <= 0) {
    throw new Error('MEDIA_INVALID');
  }
  return {
    uri: asset.uri,
    filename: asset.fileName?.trim() || `image-${Date.now()}.jpg`,
    mime: asset.type?.trim() || 'image/jpeg',
    size: asset.fileSize,
    width: asset.width,
    height: asset.height,
  };
}

export class RnMediaPicker implements MediaPicker {
  async pickCameraImage(): Promise<PickedMedia | null> {
    const result = await launchCamera(IMAGE_OPTIONS);
    if (result.didCancel) return null;
    if (result.errorCode != null) {
      throw new Error(result.errorCode === 'permission' ? 'CAMERA_PERMISSION_DENIED' : 'CAMERA_FAILED');
    }
    return imageOf(result.assets?.[0]);
  }

  async pickLibraryImage(): Promise<PickedMedia | null> {
    const result = await launchImageLibrary(IMAGE_OPTIONS);
    if (result.didCancel) return null;
    if (result.errorCode != null) {
      throw new Error(result.errorCode === 'permission' ? 'PHOTO_PERMISSION_DENIED' : 'PHOTO_PICK_FAILED');
    }
    return imageOf(result.assets?.[0]);
  }

  async pickFile(): Promise<PickedMedia | null> {
    try {
      const [file] = await pick({ mode: 'import', allowMultiSelection: false });
      if (file.error != null || file.size == null || file.size <= 0) {
        throw new Error('MEDIA_INVALID');
      }
      return {
        uri: file.uri,
        filename: file.name?.trim() || `file-${Date.now()}`,
        mime: file.type?.trim() || 'application/octet-stream',
        size: file.size,
      };
    } catch (cause) {
      if (isErrorWithCode(cause) && cause.code === errorCodes.OPERATION_CANCELED) return null;
      throw cause;
    }
  }
}

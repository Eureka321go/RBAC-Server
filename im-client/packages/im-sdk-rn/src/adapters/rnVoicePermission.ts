import { Platform } from 'react-native';
import {
  check,
  openSettings,
  PERMISSIONS,
  request,
  RESULTS,
  type PermissionStatus,
} from 'react-native-permissions';
import type { VoicePermissionPort, VoicePermissionStatus } from '@im/sdk-core';

function microphonePermission() {
  return Platform.OS === 'ios'
    ? PERMISSIONS.IOS.MICROPHONE
    : PERMISSIONS.ANDROID.RECORD_AUDIO;
}

function toStatus(status: PermissionStatus): VoicePermissionStatus {
  switch (status) {
    case RESULTS.GRANTED:
    case RESULTS.LIMITED:
      return 'granted';
    case RESULTS.BLOCKED:
      return 'blocked';
    case RESULTS.DENIED:
      return 'denied';
    default:
      return 'unavailable';
  }
}

export class RnVoicePermission implements VoicePermissionPort {
  async check(): Promise<VoicePermissionStatus> {
    return toStatus(await check(microphonePermission()));
  }

  async request(): Promise<VoicePermissionStatus> {
    return toStatus(await request(microphonePermission()));
  }

  openSettings(): Promise<void> {
    return openSettings('application');
  }
}

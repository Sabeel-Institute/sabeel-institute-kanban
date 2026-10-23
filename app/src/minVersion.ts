import { Platform } from 'react-native';
import { doc } from 'firebase/firestore';
import {
  APP_CONFIG_COLLECTION,
  APP_CONFIG_DOC,
  isBuildOutdated,
  versionCodeOf,
} from '@sabeel/shared';
import { BUILD_INFO } from './build-info';
import { db } from './firebase';
import { useLiveDoc } from './liveQuery';

/**
 * The versionCode this bundle was built as — what the update gate compares
 * with the institute's floor. Computed from the version as build.gradle
 * computes the APK's, and the iPhone build carries the same number, so the
 * bundle and the binary it ships in cannot disagree.
 */
const BUILD_VERSION_CODE: number = versionCodeOf(BUILD_INFO.version);

/**
 * Is this build too old to run?
 *
 * The institute's floor lives in `config/app` and is read live, before anyone
 * signs in, so a build retired while it is open lands on the update screen at
 * once, and one opened after the fact never gets as far as a sign-in the rules
 * would then refuse. The web has no floor: the site serves the current bundle
 * to everyone.
 *
 * NEVER LOCKS ANYONE OUT ON A READ THAT DID NOT ARRIVE. Offline, before the
 * first snapshot, with no document at all, or on an error, the floor is
 * unknown and the app runs: a gate that closed on a network fault would shut
 * out the people it is meant to help.
 */
export function useMinVersion(): boolean {
  const config = useLiveDoc(
    () => (Platform.OS === 'web' ? null : doc(db, APP_CONFIG_COLLECTION, APP_CONFIG_DOC)),
    [],
    'appConfig',
    (d) => {
      const code = d?.data.minVersionCode;
      return typeof code === 'number' ? code : null;
    },
  );
  return isBuildOutdated(BUILD_VERSION_CODE, config.status === 'ready' ? config.data : null);
}

import React from 'react';
import {
  CloudAccountDeletionError,
  deleteCloudAccount,
} from '../lib/cloudBackend';
import { clearDeletedAccountLocalState } from '../lib/localPersistence';
import { clearMediaMaintenanceLocalState } from '../lib/mediaMaintenancePersistence';
import { clearPendingMediaDeletionState } from '../lib/mediaStorage';
import { clearUserMemorySyncStorage } from '../lib/memoryOutbox';

type AccountDeletionCopy = {
  passwordRequired: string;
  currentPasswordWrong: string;
  accountDeleteFailed: string;
  accountDeleteStorageFailed: string;
};

export function useAccountDeletion({
  account,
  isSignedIn,
  active,
  copy,
  onDeleted,
}: {
  account: string;
  isSignedIn: boolean;
  active: boolean;
  copy: AccountDeletionCopy;
  onDeleted: () => void;
}) {
  const [password, setPassword] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [isDeleting, setIsDeleting] = React.useState(false);

  React.useEffect(() => {
    if (active && isSignedIn) return;
    setPassword('');
    setStatus('');
    setIsDeleting(false);
  }, [active, isSignedIn]);

  const handleDeleteAccount = React.useCallback(async () => {
    if (!password || isDeleting) {
      if (!password) setStatus(copy.passwordRequired);
      return;
    }

    setIsDeleting(true);
    setStatus('');
    try {
      const result = await deleteCloudAccount(password);
      await clearUserMemorySyncStorage(result.userId).catch(() => {});
      clearDeletedAccountLocalState(account);
      clearMediaMaintenanceLocalState(account);
      clearPendingMediaDeletionState(result.userId);
      setPassword('');
      onDeleted();
    } catch (error) {
      if (error instanceof CloudAccountDeletionError) {
        if (error.code === 'invalid_password') {
          setStatus(copy.currentPasswordWrong);
        } else if (error.code === 'storage_cleanup_failed') {
          setStatus(copy.accountDeleteStorageFailed);
        } else {
          setStatus(copy.accountDeleteFailed);
        }
      } else {
        setStatus(copy.accountDeleteFailed);
      }
    } finally {
      setIsDeleting(false);
    }
  }, [account, copy, isDeleting, onDeleted, password]);

  return {
    accountDeletePassword: password,
    accountDeleteStatus: status,
    isDeletingAccount: isDeleting,
    setAccountDeletePassword: setPassword,
    setAccountDeleteStatus: setStatus,
    handleDeleteAccount,
  };
}

import React from 'react';
import {
  CloudAuthError,
  updateCloudPassword,
} from '../lib/cloudBackend';

type PasswordChangeCopy = {
  loginMissing: string;
  passwordTooShort: string;
  passwordMismatch: string;
  passwordChanged: string;
  currentPasswordWrong: string;
};

export const usePasswordChange = ({
  account,
  minPasswordLength,
  copy,
  getFallbackErrorMessage,
  onChanged,
}: {
  account: string;
  minPasswordLength: number;
  copy: PasswordChangeCopy;
  getFallbackErrorMessage: (error: unknown) => string;
  onChanged: () => void;
}) => {
  const [currentPasswordInput, setCurrentPasswordInput] = React.useState('');
  const [newPasswordInput, setNewPasswordInput] = React.useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = React.useState('');
  const [isChangingPassword, setIsChangingPassword] = React.useState(false);
  const [passwordChangeStatus, setPasswordChangeStatus] = React.useState('');

  const handleChangePassword = React.useCallback(async () => {
    if (isChangingPassword) return;

    const currentPassword = currentPasswordInput;
    const newPassword = newPasswordInput;
    const confirmPassword = confirmPasswordInput;

    if (!currentPassword.trim() || !newPassword.trim() || !confirmPassword.trim()) {
      setPasswordChangeStatus(copy.loginMissing);
      return;
    }
    if (newPassword.length < minPasswordLength) {
      setPasswordChangeStatus(copy.passwordTooShort);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordChangeStatus(copy.passwordMismatch);
      return;
    }

    setIsChangingPassword(true);
    setPasswordChangeStatus('');

    try {
      await updateCloudPassword({
        account,
        currentPassword,
        newPassword,
      });
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setConfirmPasswordInput('');
      onChanged();
      setPasswordChangeStatus(copy.passwordChanged);
    } catch (error) {
      console.error('Could not change password:', error);
      if (error instanceof CloudAuthError && error.code === 'invalid_credentials') {
        setPasswordChangeStatus(copy.currentPasswordWrong);
      } else if (error instanceof CloudAuthError && error.code === 'weak_password') {
        setPasswordChangeStatus(copy.passwordTooShort);
      } else {
        setPasswordChangeStatus(getFallbackErrorMessage(error));
      }
    } finally {
      setIsChangingPassword(false);
    }
  }, [
    account,
    confirmPasswordInput,
    copy.currentPasswordWrong,
    copy.loginMissing,
    copy.passwordChanged,
    copy.passwordMismatch,
    copy.passwordTooShort,
    currentPasswordInput,
    getFallbackErrorMessage,
    isChangingPassword,
    minPasswordLength,
    newPasswordInput,
    onChanged,
  ]);

  return {
    currentPasswordInput,
    newPasswordInput,
    confirmPasswordInput,
    isChangingPassword,
    passwordChangeStatus,
    setCurrentPasswordInput,
    setNewPasswordInput,
    setConfirmPasswordInput,
    setPasswordChangeStatus,
    handleChangePassword,
  };
};

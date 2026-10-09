import { useEffect, useState } from 'react'
import { Mail, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { checkAuthFn, createUserFn, deleteUserFn, getUsersFn, signInOptionsFn } from '../../../server/functions'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Field, FieldGrid, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { ChangePasswordForm } from './ChangePasswordForm'
import { SettingsActions, SettingsBlock, SettingsEmpty, SettingsList, SettingsPanel, SettingsRow } from './SettingsBlock'

/** Settings → Team and login: who can sign in, and your own password. */
export function TeamTab() {
  // Users State
  const [users, setUsers] = useState<any[]>([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(false)
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
  const [userError, setUserError] = useState<string | null>(null)
  const [userSuccess, setUserSuccess] = useState<string | null>(null)
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [isAddingUser, setIsAddingUser] = useState(false)
  // False when PASSWORD_LOGIN=off: the hosting provider runs sign-in.
  const [passwordLogin, setPasswordLogin] = useState(true)

  const fetchUsers = async () => {
    setIsLoadingUsers(true)
    setUserError(null)
    try {
      const res = await getUsersFn()
      if (res.success && res.users) {
        setUsers(res.users)
      }
    } catch (e: any) {
      setUserError(e.message || 'Failed to load users')
    } finally {
      setIsLoadingUsers(false)
    }
  }

  const fetchCurrentUser = async () => {
    try {
      const res = await checkAuthFn()
      if (res.isAuthenticated && res.email) {
        setCurrentUserEmail(res.email)
      }
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    fetchUsers()
    fetchCurrentUser()
    signInOptionsFn()
      .then((o) => setPasswordLogin(o.passwordLogin))
      .catch(() => {})
  }, [])

  // --- User Handlers ---
  const showUserSuccess = (msg: string) => {
    setUserSuccess(msg)
    setTimeout(() => setUserSuccess(null), 3500)
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newUserEmail.trim() || !newUserPassword.trim()) return
    setIsAddingUser(true)
    setUserError(null)
    try {
      const res = await createUserFn({ data: { email: newUserEmail.trim(), password: newUserPassword.trim() } })
      if (res.success) {
        setNewUserEmail('')
        setNewUserPassword('')
        await fetchUsers()
        showUserSuccess('Added. They can sign in now.')
      } else {
        setUserError(res.error || 'Failed to add user')
      }
    } catch (e: any) {
      setUserError(e.message || 'Failed to add user')
    } finally {
      setIsAddingUser(false)
    }
  }

  const handleDeleteUser = async (email: string) => {
    if (!window.confirm(`Remove ${email}? They won't be able to sign in.`)) return
    setUserError(null)
    try {
      const res = await deleteUserFn({ data: { email } })
      if (res.success) {
        await fetchUsers()
        showUserSuccess('Removed.')
      } else {
        setUserError(res.error || 'Failed to delete user')
      }
    } catch (e: any) {
      setUserError(e.message || 'Failed to delete user')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {userSuccess && <Notice level="success">{userSuccess}</Notice>}
      {userError && <Notice level="error">{userError}</Notice>}

      <SettingsPanel>
        <SettingsBlock title="People" description="Everyone here has full access to this workspace.">
          {isLoadingUsers && users.length === 0 ? (
            <SettingsEmpty>
              <RefreshCw className="mr-2 inline h-4 w-4 animate-spin text-accent" />
              Loading…
            </SettingsEmpty>
          ) : users.length === 0 ? (
            <SettingsEmpty>Nobody yet.</SettingsEmpty>
          ) : (
            <SettingsList>
              {users.map((user) => {
                const isSelf = currentUserEmail?.toLowerCase() === user.email.toLowerCase()
                const locked = isSelf || users.length <= 1
                return (
                  <SettingsRow
                    key={user.email}
                    icon={<Mail className="h-4 w-4" />}
                    title={user.email}
                    badge={isSelf ? <Badge variant="info">You</Badge> : undefined}
                    actions={
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteUser(user.email)}
                        disabled={locked}
                        aria-label={`Remove ${user.email}`}
                        title={isSelf ? "You can't remove yourself" : users.length <= 1 ? "The last person can't be removed" : 'Remove'}
                        className={locked ? '' : 'hover:!bg-destructive/10 hover:!text-destructive'}
                        leftIcon={<Trash2 className="h-4 w-4" />}
                      />
                    }
                  />
                )
              })}
            </SettingsList>
          )}
        </SettingsBlock>

        {!passwordLogin ? (
          <SettingsBlock title="Sign-in">
            <Notice>Sign-in is run by your hosting provider, so passwords and new people are managed there, not here.</Notice>
          </SettingsBlock>
        ) : (
          <>
            <SettingsBlock title="Add someone" description="They sign in with this email and password.">
              <form onSubmit={handleAddUser} className="flex flex-col gap-3">
                <FieldGrid>
                  <Field label="Email">
                    <input
                      type="email"
                      required
                      value={newUserEmail}
                      onChange={(e) => setNewUserEmail(e.target.value)}
                      placeholder="name@yourcompany.com"
                      disabled={isAddingUser}
                      className={INPUT_CLASS}
                    />
                  </Field>
                  <Field label="Password">
                    <input
                      type="password"
                      required
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                      placeholder="At least 6 characters"
                      disabled={isAddingUser}
                      className={INPUT_CLASS}
                    />
                  </Field>
                </FieldGrid>
                <SettingsActions>
                  <Button
                    type="submit"
                    isLoading={isAddingUser}
                    disabled={!newUserEmail.trim() || !newUserPassword.trim() || newUserPassword.trim().length < 6}
                    leftIcon={<Plus className="h-4 w-4" />}
                  >
                    Add person
                  </Button>
                </SettingsActions>
              </form>
            </SettingsBlock>
            <ChangePasswordForm />
          </>
        )}
      </SettingsPanel>
    </div>
  )
}

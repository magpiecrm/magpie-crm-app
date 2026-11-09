import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { checkAuthFn, createUserFn, deleteUserFn, getUsersFn, signInOptionsFn } from '../../../server/functions'
import { queryKeys } from '../../../queryKeys'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Field, FieldGrid, INPUT_CLASS } from '../../../components/ui/Field'
import { Notice } from '../../../components/ui/Notice'
import { ChangePasswordForm } from './ChangePasswordForm'
import { SettingsActions, SettingsBlock, SettingsEmpty, SettingsList, SettingsPanel, SettingsRow } from './SettingsBlock'
import { confirmDialog } from '../../../components/ui/confirm'

/** Settings → Team and login: who can sign in, and your own password. */
export function TeamTab() {
  const queryClient = useQueryClient()
  // Cached with the settings menu's status, so a page opened before shows at once instead of loading again.
  const team = useQuery({ queryKey: queryKeys.settings.team(), queryFn: () => getUsersFn() })
  const { data: account } = useQuery({ queryKey: queryKeys.account(), queryFn: () => checkAuthFn(), staleTime: 5 * 60_000 })
  // False when PASSWORD_LOGIN=off: the hosting provider runs sign-in. Unknown until loaded, so neither version shows and then swaps.
  const { data: signIn } = useQuery({ queryKey: queryKeys.settings.signInOptions(), queryFn: () => signInOptionsFn(), staleTime: Infinity })
  const users: any[] = (team.data?.success && team.data.users) || []
  const currentUserEmail = account?.isAuthenticated ? account.email : null
  const loadError = team.error ? team.error.message || 'Failed to load users' : team.data && !team.data.success ? team.data.error || 'Failed to load users' : null
  const [userError, setUserError] = useState<string | null>(null)
  const [userSuccess, setUserSuccess] = useState<string | null>(null)
  const [newUserEmail, setNewUserEmail] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [isAddingUser, setIsAddingUser] = useState(false)

  const fetchUsers = () => queryClient.invalidateQueries({ queryKey: queryKeys.settings.team() })

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
    if (!(await confirmDialog({ title: `Remove ${email}?`, message: "They won't be able to sign in to this workspace any more.", confirmLabel: 'Remove', tone: 'danger' }))) return
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
      {(userError || loadError) && <Notice level="error">{userError || loadError}</Notice>}

      <SettingsPanel>
        <SettingsBlock title="People" description="Everyone here has full access to this workspace.">
          {team.isLoading ? (
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
                    icon={
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold uppercase text-accent" aria-hidden>
                        {user.email[0]}
                      </span>
                    }
                    title={user.email}
                    detail={isSelf ? "That's you, so you can't remove yourself here." : undefined}
                    badge={isSelf ? <Badge>You</Badge> : undefined}
                    // Removing isn't offered at all where it can't be done, rather than shown greyed out.
                    actions={
                      !locked && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteUser(user.email)}
                          aria-label={`Remove ${user.email}`}
                          title="Remove"
                          className="hover:!bg-destructive/10 hover:!text-destructive"
                          leftIcon={<Trash2 className="h-4 w-4" />}
                        />
                      )
                    }
                  />
                )
              })}
            </SettingsList>
          )}
        </SettingsBlock>

        {!signIn ? null : !signIn.passwordLogin ? (
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
                  <Field label="Password" hint="At least 6 characters.">
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                      disabled={isAddingUser}
                      className={INPUT_CLASS}
                    />
                  </Field>
                </FieldGrid>
                <SettingsActions>
                  <Button
                    type="submit"
                    isLoading={isAddingUser}
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

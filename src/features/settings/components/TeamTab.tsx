import { useEffect, useState } from 'react'
import { AlertCircle, Check, Mail, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { checkAuthFn, createUserFn, deleteUserFn, getUsersFn } from '../../../server/functions'
import { ChangePasswordForm } from './ChangePasswordForm'

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
        showUserSuccess('User added successfully!')
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
    if (!window.confirm(`Are you sure you want to delete the user "${email}"?`)) return
    setUserError(null)
    try {
      const res = await deleteUserFn({ data: { email } })
      if (res.success) {
        await fetchUsers()
        showUserSuccess('User deleted successfully.')
      } else {
        setUserError(res.error || 'Failed to delete user')
      }
    } catch (e: any) {
      setUserError(e.message || 'Failed to delete user')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Success / Error messages */}
      {userSuccess && (
        <div className="p-3 bg-green-500/10 border border-green-500/20 text-green-500 text-sm rounded-md-s flex items-center gap-2">
          <Check className="w-4 h-4 shrink-0" />
          <span>{userSuccess}</span>
        </div>
      )}
      {userError && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-md-s flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{userError}</span>
        </div>
      )}

      {/* Users List */}
      <div className="flex flex-col gap-3">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider border-b border-border/60 pb-1">Current Users</h4>
        {isLoadingUsers ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <RefreshCw className="w-5 h-5 animate-spin text-accent" />
            <span>Loading users...</span>
          </div>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No users found.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {users.map((user) => {
              const isSelf = currentUserEmail?.toLowerCase() === user.email.toLowerCase()
              return (
                <div key={user.email} className="border border-border rounded-md-s bg-muted/20 overflow-hidden">
                  <div className="p-4 flex items-center gap-3">
                    <div className="p-2 bg-accent/10 rounded-md-s text-accent shrink-0">
                      <Mail className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate flex items-center gap-2">
                        {user.email}
                        {isSelf && (
                          <span className="text-[10px] bg-accent/25 text-accent px-2 py-0.5 rounded-full font-normal">
                            You
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleDeleteUser(user.email)}
                        disabled={isSelf || users.length <= 1}
                        className={`p-1.5 border border-transparent rounded-md-s transition-all cursor-pointer ${
                          isSelf || users.length <= 1
                            ? 'text-muted-foreground/45 cursor-not-allowed'
                            : 'text-destructive hover:bg-destructive/10 hover:border-destructive/20'
                        }`}
                        title={
                          isSelf
                            ? 'Cannot delete your own account'
                            : users.length <= 1
                              ? 'Cannot delete the last remaining user'
                              : 'Delete user'
                        }
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <ChangePasswordForm />

      {/* Add New User */}
      <form onSubmit={handleAddUser} className="flex flex-col gap-3 p-5 bg-muted/20 border border-border/80 rounded-md-s">
        <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Add New User</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground">User Email Address</label>
            <input
              type="email"
              required
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
              placeholder="e.g. member@yourdomain.com"
              disabled={isAddingUser}
              className="bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground">Account Password</label>
            <input
              type="password"
              required
              value={newUserPassword}
              onChange={(e) => setNewUserPassword(e.target.value)}
              placeholder="At least 6 characters"
              disabled={isAddingUser}
              className="bg-background border border-border rounded-md-s px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={isAddingUser || !newUserEmail.trim() || !newUserPassword.trim() || newUserPassword.trim().length < 6}
          className="w-full md:w-auto md:self-end px-4 py-2.5 bg-primary hover:bg-primary/85 disabled:opacity-50 text-primary-foreground text-sm font-semibold rounded-md-s transition-all shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
        >
          {isAddingUser ? (
            <><RefreshCw className="w-4 h-4 animate-spin" /><span>Adding...</span></>
          ) : (
            <><Plus className="w-4 h-4" /><span>Add User</span></>
          )}
        </button>
      </form>
    </div>
  )
}
